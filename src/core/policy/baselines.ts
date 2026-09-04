import type { LedgerRow } from "../ledger.js";
import type { Classification } from "../classify.js";
import { isTerminal, type RecoveryAction } from "../taxonomy.js";
import {
  daysSinceSalary,
  isBankDown,
  merchantMandateRecord,
  MONTH_DAYS,
  type DowntimeSchedule,
  type LatentFailure,
} from "../simulator/population.js";
import {
  BALANCE_CURVE,
  IRREGULAR_INCOME_MODEL,
  RESPONSE,
  RESPONSIVENESS,
  SIM,
} from "../simulator/params.js";
import { decide as ledgerDecide, type Decision } from "./engine.js";
import type { TimingEstimator } from "./timing.js";

export interface OracleView {
  readonly failure: LatentFailure;
  readonly downtime: DowntimeSchedule;
}

export interface PolicyContext {
  readonly row: LedgerRow;
  readonly classification: Classification;
  readonly estimator: TimingEstimator;

  readonly attemptsSpent: number;

  readonly retriesSpent: number;
  readonly nudgesSent: number;

  readonly oracle: OracleView | null;
}

export interface Policy {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  readonly usesOracle: boolean;
  decide(ctx: PolicyContext): Decision;
}

const stop = (rationale: string, winBack = false): Decision => ({
  action: { kind: "ABANDON", winBack },
  dayOffset: 0,
  rationale,
});

const retryAt = (offset: number, p: number, rationale: string): Decision => ({
  action: { kind: "RETRY_AT", dayOffset: offset, expectedSuccess: p },
  dayOffset: offset,
  rationale,
});

export const B0_NONE: Policy = {
  id: "B0",
  name: "No recovery",
  description:
    "Gives up on every failed payment. Shows how much money walks away when nobody chases it.",
  usesOracle: false,
  decide: () => stop("No recovery attempted."),
};

export const FIXED_SCHEDULE: readonly number[] = [1, 3, 5];

export const B1_FIXED: Policy = {
  id: "B1",
  name: "Fixed retry (days 1/3/5)",
  description:
    "Retries every failure on days 1, 3 and 5, no questions asked. This is what " +
    "most billing systems actually do.",
  usesOracle: false,
  decide: (ctx) => {
    const offset = FIXED_SCHEDULE[ctx.retriesSpent];
    if (offset === undefined) {
      return stop("Schedule exhausted after 3 retries.");
    }
    return retryAt(
      offset,
      0,
      `Fixed schedule: retry ${ctx.retriesSpent + 1} of ${FIXED_SCHEDULE.length}, on day +${offset}.`,
    );
  },
};

export const BACKOFF_SCHEDULE: readonly number[] = [1, 2, 4, 8];

export const B2_BACKOFF: Policy = {
  id: "B2",
  name: "Exponential backoff",
  description:
    "Retries with growing gaps: days 1, 2, 4, 8. A little smarter about glitches, " +
    "still blind to why the payment failed.",
  usesOracle: false,
  decide: (ctx) => {
    const offset = BACKOFF_SCHEDULE[ctx.retriesSpent];
    if (offset === undefined) {
      return stop("Backoff schedule exhausted after 4 retries.");
    }
    return retryAt(
      offset,
      0,
      `Exponential backoff: retry ${ctx.retriesSpent + 1} at +${offset}d.`,
    );
  },
};

export const B2T_TIMED: Policy = {
  id: "B2T",
  name: "Smart timing, cause-blind",
  description:
    "Retries at the smartest possible moments, using the same timing brain this " +
    "project uses, but never asks why a payment failed. A stand-in for commercial " +
    "smart-retry products.",
  usesOracle: false,
  decide: (ctx) => {
    if (ctx.retriesSpent >= 4) {
      return stop("Timed schedule exhausted after 4 retries.");
    }
    const ranked: { offset: number; p: number }[] = [];
    for (let offset = 1; offset <= 14; offset++) {
      if (ctx.row.failedOnDay + offset > SIM.HORIZON_DAYS) break;
      const dom = ((ctx.row.failedOnDay + offset) % MONTH_DAYS) + 1;
      ranked.push({
        offset,
        p: ctx.estimator.probability("INSUFFICIENT_FUNDS", ctx.row.segment, dom),
      });
    }
    ranked.sort((a, b) => b.p - a.p || a.offset - b.offset);
    const pick = ranked[ctx.retriesSpent];
    if (!pick) {
      return stop("No retry window remains before the horizon.");
    }
    return retryAt(
      pick.offset,
      pick.p,
      `Timed retry ${ctx.retriesSpent + 1} of 4 at +${pick.offset}d, the best remaining window for this segment.`,
    );
  },
};

