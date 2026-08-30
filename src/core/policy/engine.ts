/**
 * B3: the Recovery Ledger policy engine. The system under test.
 *
 * A ledger row goes in; a justified action with a timestamp comes out.
 *
 * ## The compiler proves this is total
 *
 * The switch below is over `RootCause`, and its default branch calls
 * `assertNever`. If someone adds a cause to the taxonomy and does not decide
 * what to do about it, `tsc` fails. Not a lint rule, not a test that might not
 * run -- the build.
 *
 * That guarantee is worth stating plainly because it is the reason the domain
 * model is a discriminated union instead of a string enum, and it is not
 * something Python would have given for free. In a dunning system the failure
 * mode it prevents is specific and expensive: a new gateway reason code
 * appears, nothing handles it, and it silently falls into a default retry
 * branch that re-presents an unretryable debit five times a cycle, forever.
 *
 * ## The organising principle
 *
 * Recovery is resource allocation. Every row competes for a finite budget of
 * debit attempts and customer patience, so the interesting decision is not
 * "how do we recover this?" but "is this worth chasing at all?". Three of the
 * ten causes are answered with ABANDON, and on those rows the correct amount
 * of effort is zero. Baselines have no way to express that.
 */

import {
  assertNever,
  isTerminal,
  type NudgeChannel,
  type RecoveryAction,
  type RootCause,
} from "../taxonomy.js";
import type { LedgerRow } from "../ledger.js";
import type { Classification } from "../classify.js";
import { MONTH_DAYS } from "../simulator/population.js";
import { featureKindFor, TimingEstimator } from "./timing.js";
import { RESPONSE, SIM } from "../simulator/params.js";

export interface Decision {
  readonly action: RecoveryAction;
  /** Days after the failure that the action fires. */
  readonly dayOffset: number;
  /** Human-readable justification, shown verbatim on the row detail screen. */
  readonly rationale: string;
}

export interface PolicyInput {
  readonly row: LedgerRow;
  readonly classification: Classification;
  readonly estimator: TimingEstimator;
  /** Attempts already spent on this row. */
  readonly attemptsSpent: number;
  /** Nudges already sent to this customer. */
  readonly nudgesSent: number;
}

// ---------------------------------------------------------------------------
// Economics
// ---------------------------------------------------------------------------

/**
 * Cost of one debit attempt, in paise.
 *
 * Deliberately modest. The real cost of a wasted retry is not the processing
 * fee -- it is the issuer relationship, the customer seeing three failed-debit
 * SMS messages in a week, and the attempt budget spent on a row that cannot be
 * recovered instead of one that can.
 */
const ATTEMPT_COST_PAISE = 250;

/** Cost of one customer nudge. Higher than an attempt: it consumes goodwill. */
const NUDGE_COST_PAISE = 900;

/**
 * Minimum expected value, as a fraction of the amount at risk, for an action
 * to be worth taking. Below this we abandon rather than chase.
 */
const MIN_EV_RATIO = 0.02;

/** Confidence below which we treat the classification as untrustworthy. */
const LOW_CONFIDENCE = 0.5;

const CHANNEL_BY_INSTRUMENT: Record<LedgerRow["instrumentType"], NudgeChannel> = {
  UPI_AUTOPAY: "in_app",
  CARD: "email",
  NACH_EMANDATE: "sms",
};

