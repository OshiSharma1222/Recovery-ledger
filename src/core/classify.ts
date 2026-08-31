import type { LedgerRow } from "./ledger.js";
import {
  assertNever,
  type RawReasonCode,
  type RootCause,
} from "./taxonomy.js";

export interface MandateContext {
  readonly capPaise: number;

  readonly expiryDay: number;

  readonly instrumentExpiryDay: number | null;
}

export interface ClassificationContext {
  readonly row: LedgerRow;
  readonly mandate: MandateContext;

  readonly issuerDegraded: boolean;
}

export interface Classification {
  readonly cause: RootCause;

  readonly confidence: number;

  readonly evidence: readonly string[];
}

type Resolver = (ctx: ClassificationContext) => Classification;

const cause = (
  c: RootCause,
  confidence: number,
  ...evidence: string[]
): Classification => ({ cause: c, confidence, evidence });

function mandateHasExpired(ctx: ClassificationContext): boolean {
  return ctx.row.failedOnDay >= ctx.mandate.expiryDay;
}

function exceedsCap(ctx: ClassificationContext): boolean {
  return ctx.row.amountPaise > ctx.mandate.capPaise;
}

function instrumentHasExpired(ctx: ClassificationContext): boolean {
  const e = ctx.mandate.instrumentExpiryDay;
  return e !== null && ctx.row.failedOnDay >= e;
}

const expired = (ctx: ClassificationContext, conf: number, why: string) =>
  cause(
    { kind: "MANDATE_EXPIRED", expiredOnDay: ctx.mandate.expiryDay },
    conf,
    why,
    `mandate expiry day ${ctx.mandate.expiryDay} <= failure day ${ctx.row.failedOnDay}`,
  );

const capped = (ctx: ClassificationContext, conf: number, why: string) =>
  cause(
    {
      kind: "MANDATE_AMOUNT_EXCEEDED",
      capPaise: ctx.mandate.capPaise,
      attemptedPaise: ctx.row.amountPaise,
    },
    conf,
    why,
    `presented ${ctx.row.amountPaise}p against cap ${ctx.mandate.capPaise}p`,
  );

const downtime = (ctx: ClassificationContext, conf: number, why: string) =>
  cause(
    { kind: "ISSUER_DOWNTIME", issuerBank: ctx.row.issuerBank },
    ctx.issuerDegraded ? Math.min(1, conf + 0.1) : conf,
    why,
    ctx.issuerDegraded
      ? `downtime feed confirms ${ctx.row.issuerBank} degraded`
      : `downtime feed shows no ${ctx.row.issuerBank} incident; code taken at face value`,
  );