export const B3_LEDGER: Policy = {
  id: "B3",
  name: "Recovery Ledger",
  description:
    "This project. Finds out why each payment failed, picks the one fix that can " +
    "actually work, and walks away when nothing can.",
  usesOracle: false,
  decide: (ctx) =>

    ledgerDecide({
      row: ctx.row,
      classification: ctx.classification,
      estimator: ctx.estimator,
      attemptsSpent: ctx.attemptsSpent,
      nudgesSent: ctx.nudgesSent,
    }),
};

function truePFunds(failure: LatentFailure, day: number): number {
  const c = failure.customer;
  if (c.salaryDay < 0) {
    return Math.min(1, IRREGULAR_INCOME_MODEL.BASE_P_FUNDS * c.affluence);
  }
  const offset = daysSinceSalary(c, day);
  const base = BALANCE_CURVE[Math.min(offset, BALANCE_CURVE.length - 1)]!;
  return Math.min(1, base * c.affluence);
}

function isSoftDoNotHonour(failure: LatentFailure): boolean {
  const id = failure.customer.id;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 10000) / 10000 < RESPONSE.DO_NOT_HONOUR_SOFT_SHARE;
}

export const B4_ORACLE: Policy = {
  id: "B4",
  name: "Oracle (ceiling)",
  description:
    "A cheat. It can see things no real system can know, like the customer's true " +
    "bank balance and payday, so it marks the practical upper limit.",
  usesOracle: true,
  decide: (ctx) => {
    if (!ctx.oracle) {
      throw new Error("B4_ORACLE requires an OracleView; the runner did not supply one");
    }
    const { failure, downtime } = ctx.oracle;
    const c = failure.customer;
    const cause = failure.trueCause;
    const start = ctx.row.failedOnDay;

    const budgetLeft = SIM.MAX_ATTEMPTS - ctx.attemptsSpent;
    if (budgetLeft <= 0) {
      return stop("Oracle: attempt budget exhausted.", true);
    }

    const WORTH_IT = 0.04;

    if (cause.kind === "MANDATE_REVOKED" || cause.kind === "RISK_BLOCKED") {
      return stop(`Oracle: ${cause.kind} is unrecoverable. Spending nothing.`, true);
    }

    const nudgeP = (factor: number) =>
      c.responsiveness * factor * RESPONSIVENESS.REPEAT_NUDGE_DECAY ** ctx.nudgesSent;

    if (cause.kind === "MANDATE_EXPIRED") {
      const p = nudgeP(RESPONSE.MANDATE_RENEWAL_FACTOR);
      if (p < WORTH_IT) {
        return stop(
          `Oracle: renewal odds have decayed to ${(p * 100).toFixed(0)}%. Not worth another ask.`,
          true,
        );
      }
      return {
        action: { kind: "REQUEST_MANDATE_RENEWAL", channel: "sms" },
        dayOffset: 1,
        rationale: `Oracle: true responsiveness ${(c.responsiveness * 100).toFixed(0)}%, so this ask lands with p=${(p * 100).toFixed(0)}%.`,
      };
    }

    if (cause.kind === "CARD_EXPIRED") {
      const p = nudgeP(RESPONSE.INSTRUMENT_UPDATE_FACTOR);
      if (p < WORTH_IT) {
        return stop(
          `Oracle: instrument-update odds have decayed to ${(p * 100).toFixed(0)}%.`,
          true,
        );
      }
      return {
        action: { kind: "REQUEST_INSTRUMENT_UPDATE", channel: "sms" },
        dayOffset: 1,
        rationale: `Oracle: true responsiveness ${(c.responsiveness * 100).toFixed(0)}%, so this ask lands with p=${(p * 100).toFixed(0)}%.`,
      };
    }

    if (cause.kind === "MANDATE_AMOUNT_EXCEEDED") {
      const needed = Math.ceil(cause.attemptedPaise / cause.capPaise);
      if (needed > RESPONSE.SPLIT_MAX_PARTS) {
        return stop("Oracle: no split fits under the cap.", true);
      }
      const parts = Math.max(2, needed);

      if (budgetLeft < parts) {
        return stop("Oracle: not enough budget left to present a full split.", true);
      }
      if (ctx.retriesSpent >= 3) {
        return stop("Oracle: splits already attempted and rejected.", true);
      }
      return {
        action: {
          kind: "SPLIT_AMOUNT",
          parts,
          perPartPaise: Math.ceil(cause.attemptedPaise / parts),
        },
        dayOffset: 1,
        rationale: `Oracle: splitting into ${parts} parts is the only presentment that clears the cap.`,
      };
    }

    if (cause.kind === "PRE_DEBIT_NOTICE_FAILED") {
      if (ctx.nudgesSent >= 3) {
        return stop("Oracle: notice re-sent three times without landing.", true);
      }
      return {
        action: {
          kind: "RESEND_NOTICE",
          channel: "sms",
          retryDayOffset: 1 + RESPONSE.NOTICE_MIN_RETRY_DELAY_DAYS,
        },
        dayOffset: 1,
        rationale: "Oracle: re-sending the notice restores eligibility.",
      };
    }

    if (cause.kind === "ISSUER_DOWNTIME") {
      const firstOffset = 1 + ctx.retriesSpent;
      for (let offset = firstOffset; offset <= 12; offset++) {
        const day = start + offset;
        if (day > SIM.HORIZON_DAYS) break;
        if (!isBankDown(downtime, c.issuerBank, day)) {
          return retryAt(offset, 1, `Oracle: ${c.issuerBank} is back up on day ${day}.`);
        }
      }
      return stop("Oracle: outage outlasts the horizon.", true);
    }

    if (cause.kind === "TECHNICAL_DECLINE") {
      const p =
        RESPONSE.TECHNICAL_DECLINE_RETRY_SUCCESS *
        RESPONSE.TECHNICAL_DECLINE_DECAY ** ctx.retriesSpent;
      if (p < WORTH_IT) {
        return stop("Oracle: retry odds have decayed; not actually transient.", true);
      }
      return retryAt(
        1 + ctx.retriesSpent,
        p,
        `Oracle: transient fault, retry worth ${(p * 100).toFixed(0)}%.`,
      );
    }

    if (cause.kind === "DO_NOT_HONOUR") {
      if (!isSoftDoNotHonour(failure)) {
        return stop("Oracle: hard refusal. No retry can clear it.", true);
      }
      const p =
        RESPONSE.DO_NOT_HONOUR_SOFT_RETRY_SUCCESS *
        RESPONSE.TECHNICAL_DECLINE_DECAY ** ctx.retriesSpent;
      if (p < WORTH_IT) {
        return stop("Oracle: soft refusal did not clear and odds have decayed.", true);
      }
      return retryAt(
        2 + ctx.retriesSpent,
        p,
        `Oracle: soft refusal, retry worth ${(p * 100).toFixed(0)}%.`,
      );
    }

    const ranked: { offset: number; p: number }[] = [];
    for (let offset = 1; offset <= 20; offset++) {
      const day = start + offset;
      if (day > SIM.HORIZON_DAYS) break;
      if (day >= c.mandateExpiryDay) break;
      if (c.revokedOnDay !== null && day >= c.revokedOnDay) break;
      ranked.push({ offset, p: truePFunds(failure, day) });
    }
    ranked.sort((a, b) => b.p - a.p || a.offset - b.offset);

    const pick = ranked[ctx.retriesSpent];
    if (!pick || pick.p < WORTH_IT) {
      return stop("Oracle: no window with a worthwhile balance remains.", true);
    }
    return retryAt(
      pick.offset,
      pick.p,
      `Oracle: true P(funds) is ${(pick.p * 100).toFixed(0)}% on day ${start + pick.offset}, the best window left.`,
    );
  },
};

export const ALL_POLICIES: readonly Policy[] = [
  B0_NONE,
  B1_FIXED,
  B2_BACKOFF,
  B2T_TIMED,
  B3_LEDGER,
  B4_ORACLE,
];

export function policyById(id: string): Policy {
  const p = ALL_POLICIES.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown policy "${id}"`);
  return p;
}

export { merchantMandateRecord, isTerminal };
export type { RecoveryAction };
