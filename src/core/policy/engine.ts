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

  readonly dayOffset: number;

  readonly rationale: string;
}

export interface PolicyInput {
  readonly row: LedgerRow;
  readonly classification: Classification;
  readonly estimator: TimingEstimator;

  readonly attemptsSpent: number;

  readonly nudgesSent: number;
}

const ATTEMPT_COST_PAISE = 250;

const NUDGE_COST_PAISE = 900;

const MIN_EV_RATIO = 0.02;

const LOW_CONFIDENCE = 0.5;

const CHANNEL_BY_INSTRUMENT: Record<LedgerRow["instrumentType"], NudgeChannel> = {
  UPI_AUTOPAY: "in_app",
  CARD: "email",
  NACH_EMANDATE: "sms",
};

const RETRY_OFFSETS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function decide(input: PolicyInput): Decision {
  const { row, classification, attemptsSpent } = input;
  const c = classification.cause;

  if (attemptsSpent >= SIM.MAX_ATTEMPTS) {
    return {
      action: { kind: "ABANDON", winBack: !isTerminal(c) },
      dayOffset: 0,
      rationale: `Attempt budget exhausted (${attemptsSpent}/${SIM.MAX_ATTEMPTS}). Stopping is the only remaining decision.`,
    };
  }

  switch (c.kind) {
    case "INSUFFICIENT_FUNDS":
      return decideInsufficientFunds(input);

    case "MANDATE_EXPIRED": {
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

      return {
        action: { kind: "ABANDON", winBack: false },
        dayOffset: 0,
        rationale: `Blocked by risk or compliance. Re-presenting a risk-blocked debit is not a recovery tactic and would be its own problem. Not flagged for win-back.`,
      };

    case "PRE_DEBIT_NOTICE_FAILED": {
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

    case "DO_NOT_HONOUR": {
      if (attemptsSpent >= 3) {
        return {
          action: { kind: "ABANDON", winBack: true },
          dayOffset: 0,
          rationale: `Three attempts against an unexplained issuer refusal have all failed. The remaining explanations are all hard refusals. Stopping.`,
        };
      }

      if (classification.confidence < LOW_CONFIDENCE && attemptsSpent >= 1) {
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

    default:
      return assertNever(c, "policy/engine.decide");
  }
}

function decideInsufficientFunds(input: PolicyInput): Decision {
  const { row, estimator, attemptsSpent } = input;

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

    if (p > bestP + 1e-9) {
      bestP = p;
      bestOffset = offset;
      bestSupport = estimator.support("INSUFFICIENT_FUNDS", row.segment, dom);
    }
  }

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

function smallestSplit(amountPaise: number, capPaise: number): number | null {
  if (capPaise <= 0) return null;
  const needed = Math.ceil(amountPaise / capPaise);
  return needed <= RESPONSE.SPLIT_MAX_PARTS ? Math.max(2, needed) : null;
}

function expectedNudgeValue(amountPaise: number, factor: number): number {
  const assumedResponsiveness = 0.38;
  return assumedResponsiveness * factor * amountPaise - NUDGE_COST_PAISE;
}

function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function paise(p: number): string {
  return `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
