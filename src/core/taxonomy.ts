/**
 * Failure taxonomy for the Recovery Ledger.
 *
 * Three layers, deliberately kept separate:
 *
 *   1. RAW      - reason code strings exactly as Razorpay returns them.
 *                 Not invented. See docs/RESEARCH.md for sources.
 *   2. CAUSE    - the classified root cause. A discriminated union so the
 *                 compiler can prove every cause has a recovery action.
 *   3. ACTION   - what we do about it, including the ABANDON action that
 *                 fixed-schedule dunning has no concept of.
 *
 * The `never` exhaustiveness check at the bottom is the load-bearing part:
 * adding a RootCause without giving it a RecoveryAction is a build error,
 * not a production incident.
 */

// ---------------------------------------------------------------------------
// Layer 1: raw reason codes (real Razorpay strings)
// ---------------------------------------------------------------------------

/**
 * Reason codes Razorpay documents for recurring / e-mandate subsequent debits
 * and for the underlying payment. These are the strings that actually arrive
 * on a failed debit webhook, so they are the input to the classifier.
 *
 * Source: Razorpay "Handle Errors" (e-mandate), "List of Errors" (payments),
 * "UPI Error Codes". Captured 2026-08-30, see docs/RESEARCH.md.
 */
export const RAW_REASON_CODES = [
  // --- balance ---
  "insufficient_funds",

  // --- mandate lifecycle ---
  "mandate_not_active",
  "payment_mandate_not_active",
  "mandate_creation_declined",
  "mandate_creation_expired",
  "mandate_creation_failed",
  "mandate_creation_timeout",
  "reqauth_mandate_not_acknowledged",

  // --- amount / limit caps ---
  "invalid_amount",
  "transaction_limit_exceeded",
  "transaction_daily_limit_exceeded",
  "transaction_daily_count_exceeded",
  "transaction_frequency_limit_exceeded",
  "mcc_amount_limit_exceeded",
  "amount_less_than_minimum_amount",

  // --- instrument validity ---
  "card_expired",
  "incorrect_card_expiry_date",
  "card_number_invalid",
  "bank_account_invalid",
  "incorrect_ifsc",
  "debit_instrument_inactive",

  // --- customer revoked / blocked ---
  "debit_instrument_blocked",
  "payment_cancelled",
  "transaction_on_vpa_restricted",

  // --- issuer / network downtime ---
  "bank_technical_error",
  "bank_not_available",
  "bank_cutoff_in_progress",
  "issuer_technical_error",
  "gateway_technical_error",
  "psp_not_available",
  "psp_app_not_available",
  "upi_app_technical_error",
  "payment_declined_due_to_high_traffic",

  // --- transient technical ---
  "server_error",
  "payment_timed_out",
  "request_timed_out",
  "invalid_response_from_gateway",
  "duplicate_request",
  "input_validation_failed",

  // --- ambiguous issuer decline ---
  "payment_declined",
  "payment_failed",
  "debit_declined",
  "card_declined",

  // --- risk ---
  "payment_risk_check_failed",
  "compliance_violation",
] as const;

export type RawReasonCode = (typeof RAW_REASON_CODES)[number];

// ---------------------------------------------------------------------------
// Layer 2: root causes
// ---------------------------------------------------------------------------

/**
 * Root cause of a failed recurring debit.
 *
 * Each variant carries the evidence the policy engine needs to act, which is
 * why this is a union of objects and not a string enum. `MANDATE_AMOUNT_EXCEEDED`
 * without the cap is not actionable; with the cap, SPLIT_AMOUNT is computable.
 */
export type RootCause =
  /** Balance was short at debit time. Retryable, and timing is everything. */
  | { readonly kind: "INSUFFICIENT_FUNDS" }
  /** Mandate passed its end date. No amount of retrying fixes this. */
  | { readonly kind: "MANDATE_EXPIRED"; readonly expiredOnDay: number }
  /**
   * Debit exceeded the per-mandate cap the customer authorised at registration.
   * Retrying the same amount fails forever by construction.
   */
  | {
      readonly kind: "MANDATE_AMOUNT_EXCEEDED";
      readonly capPaise: number;
      readonly attemptedPaise: number;
    }
  /** Customer revoked the mandate in their bank or PSP app. Terminal. */
  | { readonly kind: "MANDATE_REVOKED" }
  /** Card past expiry. Terminal until the customer supplies a new instrument. */
  | { readonly kind: "CARD_EXPIRED" }
  /**
   * RBI requires a pre-debit notification before each e-mandate debit.
   * If it did not land, the debit is not eligible. Fixable, then retryable.
   */
  | { readonly kind: "PRE_DEBIT_NOTICE_FAILED" }
  /** Issuer or PSP was down. Retryable soon, and the bank matters. */
  | { readonly kind: "ISSUER_DOWNTIME"; readonly issuerBank: string }
  /** Timeout, gateway hiccup, malformed response. Retry almost immediately. */
  | { readonly kind: "TECHNICAL_DECLINE" }
  /** Issuer said no without saying why. Genuinely ambiguous; retry a little. */
  | { readonly kind: "DO_NOT_HONOUR" }
  /** Risk or compliance block. Terminal, and must not be retried. */
  | { readonly kind: "RISK_BLOCKED" };

export type RootCauseKind = RootCause["kind"];