const RULES: Record<RawReasonCode, Resolver> = {
  insufficient_funds: () =>
    cause({ kind: "INSUFFICIENT_FUNDS" }, 0.97, "gateway named the cause directly"),

  mandate_not_active: (ctx) =>
    mandateHasExpired(ctx)
      ? expired(ctx, 0.94, "mandate inactive and our own record shows it lapsed")
      : cause(
          { kind: "MANDATE_REVOKED" },
          0.82,
          "mandate inactive but not yet expired on our record",
          "customer-side revocation is the remaining explanation",
        ),
  mandate_creation_expired: (ctx) =>
    expired(ctx, 0.9, "gateway reports the mandate registration expired"),

  mandate_creation_declined: (ctx) =>
    expired(ctx, 0.7, "mandate registration was declined; no live mandate exists"),
  mandate_creation_failed: (ctx) =>
    expired(ctx, 0.7, "mandate registration failed; no live mandate exists"),
  mandate_creation_timeout: (ctx) =>
    expired(ctx, 0.65, "mandate registration timed out; no live mandate exists"),

  reqauth_mandate_not_acknowledged: () =>
    cause(
      { kind: "PRE_DEBIT_NOTICE_FAILED" },
      0.91,
      "pre-debit authorisation was never acknowledged",
      "RBI requires notice at least 24h before the debit",
    ),
  payment_mandate_not_active: () =>
    cause(
      { kind: "PRE_DEBIT_NOTICE_FAILED" },
      0.72,
      "mandate registered but not yet active at the bank for this debit",
    ),

  transaction_limit_exceeded: (ctx) =>
    exceedsCap(ctx)
      ? capped(ctx, 0.96, "amount exceeds the cap on our own mandate record")
      : capped(ctx, 0.74, "within our cap, so the bank's own per-txn limit binds"),
  invalid_amount: (ctx) =>
    exceedsCap(ctx)
      ? capped(ctx, 0.88, "amount rejected and it exceeds our authorised cap")
      : cause(
          { kind: "TECHNICAL_DECLINE" },
          0.6,
          "amount rejected but sits within the cap; likely a request defect",
        ),
  mcc_amount_limit_exceeded: (ctx) =>
    capped(ctx, 0.85, "merchant-category amount limit exceeded"),
  transaction_daily_limit_exceeded: (ctx) =>
    capped(ctx, 0.78, "customer's daily debit limit exceeded; splitting may clear it"),
  amount_less_than_minimum_amount: () =>
    cause({ kind: "TECHNICAL_DECLINE" }, 0.8, "amount below the gateway minimum"),

  transaction_daily_count_exceeded: () =>
    cause({ kind: "TECHNICAL_DECLINE" }, 0.76, "daily transaction count exhausted; a later day clears it"),
  transaction_frequency_limit_exceeded: () =>
    cause({ kind: "TECHNICAL_DECLINE" }, 0.76, "NPCI frequency limit exhausted; a later day clears it"),

  card_expired: () => cause({ kind: "CARD_EXPIRED" }, 0.98, "card past expiry"),
  incorrect_card_expiry_date: () =>
    cause({ kind: "CARD_EXPIRED" }, 0.8, "expiry date rejected; stored card is stale"),
  card_number_invalid: () =>
    cause({ kind: "CARD_EXPIRED" }, 0.75, "stored card number no longer valid"),

  bank_account_invalid: () =>
    cause({ kind: "CARD_EXPIRED" }, 0.85, "bank account closed or invalid; new instrument needed"),
  incorrect_ifsc: () =>
    cause({ kind: "CARD_EXPIRED" }, 0.82, "IFSC no longer valid; account details must be re-collected"),
  debit_instrument_inactive: () =>
    cause({ kind: "CARD_EXPIRED" }, 0.7, "instrument marked inactive by the issuer"),

  payment_cancelled: () =>
    cause(
      { kind: "MANDATE_REVOKED" },
      0.86,
      "customer cancelled the debit at their bank or PSP",
    ),
  debit_instrument_blocked: () =>
    cause({ kind: "MANDATE_REVOKED" }, 0.74, "instrument blocked; debits will not clear"),
  transaction_on_vpa_restricted: () =>
    cause({ kind: "MANDATE_REVOKED" }, 0.78, "transactions on this VPA are restricted"),

  bank_technical_error: (ctx) => downtime(ctx, 0.84, "issuing bank reported a technical error"),
  bank_not_available: (ctx) => downtime(ctx, 0.9, "issuing bank unavailable"),
  issuer_technical_error: (ctx) => downtime(ctx, 0.87, "card issuer reported a technical error"),
  psp_not_available: (ctx) => downtime(ctx, 0.86, "PSP unavailable"),
  psp_app_not_available: (ctx) => downtime(ctx, 0.83, "customer's PSP app unavailable"),
  upi_app_technical_error: (ctx) => downtime(ctx, 0.78, "technical error at the customer's PSP"),

  bank_cutoff_in_progress: (ctx) =>
    downtime(ctx, 0.92, "core banking cutoff window in progress"),
  payment_declined_due_to_high_traffic: (ctx) =>
    downtime(ctx, 0.8, "gateway shed load under traffic"),

  gateway_technical_error: () =>
    cause({ kind: "TECHNICAL_DECLINE" }, 0.85, "technical error at the gateway"),
  server_error: () =>
    cause({ kind: "TECHNICAL_DECLINE" }, 0.88, "technical error at Razorpay"),
  payment_timed_out: () =>
    cause({ kind: "TECHNICAL_DECLINE" }, 0.8, "debit not completed in the allowed window"),
  request_timed_out: () =>
    cause({ kind: "TECHNICAL_DECLINE" }, 0.82, "request timed out"),
  invalid_response_from_gateway: () =>
    cause({ kind: "TECHNICAL_DECLINE" }, 0.83, "malformed gateway response"),
  duplicate_request: () =>
    cause({ kind: "TECHNICAL_DECLINE" }, 0.7, "duplicate submission; re-present after a pause"),
  input_validation_failed: () =>
    cause(
      { kind: "TECHNICAL_DECLINE" },
      0.55,
      "request rejected on validation; cause is genuinely unclear from the code alone",
    ),

  payment_declined: (ctx) =>
    exceedsCap(ctx)
      ? capped(ctx, 0.8, "declined, and the amount exceeds our authorised cap")
      : cause(
          { kind: "DO_NOT_HONOUR" },
          0.52,
          "issuer declined without a machine-readable reason",
          "no cap breach or expiry on our record explains it",
        ),
  payment_failed: (ctx) =>
    mandateHasExpired(ctx)
      ? expired(ctx, 0.86, "generic failure, and our record shows the mandate lapsed")
      : cause(
          { kind: "DO_NOT_HONOUR" },
          0.48,
          "generic failure with no corroborating merchant-side signal",
        ),
  debit_declined: (ctx) =>
    exceedsCap(ctx)
      ? capped(ctx, 0.78, "debit declined and the amount exceeds our cap")
      : cause({ kind: "DO_NOT_HONOUR" }, 0.58, "debit declined by the issuer"),
  card_declined: (ctx) =>
    instrumentHasExpired(ctx)
      ? cause({ kind: "CARD_EXPIRED" }, 0.88, "card declined and our record shows it expired")
      : cause({ kind: "DO_NOT_HONOUR" }, 0.55, "card declined without a specific reason"),

  payment_risk_check_failed: () =>
    cause(
      { kind: "RISK_BLOCKED" },
      0.95,
      "blocked by risk checks",
      "must not be retried; re-presenting a risk-blocked debit is its own problem",
    ),
  compliance_violation: () =>
    cause({ kind: "RISK_BLOCKED" }, 0.93, "blocked on compliance grounds"),
};

