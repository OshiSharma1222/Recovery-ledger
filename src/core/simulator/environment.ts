import { RESPONSE, RESPONSIVENESS, SIM } from "./params.js";
import { Rng, clamp01 } from "./rng.js";
import {
  daysSinceSalary,
  isBankDown,
  pSufficientFunds,
  type Customer,
  type DowntimeSchedule,
  type LatentFailure,
} from "./population.js";
import { assertNever, type RecoveryAction } from "../taxonomy.js";

export interface Outcome {
  readonly recovered: boolean;

  readonly recoveredOnDay: number | null;

  readonly attemptsUsed: number;

  readonly nudgesUsed: number;

  readonly note: string;
}

const fail = (attempts: number, nudges: number, note: string): Outcome => ({
  recovered: false,
  recoveredOnDay: null,
  attemptsUsed: attempts,
  nudgesUsed: nudges,
  note,
});

const win = (day: number, attempts: number, nudges: number, note: string): Outcome => ({
  recovered: true,
  recoveredOnDay: day,
  attemptsUsed: attempts,
  nudgesUsed: nudges,
  note,
});

export interface EnvironmentContext {
  readonly failure: LatentFailure;
  readonly downtime: DowntimeSchedule;

  readonly priorNudges: number;

  readonly priorAttempts: number;
}

function wouldDebitClear(
  ctx: EnvironmentContext,
  day: number,
  rng: Rng,
): { cleared: boolean; note: string } {
  const { failure, downtime } = ctx;
  const c = failure.customer;
  const cause = failure.trueCause;

  if (c.revokedOnDay !== null && day >= c.revokedOnDay) {
    return { cleared: false, note: "mandate revoked" };
  }
  if (day >= c.mandateExpiryDay) {
    return { cleared: false, note: "mandate expired" };
  }
  if (c.cardExpiryDay !== null && day >= c.cardExpiryDay) {
    return { cleared: false, note: "instrument expired" };
  }

  switch (cause.kind) {
    case "MANDATE_EXPIRED":
    case "MANDATE_REVOKED":
    case "CARD_EXPIRED":
    case "RISK_BLOCKED":
      return { cleared: false, note: `${cause.kind} is terminal; retrying cannot work` };

    case "MANDATE_AMOUNT_EXCEEDED":

      return {
        cleared: false,
        note: "amount still exceeds the mandate cap; identical presentment cannot clear",
      };

    case "ISSUER_DOWNTIME": {
      if (isBankDown(downtime, c.issuerBank, day)) {
        return { cleared: false, note: `${c.issuerBank} still degraded on day ${day}` };
      }
      const elapsed = Math.max(0, day - failure.failedOnDay);
      const table = RESPONSE.ISSUER_DOWNTIME_RECOVERY_BY_DAY;
      const p = table[Math.min(elapsed, table.length - 1)]!;
      return {
        cleared: rng.bool(p),
        note: `outage cleared; re-presented ${elapsed}d later at p=${p.toFixed(2)}`,
      };
    }

    case "TECHNICAL_DECLINE": {
      const p =
        RESPONSE.TECHNICAL_DECLINE_RETRY_SUCCESS *
        RESPONSE.TECHNICAL_DECLINE_DECAY ** ctx.priorAttempts;
      return { cleared: rng.bool(clamp01(p)), note: `transient fault, p=${p.toFixed(2)}` };
    }

    case "PRE_DEBIT_NOTICE_FAILED":

      return {
        cleared: false,
        note: "pre-debit notice still not delivered; debit remains ineligible",
      };

    case "DO_NOT_HONOUR": {
      const isSoft = softDoNotHonour(c);
      if (!isSoft) {
        return { cleared: false, note: "hard issuer refusal; retries cannot clear it" };
      }
      const p =
        RESPONSE.DO_NOT_HONOUR_SOFT_RETRY_SUCCESS *
        RESPONSE.TECHNICAL_DECLINE_DECAY ** ctx.priorAttempts;
      return { cleared: rng.bool(clamp01(p)), note: `soft refusal, p=${p.toFixed(2)}` };
    }

    case "INSUFFICIENT_FUNDS": {
      const p = pSufficientFunds(c, day, rng);
      const since = daysSinceSalary(c, day);
      return {
        cleared: rng.bool(p),
        note:
          since < 0
            ? `irregular earner, p(funds)=${p.toFixed(2)}`
            : `${since}d after payday, p(funds)=${p.toFixed(2)}`,
      };
    }

    default:
      return assertNever(cause, "wouldDebitClear");
  }
}

function softDoNotHonour(c: Customer): boolean {
  let h = 0;
  for (let i = 0; i < c.id.length; i++) {
    h = (Math.imul(h, 31) + c.id.charCodeAt(i)) | 0;
  }
  const unit = ((h >>> 0) % 10000) / 10000;
  return unit < RESPONSE.DO_NOT_HONOUR_SOFT_SHARE;
}

function nudgeSuccessProbability(
  c: Customer,
  factor: number,
  priorNudges: number,
): number {
  return clamp01(
    c.responsiveness * factor * RESPONSIVENESS.REPEAT_NUDGE_DECAY ** priorNudges,
  );
}

