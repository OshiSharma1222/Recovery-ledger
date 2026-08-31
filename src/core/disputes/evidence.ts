import { formatPaise } from "../taxonomy.js";

export type EvidenceKind =
  | "ORDER_RECORD"
  | "DELIVERY_PROOF"
  | "USAGE_LOGS"
  | "AUTH_LOG_3DS"
  | "AVS_CVV_RESULT"
  | "DEVICE_IP_MATCH"
  | "CUSTOMER_CORRESPONDENCE"
  | "TERMS_ACCEPTANCE_TIMESTAMP"
  | "REFUND_POLICY_ACCEPTED"
  | "CANCELLATION_RECORD"
  | "REFUND_ISSUED_PROOF"
  | "DUPLICATE_ANALYSIS"
  | "PRIOR_UNDISPUTED_TRANSACTIONS"

  | "MANDATE_AUTHORISATION"

  | "PRE_DEBIT_NOTICE_PROOF";

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  ORDER_RECORD: "Order record with itemised charge",
  DELIVERY_PROOF: "Delivery or fulfilment confirmation",
  USAGE_LOGS: "Login / usage logs showing the service was consumed",
  AUTH_LOG_3DS: "Authorisation log including 3DS result",
  AVS_CVV_RESULT: "AVS and CVV match results",
  DEVICE_IP_MATCH: "Device fingerprint or IP matching prior undisputed orders",
  CUSTOMER_CORRESPONDENCE: "Correspondence with the cardholder",
  TERMS_ACCEPTANCE_TIMESTAMP: "Timestamped acceptance of terms",
  REFUND_POLICY_ACCEPTED: "Refund / cancellation policy shown and accepted",
  CANCELLATION_RECORD: "Record of when and how cancellation was requested",
  REFUND_ISSUED_PROOF: "Proof a credit was already processed",
  DUPLICATE_ANALYSIS: "Analysis showing the two charges are distinct",
  PRIOR_UNDISPUTED_TRANSACTIONS: "History of prior undisputed transactions",
  MANDATE_AUTHORISATION: "Signed e-mandate authorising the recurring debit",
  PRE_DEBIT_NOTICE_PROOF: "Delivery receipt for the 24h pre-debit notification",
};

export type DisputeCategory = "FRAUD" | "CONSUMER_DISPUTE" | "PROCESSING_ERROR";

export interface EvidenceRequirement {
  readonly kind: EvidenceKind;

  readonly weight: number;

  readonly mandatory: boolean;
}

export interface ReasonCode {
  readonly code: string;
  readonly network: "VISA" | "MASTERCARD" | "RUPAY";
  readonly title: string;
  readonly category: DisputeCategory;

  readonly responseWindowDays: number;

  readonly baseWinRate: number;
  readonly requires: readonly EvidenceRequirement[];

  readonly note: string;
}

const req = (
  kind: EvidenceKind,
  weight: number,
  mandatory = false,
): EvidenceRequirement => ({ kind, weight, mandatory });