export function classify(ctx: ClassificationContext): Classification {
  const rule = RULES[ctx.row.rawCode as RawReasonCode] as Resolver | undefined;
  if (!rule) {
    return cause(
      { kind: "DO_NOT_HONOUR" },
      0.25,
      `unrecognised reason code "${ctx.row.rawCode}"`,
      "treated as ambiguous rather than forced into a bucket",
    );
  }
  return rule(ctx);
}

export function describeCause(c: RootCause): string {
  switch (c.kind) {
    case "INSUFFICIENT_FUNDS":
      return "The account did not hold enough to cover the debit.";
    case "MANDATE_EXPIRED":
      return `The mandate lapsed on day ${c.expiredOnDay}. No debit will clear until it is renewed.`;
    case "MANDATE_AMOUNT_EXCEEDED":
      return `The debit exceeded the authorised cap by ${c.attemptedPaise - c.capPaise} paise. Re-presenting the same amount fails by construction.`;
    case "MANDATE_REVOKED":
      return "The customer revoked the mandate. Continuing to debit is not an option.";
    case "CARD_EXPIRED":
      return "The stored instrument is no longer valid and must be replaced.";
    case "PRE_DEBIT_NOTICE_FAILED":
      return "The RBI-mandated pre-debit notification did not land, so the debit was not eligible.";
    case "ISSUER_DOWNTIME":
      return `${c.issuerBank} was degraded at debit time. This clears on its own.`;
    case "TECHNICAL_DECLINE":
      return "A transient technical fault. Re-presenting shortly usually clears it.";
    case "DO_NOT_HONOUR":
      return "The issuer refused without giving a reason. Genuinely ambiguous.";
    case "RISK_BLOCKED":
      return "Blocked by risk or compliance. Must not be retried.";
    default:
      return assertNever(c, "describeCause");
  }
}