export function resolveAction(
  ctx: EnvironmentContext,
  action: RecoveryAction,
  rng: Rng,
): Outcome {
  const c = ctx.failure.customer;
  const horizonEnd = SIM.HORIZON_DAYS;

  switch (action.kind) {
    case "RETRY_AT": {
      const day = ctx.failure.failedOnDay + action.dayOffset;
      if (day > horizonEnd) return fail(0, 0, "retry scheduled beyond the horizon");
      const { cleared, note } = wouldDebitClear(ctx, day, rng);
      return cleared
        ? win(day, 1, 0, `retry on day ${day} cleared: ${note}`)
        : fail(1, 0, `retry on day ${day} failed: ${note}`);
    }

    case "SPLIT_AMOUNT": {
      const day = ctx.failure.failedOnDay + 1;
      if (day > horizonEnd) return fail(0, 0, "split scheduled beyond the horizon");
      if (action.perPartPaise > c.mandateCapPaise) {
        return fail(
          action.parts,
          0,
          `each part is still above the cap; split cannot clear`,
        );
      }
      if (ctx.failure.trueCause.kind !== "MANDATE_AMOUNT_EXCEEDED") {
        const { note } = wouldDebitClear(ctx, day, rng);
        return fail(action.parts, 0, `split applied to a non-cap failure: ${note}`);
      }
      if (!rng.bool(RESPONSE.SPLIT_ACCEPTANCE)) {
        return fail(action.parts, 0, "customer or bank rejected partial collection");
      }

      const pFunds = pSufficientFunds(c, day, rng);
      return rng.bool(pFunds)
        ? win(day, action.parts, 0, `split into ${action.parts} parts under the cap and cleared`)
        : fail(action.parts, 0, "split cleared the cap but the balance was short");
    }

    case "RESEND_NOTICE": {
      const noticeDay = ctx.failure.failedOnDay + 1;
      const retryDay = ctx.failure.failedOnDay + action.retryDayOffset;

      if (retryDay - noticeDay < RESPONSE.NOTICE_MIN_RETRY_DELAY_DAYS - 1) {
        return fail(1, 1, "re-presented before the 24h notice window elapsed");
      }
      if (retryDay > horizonEnd) return fail(0, 1, "retry scheduled beyond the horizon");
      if (!rng.bool(RESPONSE.NOTICE_REDELIVERY_SUCCESS)) {
        return fail(0, 1, "pre-debit notice failed to deliver a second time");
      }

      if (ctx.failure.trueCause.kind === "PRE_DEBIT_NOTICE_FAILED") {
        const pFunds = pSufficientFunds(c, retryDay, rng);
        return rng.bool(pFunds)
          ? win(retryDay, 1, 1, `notice re-delivered, debit cleared on day ${retryDay}`)
          : fail(1, 1, "notice re-delivered but the balance was short");
      }
      const { cleared, note } = wouldDebitClear(ctx, retryDay, rng);
      return cleared
        ? win(retryDay, 1, 1, `notice re-sent and debit cleared: ${note}`)
        : fail(1, 1, `notice was not the problem: ${note}`);
    }

    case "REQUEST_MANDATE_RENEWAL": {
      const p = nudgeSuccessProbability(
        c,
        RESPONSE.MANDATE_RENEWAL_FACTOR,
        ctx.priorNudges,
      );
      if (!rng.bool(p)) {
        return fail(0, 1, `customer did not renew the mandate (p=${p.toFixed(2)})`);
      }
      const day = ctx.failure.failedOnDay + RESPONSE.NUDGE_FULFILMENT_DELAY_DAYS;
      if (day > horizonEnd) return fail(0, 1, "renewal landed beyond the horizon");

      const pFunds = pSufficientFunds(c, day, rng);
      return rng.bool(pFunds)
        ? win(day, 1, 1, `customer renewed the mandate and the debit cleared on day ${day}`)
        : fail(1, 1, "mandate renewed but the debit still bounced on balance");
    }

    case "REQUEST_INSTRUMENT_UPDATE": {
      const p = nudgeSuccessProbability(
        c,
        RESPONSE.INSTRUMENT_UPDATE_FACTOR,
        ctx.priorNudges,
      );
      if (!rng.bool(p)) {
        return fail(0, 1, `customer did not update their instrument (p=${p.toFixed(2)})`);
      }
      const day = ctx.failure.failedOnDay + RESPONSE.NUDGE_FULFILMENT_DELAY_DAYS;
      if (day > horizonEnd) return fail(0, 1, "instrument update landed beyond the horizon");
      const pFunds = pSufficientFunds(c, day, rng);
      return rng.bool(pFunds)
        ? win(day, 1, 1, `new instrument supplied and the debit cleared on day ${day}`)
        : fail(1, 1, "instrument updated but the debit still bounced on balance");
    }

    case "ESCALATE": {
      const day = Math.min(ctx.failure.failedOnDay + 5, horizonEnd);
      return rng.bool(RESPONSE.ESCALATION_SUCCESS)
        ? win(day, 0, 1, "collections contact recovered the amount")
        : fail(0, 1, "collections contact did not recover the amount");
    }

    case "ABANDON":

      return fail(0, 0, action.winBack ? "abandoned, flagged for win-back" : "abandoned");

    default:
      return assertNever(action, "resolveAction");
  }
}