export const REASON_CODES: Record<string, ReasonCode> = {
  VISA_13_2: {
    code: "13.2",
    network: "VISA",
    title: "Cancelled Recurring Transaction",
    category: "CONSUMER_DISPUTE",
    responseWindowDays: 30,
    baseWinRate: 0.62,
    note:
      "The Lane 1 overlap. The cardholder says they cancelled before the debit. " +
      "Winnable when the mandate and the pre-debit notice are on file, and " +
      "unwinnable when the cancellation record shows they were right.",
    requires: [
      req("MANDATE_AUTHORISATION", 0.28, true),
      req("CANCELLATION_RECORD", 0.24, true),
      req("PRE_DEBIT_NOTICE_PROOF", 0.18),
      req("TERMS_ACCEPTANCE_TIMESTAMP", 0.12),
      req("USAGE_LOGS", 0.1),
      req("CUSTOMER_CORRESPONDENCE", 0.08),
    ],
  },

  VISA_13_1: {
    code: "13.1",
    network: "VISA",
    title: "Merchandise / Services Not Received",
    category: "CONSUMER_DISPUTE",
    responseWindowDays: 30,
    baseWinRate: 0.58,
    note: "Turns almost entirely on fulfilment proof. Without it there is no case.",
    requires: [
      req("DELIVERY_PROOF", 0.34, true),
      req("ORDER_RECORD", 0.22, true),
      req("USAGE_LOGS", 0.18),
      req("CUSTOMER_CORRESPONDENCE", 0.14),
      req("TERMS_ACCEPTANCE_TIMESTAMP", 0.12),
    ],
  },

  VISA_10_4: {
    code: "10.4",
    network: "VISA",
    title: "Other Fraud — Card Absent Environment",
    category: "FRAUD",
    responseWindowDays: 30,
    baseWinRate: 0.29,
    note:
      "The hardest category. Liability sits with the merchant in card-absent " +
      "unless 3DS shifted it, and issuers rarely reverse on anything less.",
    requires: [
      req("AUTH_LOG_3DS", 0.32, true),
      req("AVS_CVV_RESULT", 0.18),
      req("DEVICE_IP_MATCH", 0.18),
      req("PRIOR_UNDISPUTED_TRANSACTIONS", 0.16),
      req("DELIVERY_PROOF", 0.16),
    ],
  },

  VISA_12_6: {
    code: "12.6.1",
    network: "VISA",
    title: "Duplicate Processing",
    category: "PROCESSING_ERROR",
    responseWindowDays: 30,
    baseWinRate: 0.71,
    note:
      "The most winnable code here. Either the two charges are genuinely " +
      "distinct and you can show it, or they are not and you should refund.",
    requires: [
      req("DUPLICATE_ANALYSIS", 0.42, true),
      req("ORDER_RECORD", 0.3, true),
      req("AUTH_LOG_3DS", 0.16),
      req("CUSTOMER_CORRESPONDENCE", 0.12),
    ],
  },

  VISA_13_6: {
    code: "13.6",
    network: "VISA",
    title: "Credit Not Processed",
    category: "CONSUMER_DISPUTE",
    responseWindowDays: 30,
    baseWinRate: 0.44,
    note:
      "Usually a timing argument. If the credit did go out, proving it wins; " +
      "if it did not, contesting is throwing good money after bad.",
    requires: [
      req("REFUND_ISSUED_PROOF", 0.38, true),
      req("REFUND_POLICY_ACCEPTED", 0.26, true),
      req("CUSTOMER_CORRESPONDENCE", 0.2),
      req("ORDER_RECORD", 0.16),
    ],
  },

  VISA_13_3: {
    code: "13.3",
    network: "VISA",
    title: "Not as Described or Defective",
    category: "CONSUMER_DISPUTE",
    responseWindowDays: 30,
    baseWinRate: 0.41,
    note: "Subjective by nature. Evidence helps but rarely decides it outright.",
    requires: [
      req("ORDER_RECORD", 0.26, true),
      req("TERMS_ACCEPTANCE_TIMESTAMP", 0.22),
      req("CUSTOMER_CORRESPONDENCE", 0.22),
      req("DELIVERY_PROOF", 0.16),
      req("REFUND_POLICY_ACCEPTED", 0.14),
    ],
  },

  MC_4841: {
    code: "4841",
    network: "MASTERCARD",
    title: "Cancelled Recurring or Digital Goods Transaction",
    category: "CONSUMER_DISPUTE",
    responseWindowDays: 45,
    baseWinRate: 0.6,
    note: "Mastercard's analogue of Visa 13.2, with a longer response window.",
    requires: [
      req("MANDATE_AUTHORISATION", 0.3, true),
      req("CANCELLATION_RECORD", 0.24, true),
      req("USAGE_LOGS", 0.18),
      req("TERMS_ACCEPTANCE_TIMESTAMP", 0.16),
      req("CUSTOMER_CORRESPONDENCE", 0.12),
    ],
  },

  MC_4837: {
    code: "4837",
    network: "MASTERCARD",
    title: "No Cardholder Authorization",
    category: "FRAUD",
    responseWindowDays: 45,
    baseWinRate: 0.26,
    note: "Fraud claim. Without an authentication record this is close to hopeless.",
    requires: [
      req("AUTH_LOG_3DS", 0.34, true),
      req("DEVICE_IP_MATCH", 0.2),
      req("PRIOR_UNDISPUTED_TRANSACTIONS", 0.2),
      req("AVS_CVV_RESULT", 0.14),
      req("DELIVERY_PROOF", 0.12),
    ],
  },
};

export function reasonCode(id: string): ReasonCode {
  const rc = REASON_CODES[id];
  if (!rc) throw new Error(`Unknown reason code "${id}"`);
  return rc;
}