export const ROOT_CAUSE_KINDS = [
  "INSUFFICIENT_FUNDS",
  "MANDATE_EXPIRED",
  "MANDATE_AMOUNT_EXCEEDED",
  "MANDATE_REVOKED",
  "CARD_EXPIRED",
  "PRE_DEBIT_NOTICE_FAILED",
  "ISSUER_DOWNTIME",
  "TECHNICAL_DECLINE",
  "DO_NOT_HONOUR",
  "RISK_BLOCKED",
] as const satisfies readonly RootCauseKind[];

/**
 * Terminal causes can never be recovered by retrying the same debit.
 * Any attempt spent on one of these is, by definition, a wasted attempt --
 * which is the metric the benchmark uses to indict fixed-schedule dunning.
 */
export const TERMINAL_CAUSES = new Set<RootCauseKind>([
  "MANDATE_EXPIRED",
  "MANDATE_AMOUNT_EXCEEDED",
  "MANDATE_REVOKED",
  "CARD_EXPIRED",
  "RISK_BLOCKED",
]);

export function isTerminal(cause: RootCause): boolean {
  return TERMINAL_CAUSES.has(cause.kind);
}

// ---------------------------------------------------------------------------
// Layer 3: recovery actions
// ---------------------------------------------------------------------------

/** Channel used to reach a customer for the nudge-based actions. */
export type NudgeChannel = "sms" | "email" | "whatsapp" | "in_app";

/**
 * What the ledger decides to do about an at-risk row.
 *
 * `dayOffset` is days from the original failure, which keeps the whole engine
 * free of wall-clock time and therefore trivially reproducible.
 */
export type RecoveryAction =
  /** Re-present the same debit at a predicted-good moment. */
  | {
      readonly kind: "RETRY_AT";
      readonly dayOffset: number;
      readonly expectedSuccess: number;
    }
  /** Ask the customer to authorise a fresh mandate. */
  | { readonly kind: "REQUEST_MANDATE_RENEWAL"; readonly channel: NudgeChannel }
  /** Ask the customer for a new card / account. */
  | {
      readonly kind: "REQUEST_INSTRUMENT_UPDATE";
      readonly channel: NudgeChannel;
    }
  /** Debit under the cap across several presentments instead of one. */
  | {
      readonly kind: "SPLIT_AMOUNT";
      readonly parts: number;
      readonly perPartPaise: number;
    }
  /** Re-send the RBI pre-debit notification, then re-present. */
  | {
      readonly kind: "RESEND_NOTICE";
      readonly channel: NudgeChannel;
      readonly retryDayOffset: number;
    }
  /** Hand to a human / collections queue. Used sparingly. */
  | { readonly kind: "ESCALATE"; readonly note: string }
  /**
   * Stop spending attempts on this row. The point of the whole project.
   * `winBack` marks rows worth a marketing touch later rather than a debit.
   */
  | {
      readonly kind: "ABANDON";
      readonly winBack: boolean;
    };

export type RecoveryActionKind = RecoveryAction["kind"];

/** Actions that cost a debit attempt against the mandate. */
export const ATTEMPT_CONSUMING_ACTIONS = new Set<RecoveryActionKind>([
  "RETRY_AT",
  "SPLIT_AMOUNT",
]);

/** Actions that put a message in front of a customer (annoyance proxy). */
export const NUDGE_ACTIONS = new Set<RecoveryActionKind>([
  "REQUEST_MANDATE_RENEWAL",
  "REQUEST_INSTRUMENT_UPDATE",
  "RESEND_NOTICE",
]);

// ---------------------------------------------------------------------------
// Supporting domain types
// ---------------------------------------------------------------------------

/** How the recurring debit is collected. Failure mix differs sharply by type. */
export type InstrumentType = "CARD" | "UPI_AUTOPAY" | "NACH_EMANDATE";

export const INSTRUMENT_TYPES = [
  "CARD",
  "UPI_AUTOPAY",
  "NACH_EMANDATE",
] as const satisfies readonly InstrumentType[];

/**
 * Coarse customer segment the policy IS allowed to see. Deliberately coarser
 * than the simulator's latent state: the policy never sees `salaryDay`, it
 * sees a segment and has to learn the timing from observed outcomes.
 */
export type CustomerSegment =
  | "SALARY_EARLY_MONTH"
  | "SALARY_MID_MONTH"
  | "IRREGULAR_INCOME";

export const CUSTOMER_SEGMENTS = [
  "SALARY_EARLY_MONTH",
  "SALARY_MID_MONTH",
  "IRREGULAR_INCOME",
] as const satisfies readonly CustomerSegment[];

// ---------------------------------------------------------------------------
// Exhaustiveness
// ---------------------------------------------------------------------------

/**
 * Compile-time proof that a switch covered every variant.
 *
 * Call this in the `default` branch of a switch over a union. If a new variant
 * is added and left unhandled, `value` is no longer `never` and the build
 * fails. This is the guarantee section 6.1 of the plan is talking about, and
 * it is why the domain model is a union rather than a string enum.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(
    `${context}: unhandled variant ${JSON.stringify(value)}. ` +
      `This should have been caught at compile time.`,
  );
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * All money is integer paise, matching Razorpay's own API. Rupees only exist
 * at the display edge. No float arithmetic touches an amount anywhere.
 */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
