export const RAW_REASON_CODES = [
  "insufficient_funds",

  "mandate_not_active",
  "payment_mandate_not_active",
  "mandate_creation_declined",
  "mandate_creation_expired",
  "mandate_creation_failed",
  "mandate_creation_timeout",
  "reqauth_mandate_not_acknowledged",

  "invalid_amount",
  "transaction_limit_exceeded",
  "transaction_daily_limit_exceeded",
  "transaction_daily_count_exceeded",
  "transaction_frequency_limit_exceeded",
  "mcc_amount_limit_exceeded",
  "amount_less_than_minimum_amount",

  "card_expired",
  "incorrect_card_expiry_date",
  "card_number_invalid",
  "bank_account_invalid",
  "incorrect_ifsc",
  "debit_instrument_inactive",

  "debit_instrument_blocked",
  "payment_cancelled",
  "transaction_on_vpa_restricted",

  "bank_technical_error",
  "bank_not_available",
  "bank_cutoff_in_progress",
  "issuer_technical_error",
  "gateway_technical_error",
  "psp_not_available",
  "psp_app_not_available",
  "upi_app_technical_error",
  "payment_declined_due_to_high_traffic",

  "server_error",
  "payment_timed_out",
  "request_timed_out",
  "invalid_response_from_gateway",
  "duplicate_request",
  "input_validation_failed",

  "payment_declined",
  "payment_failed",
  "debit_declined",
  "card_declined",

  "payment_risk_check_failed",
  "compliance_violation",
] as const;

export type RawReasonCode = (typeof RAW_REASON_CODES)[number];

export type RootCause =

  | { readonly kind: "INSUFFICIENT_FUNDS" }

  | { readonly kind: "MANDATE_EXPIRED"; readonly expiredOnDay: number }

  | {
      readonly kind: "MANDATE_AMOUNT_EXCEEDED";
      readonly capPaise: number;
      readonly attemptedPaise: number;
    }

  | { readonly kind: "MANDATE_REVOKED" }

  | { readonly kind: "CARD_EXPIRED" }

  | { readonly kind: "PRE_DEBIT_NOTICE_FAILED" }

  | { readonly kind: "ISSUER_DOWNTIME"; readonly issuerBank: string }

  | { readonly kind: "TECHNICAL_DECLINE" }

  | { readonly kind: "DO_NOT_HONOUR" }

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

export type NudgeChannel = "sms" | "email" | "whatsapp" | "in_app";

export type RecoveryAction =

  | {
      readonly kind: "RETRY_AT";
      readonly dayOffset: number;
      readonly expectedSuccess: number;
    }

  | { readonly kind: "REQUEST_MANDATE_RENEWAL"; readonly channel: NudgeChannel }

  | {
      readonly kind: "REQUEST_INSTRUMENT_UPDATE";
      readonly channel: NudgeChannel;
    }

  | {
      readonly kind: "SPLIT_AMOUNT";
      readonly parts: number;
      readonly perPartPaise: number;
    }

  | {
      readonly kind: "RESEND_NOTICE";
      readonly channel: NudgeChannel;
      readonly retryDayOffset: number;
    }

  | { readonly kind: "ESCALATE"; readonly note: string }

  | {
      readonly kind: "ABANDON";
      readonly winBack: boolean;
    };

export type RecoveryActionKind = RecoveryAction["kind"];

export const ATTEMPT_CONSUMING_ACTIONS = new Set<RecoveryActionKind>([
  "RETRY_AT",
  "SPLIT_AMOUNT",
]);

export const NUDGE_ACTIONS = new Set<RecoveryActionKind>([
  "REQUEST_MANDATE_RENEWAL",
  "REQUEST_INSTRUMENT_UPDATE",
  "RESEND_NOTICE",
]);

export type InstrumentType = "CARD" | "UPI_AUTOPAY" | "NACH_EMANDATE";

export const INSTRUMENT_TYPES = [
  "CARD",
  "UPI_AUTOPAY",
  "NACH_EMANDATE",
] as const satisfies readonly InstrumentType[];

export type CustomerSegment =
  | "SALARY_EARLY_MONTH"
  | "SALARY_MID_MONTH"
  | "IRREGULAR_INCOME";

export const CUSTOMER_SEGMENTS = [
  "SALARY_EARLY_MONTH",
  "SALARY_MID_MONTH",
  "IRREGULAR_INCOME",
] as const satisfies readonly CustomerSegment[];

export function assertNever(value: never, context: string): never {
  throw new Error(
    `${context}: unhandled variant ${JSON.stringify(value)}. ` +
      `This should have been caught at compile time.`,
  );
}

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