export const DISPUTE_ECONOMICS = {
  NETWORK_FEE_PAISE: 1_500_00,

  REPRESENTMENT_COST_PAISE: 850_00,
} as const;

export interface EvidenceGap {
  readonly kind: EvidenceKind;
  readonly label: string;
  readonly weight: number;
  readonly mandatory: boolean;
}

export type DisputeAction =
  | { readonly kind: "CONTEST"; readonly confidence: number }
  | { readonly kind: "DO_NOT_CONTEST"; readonly reason: string };

export interface EvidenceAssessment {
  readonly reasonCodeId: string;
  readonly present: readonly EvidenceKind[];
  readonly gaps: readonly EvidenceGap[];

  readonly blockingGaps: readonly EvidenceGap[];

  readonly coverage: number;
  readonly winProbability: number;

  readonly expectedValuePaise: number;
  readonly action: DisputeAction;
  readonly rationale: string;
}

export function assessEvidence(
  reasonCodeId: string,
  amountPaise: number,
  available: readonly EvidenceKind[],
): EvidenceAssessment {
  const rc = reasonCode(reasonCodeId);
  const have = new Set(available);

  const gaps: EvidenceGap[] = [];
  let heldWeight = 0;
  let totalWeight = 0;

  for (const r of rc.requires) {
    totalWeight += r.weight;
    if (have.has(r.kind)) {
      heldWeight += r.weight;
    } else {
      gaps.push({
        kind: r.kind,
        label: EVIDENCE_LABELS[r.kind],
        weight: r.weight,
        mandatory: r.mandatory,
      });
    }
  }

  const coverage = totalWeight === 0 ? 0 : heldWeight / totalWeight;
  const blockingGaps = gaps.filter((g) => g.mandatory);

  const winProbability =
    blockingGaps.length > 0
      ? Math.min(0.08, rc.baseWinRate * coverage * 0.2)
      : rc.baseWinRate * (0.35 + 0.65 * coverage);

  const expectedValuePaise = Math.round(
    winProbability * amountPaise - DISPUTE_ECONOMICS.REPRESENTMENT_COST_PAISE,
  );

  let action: DisputeAction;
  let rationale: string;

  if (blockingGaps.length > 0) {
    const names = blockingGaps.map((g) => g.label).join(" and ");
    action = {
      kind: "DO_NOT_CONTEST",
      reason: `missing mandatory evidence: ${names}`,
    };
    rationale =
      `${rc.network} ${rc.code} will not be reviewed without ${names}. ` +
      `This is not a weak case, it is an unwinnable one, and filing it costs ` +
      `${formatPaise(DISPUTE_ECONOMICS.REPRESENTMENT_COST_PAISE)} to lose. ` +
      `The fix is upstream: start capturing this artifact and these stop being losses.`;
  } else if (expectedValuePaise <= 0) {
    action = {
      kind: "DO_NOT_CONTEST",
      reason: `expected value ${formatPaise(expectedValuePaise)} does not cover the cost of filing`,
    };
    rationale =
      `Evidence is complete enough to file, but at ${formatPaise(amountPaise)} and ` +
      `${(winProbability * 100).toFixed(0)}% win probability the expected recovery is ` +
      `${formatPaise(Math.round(winProbability * amountPaise))}, against ` +
      `${formatPaise(DISPUTE_ECONOMICS.REPRESENTMENT_COST_PAISE)} to contest. ` +
      `Fighting this one loses money on average. Accept it and move on.`;
  } else {
    action = { kind: "CONTEST", confidence: winProbability };
    rationale =
      `Evidence covers ${(coverage * 100).toFixed(0)}% of what ${rc.network} ${rc.code} ` +
      `weighs, with every mandatory artifact on file. Win probability ` +
      `${(winProbability * 100).toFixed(0)}% on ${formatPaise(amountPaise)} gives an expected ` +
      `${formatPaise(expectedValuePaise)} net of filing costs. Worth contesting.` +
      (gaps.length > 0
        ? ` Still missing ${gaps.map((g) => g.label.toLowerCase()).join(", ")}, which would strengthen it.`
        : "");
  }

  return {
    reasonCodeId,
    present: available,
    gaps,
    blockingGaps,
    coverage,
    winProbability,
    expectedValuePaise,
    action,
    rationale,
  };
}