/** Candidate retry offsets. Bounded by the horizon and by patience. */
const RETRY_OFFSETS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function decide(input: PolicyInput): Decision {
  const { row, classification, attemptsSpent } = input;
  const c = classification.cause;

  // Budget exhaustion is checked before the cause switch. Once the attempt
  // budget is gone the cause no longer matters -- there is nothing left to
  // spend, and pretending otherwise would produce actions that cannot fire.
  if (attemptsSpent >= SIM.MAX_ATTEMPTS) {
    return {
      action: { kind: "ABANDON", winBack: !isTerminal(c) },
      dayOffset: 0,
      rationale: `Attempt budget exhausted (${attemptsSpent}/${SIM.MAX_ATTEMPTS}). Stopping is the only remaining decision.`,
    };
  }

  switch (c.kind) {
    // -----------------------------------------------------------------------
    // Timing-sensitive. The one case where the learned estimator earns its keep.
    // -----------------------------------------------------------------------
    case "INSUFFICIENT_FUNDS":
      return decideInsufficientFunds(input);

    // -----------------------------------------------------------------------
    // Terminal. Retrying is structurally guaranteed to fail.
    // -----------------------------------------------------------------------
    case "MANDATE_EXPIRED": {
      // Not abandoned: the mandate is dead but the customer relationship may
      // not be. A renewal ask is the only thing that can work, and it costs a
      // nudge rather than an attempt.
      const ev = expectedNudgeValue(row.amountPaise, RESPONSE.MANDATE_RENEWAL_FACTOR);
      if (ev < row.amountPaise * MIN_EV_RATIO) {
        return {
          action: { kind: "ABANDON", winBack: true },
          dayOffset: 0,
          rationale: `Mandate lapsed on day ${c.expiredOnDay}. A renewal ask is not worth its cost on ${paise(row.amountPaise)}; flagged for win-back instead.`,
        };
      }
      return {
        action: {
          kind: "REQUEST_MANDATE_RENEWAL",
          channel: CHANNEL_BY_INSTRUMENT[row.instrumentType],
        },
        dayOffset: 1,
        rationale: `Mandate lapsed on day ${c.expiredOnDay}. No debit can clear until it is re-authorised, so retrying would waste every attempt it spent. Asking for renewal instead.`,
      };
    }

    case "MANDATE_AMOUNT_EXCEEDED": {
      // Retrying the same amount fails by construction. Splitting is the only
      // presentment that can clear the cap.
      const parts = smallestSplit(c.attemptedPaise, c.capPaise);
      if (parts === null) {
        return {
          action: { kind: "ABANDON", winBack: true },
          dayOffset: 0,
          rationale: `Debit of ${paise(c.attemptedPaise)} exceeds the authorised cap of ${paise(c.capPaise)} by more than ${RESPONSE.SPLIT_MAX_PARTS}x. No split fits under the cap; the mandate has to be amended.`,
        };
      }
      const perPart = Math.ceil(c.attemptedPaise / parts);
      return {
        action: { kind: "SPLIT_AMOUNT", parts, perPartPaise: perPart },
        dayOffset: 1,
        rationale: `Debit of ${paise(c.attemptedPaise)} exceeds the ${paise(c.capPaise)} cap the customer authorised. Re-presenting the same amount fails 100% of the time by construction, so splitting into ${parts} x ${paise(perPart)} to fit under the cap.`,
      };
    }

    case "MANDATE_REVOKED":
      // The clearest ABANDON in the taxonomy. The customer has actively said
      // no. Continuing to debit is not a recovery strategy, it is a complaint
      // waiting to happen.
      return {
        action: { kind: "ABANDON", winBack: true },
        dayOffset: 0,
        rationale: `Customer revoked the mandate. Further debit attempts cannot succeed and would be an unwanted contact. Stopping and flagging for win-back marketing.`,
      };

    case "CARD_EXPIRED": {
      const ev = expectedNudgeValue(row.amountPaise, RESPONSE.INSTRUMENT_UPDATE_FACTOR);
      if (ev < row.amountPaise * MIN_EV_RATIO) {
        return {
          action: { kind: "ABANDON", winBack: true },
          dayOffset: 0,
          rationale: `Stored instrument is no longer valid, and chasing an update is not worth its cost on ${paise(row.amountPaise)}.`,
        };
      }
      return {
        action: {
          kind: "REQUEST_INSTRUMENT_UPDATE",
          channel: CHANNEL_BY_INSTRUMENT[row.instrumentType],
        },
        dayOffset: 1,
        rationale: `Stored instrument is no longer valid. No retry can clear it, so asking the customer for a new one is the only action with a non-zero success probability.`,
      };
    }

    case "RISK_BLOCKED":
      // The one cause where retrying is not merely wasteful but wrong.
      return {
        action: { kind: "ABANDON", winBack: false },
        dayOffset: 0,
        rationale: `Blocked by risk or compliance. Re-presenting a risk-blocked debit is not a recovery tactic and would be its own problem. Not flagged for win-back.`,
      };

    // -----------------------------------------------------------------------
    // Fixable, then retryable.
    // -----------------------------------------------------------------------
    case "PRE_DEBIT_NOTICE_FAILED": {
      // RBI requires 24h of notice, so the earliest legal re-presentment is
      // the day after the notice goes out. A same-day retry is not just
      // unlikely to work -- it is not allowed to.
      const retryOffset = 1 + RESPONSE.NOTICE_MIN_RETRY_DELAY_DAYS;
      return {
        action: {
          kind: "RESEND_NOTICE",
          channel: CHANNEL_BY_INSTRUMENT[row.instrumentType],
          retryDayOffset: retryOffset,
        },
        dayOffset: 1,
        rationale: `The RBI-mandated pre-debit notification did not reach the customer, so the debit was never eligible. Retrying without re-sending it hits the same wall. Re-sending, then re-presenting on day ${retryOffset} to respect the 24h notice window.`,
      };
    }

    // -----------------------------------------------------------------------
    // Transient. Wait the right amount of time, not a fixed amount.
    // -----------------------------------------------------------------------
    case "ISSUER_DOWNTIME": {
      const { feature: offset, probability, support } = input.estimator.best(
        "ISSUER_DOWNTIME",
        row.segment,
        [1, 2, 3, 4],
      );
      return {
        action: { kind: "RETRY_AT", dayOffset: offset, expectedSuccess: probability },
        dayOffset: offset,
        rationale: `${c.issuerBank} was degraded at debit time. Outages clear on their own, so the question is only how long to wait. Estimated success at +${offset}d is ${pct(probability)} (${support} observations).`,
      };
    }

    case "TECHNICAL_DECLINE": {
      const { feature: offset, probability, support } = input.estimator.best(
        "TECHNICAL_DECLINE",
        row.segment,
        [1, 2, 3],
      );
      if (attemptsSpent >= 3) {
        return {
          action: { kind: "ABANDON", winBack: true },
          dayOffset: 0,
          rationale: `Three attempts have already failed on what was classified as a transient fault. It is not transient. Stopping rather than spending the rest of the budget on it.`,
        };
      }
      return {
        action: { kind: "RETRY_AT", dayOffset: offset, expectedSuccess: probability },
        dayOffset: offset,
        rationale: `Transient technical fault. Re-presenting at +${offset}d, estimated ${pct(probability)} (${support} observations).`,
      };
    }

    // -----------------------------------------------------------------------
    // Genuinely ambiguous. Bounded retries, then stop.
    // -----------------------------------------------------------------------
    case "DO_NOT_HONOUR": {
      // The issuer refused without saying why, so some of these are soft and
      // clear on retry while the rest never will. The honest response is a
      // small, bounded number of attempts -- not the unbounded retrying a
      // fixed schedule does, and not the zero attempts that treating it as
      // terminal would give.
      if (attemptsSpent >= 3) {
        return {
          action: { kind: "ABANDON", winBack: true },
          dayOffset: 0,
          rationale: `Three attempts against an unexplained issuer refusal have all failed. The remaining explanations are all hard refusals. Stopping.`,
        };
      }

      if (classification.confidence < LOW_CONFIDENCE && attemptsSpent >= 1) {
        // We do not know what this is and one attempt has already failed.
        // Escalating a high-value row to a human beats guessing again.
        if (row.amountPaise >= 5_000_00) {
          return {
            action: { kind: "ESCALATE", note: "unexplained decline on a high-value mandate" },
            dayOffset: 2,
            rationale: `Unexplained decline (classifier confidence ${pct(classification.confidence)}) on ${paise(row.amountPaise)}. Worth a human look rather than another blind retry.`,
          };
        }
        return {
          action: { kind: "ABANDON", winBack: true },
          dayOffset: 0,
          rationale: `Unexplained decline with low classifier confidence (${pct(classification.confidence)}) on ${paise(row.amountPaise)}. Not worth further attempts at this value.`,
        };
      }

      const { feature: offset, probability, support } = input.estimator.best(
        "DO_NOT_HONOUR",
        row.segment,
        [2, 3, 4, 5, 6, 7],
      );
      return {
        action: { kind: "RETRY_AT", dayOffset: offset, expectedSuccess: probability },
        dayOffset: offset,
        rationale: `Issuer declined without a machine-readable reason, so this is genuinely ambiguous. Allowing a bounded retry at +${offset}d (estimated ${pct(probability)}, ${support} observations) before giving up.`,
      };
    }

    // -----------------------------------------------------------------------
    // The guarantee. Adding a cause without handling it fails the build.
    // -----------------------------------------------------------------------
    default:
      return assertNever(c, "policy/engine.decide");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decideInsufficientFunds(input: PolicyInput): Decision {
  const { row, estimator, attemptsSpent } = input;

  // The estimator is keyed on calendar position for this cause, because that
  // is where the balance curve lives. Convert candidate offsets into the
  // day-of-month they would land on, ask which is best, convert back.
  if (featureKindFor("INSUFFICIENT_FUNDS") !== "CALENDAR_DAY") {
    throw new Error("INSUFFICIENT_FUNDS must be estimated on calendar position");
  }

  const horizonOffsets = RETRY_OFFSETS.filter(
    (o) => row.failedOnDay + o <= SIM.HORIZON_DAYS,
  );
  if (horizonOffsets.length === 0) {
    return {
      action: { kind: "ABANDON", winBack: true },
      dayOffset: 0,
      rationale: "No retry window remains before the horizon.",
    };
  }

  let bestOffset = horizonOffsets[0]!;
  let bestP = -1;
  let bestSupport = 0;
  for (const offset of horizonOffsets) {
    const dom = ((row.failedOnDay + offset) % MONTH_DAYS) + 1;
    const p = estimator.probability("INSUFFICIENT_FUNDS", row.segment, dom);
    // Prefer sooner on a tie: the same rupee recovered earlier is worth more,
    // and a longer wait is more exposure to the mandate lapsing underneath us.
    if (p > bestP + 1e-9) {
      bestP = p;
      bestOffset = offset;
      bestSupport = estimator.support("INSUFFICIENT_FUNDS", row.segment, dom);
    }
  }

  // Is another attempt worth its cost?
  const expectedGain = bestP * row.amountPaise;
  if (expectedGain < ATTEMPT_COST_PAISE || bestP < 0.05) {
    return {
      action: { kind: "ABANDON", winBack: true },
      dayOffset: 0,
      rationale: `Best available retry window is only ${pct(bestP)} on ${paise(row.amountPaise)}, which does not cover the cost of the attempt. Stopping.`,
    };
  }

  const landsOn = ((row.failedOnDay + bestOffset) % MONTH_DAYS) + 1;
  const attemptNote =
    attemptsSpent > 0 ? ` This is attempt ${attemptsSpent + 1} of ${SIM.MAX_ATTEMPTS}.` : "";

  return {
    action: {
      kind: "RETRY_AT",
      dayOffset: bestOffset,
      expectedSuccess: bestP,
    },
    dayOffset: bestOffset,
    rationale:
      `Balance was short, which is a timing problem rather than a terminal one. ` +
      `Across the ${row.segment.toLowerCase().replace(/_/g, " ")} segment, day ${landsOn} of the month ` +
      `is the best window in the next fortnight at ${pct(bestP)} (${bestSupport} observations). ` +
      `Retrying at +${bestOffset}d rather than on a fixed schedule.${attemptNote}`,
  };
}

/**
 * Fewest parts that bring each instalment under the cap, or null if even the
 * maximum split does not fit.
 */
function smallestSplit(amountPaise: number, capPaise: number): number | null {
  if (capPaise <= 0) return null;
  const needed = Math.ceil(amountPaise / capPaise);
  return needed <= RESPONSE.SPLIT_MAX_PARTS ? Math.max(2, needed) : null;
}

/** Crude EV of a nudge, before knowing this customer's responsiveness. */
function expectedNudgeValue(amountPaise: number, factor: number): number {
  // The policy cannot see responsiveness, so it uses the population mean.
  const assumedResponsiveness = 0.38;
  return assumedResponsiveness * factor * amountPaise - NUDGE_COST_PAISE;
}

function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function paise(p: number): string {
  return `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
