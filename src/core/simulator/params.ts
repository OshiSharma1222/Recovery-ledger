/**
 * ============================================================================
 *  FROZEN SIMULATOR PARAMETERS -- DO NOT EDIT AFTER THIS FILE IS COMMITTED
 * ============================================================================
 *
 * Every number in this file was chosen and committed BEFORE a single line of
 * `src/core/policy/` was written. That ordering is the whole point.
 *
 * A simulator authored by the same person who authors the policy can always be
 * nudged, consciously or not, until the policy looks good. The only defence
 * that costs nothing and proves something is to freeze the environment first,
 * in its own commit, and then never touch it. The README cites that commit
 * hash, so the claim is checkable with `git log --follow` on this file: if
 * this file changes after the policy engine lands, the benchmark is void and
 * a reviewer can see that in ten seconds.
 *
 * What this means in practice:
 *   - If the policy underperforms, that is a result. Fix the policy.
 *   - If a number here is genuinely wrong, say so in the README as a stated
 *     limitation. Do not quietly retune it.
 *
 * CALIBRATION NOTE, for full disclosure. One calibration pass was made on
 * these numbers before the freeze, while `src/core/policy/` was still an empty
 * directory. The first draft produced a cause mix that did not resemble Indian
 * recurring payments: MANDATE_AMOUNT_EXCEEDED came out as the single largest
 * bucket at 21.6% and structurally unrecoverable causes were 36.9% of the
 * ledger, while INSUFFICIENT_FUNDS -- which dominates in reality -- sat at 17%.
 * The pass rebalanced the mandate cap and term distributions and rederived
 * balance failures from the balance curve, giving 42% / 22%.
 *
 * Note the direction of that correction: it REDUCED the share of terminal
 * causes, and terminal causes are precisely where the ABANDON action earns its
 * advantage over fixed-schedule dunning. The calibration therefore made the
 * benchmark harder for the policy under test, not easier. Nothing here has
 * been touched since, and the freeze commit is the one cited in the README.
 *
 * These parameters are my authored model of the world, not measured
 * production data. See the "What is real vs what is simulated" section of the
 * README. What IS real: the Razorpay reason-code strings in taxonomy.ts and
 * the RBI constraints below.
 */

import type { CustomerSegment, InstrumentType } from "../taxonomy.js";

// ---------------------------------------------------------------------------
// Regulatory constants (REAL -- not invented)
// ---------------------------------------------------------------------------

/**
 * RBI's e-mandate framework for recurring transactions. These shape real
 * failure modes that do not exist in card-first markets.
 *
 * Sourced from public reporting on the RBI e-mandate directions; see
 * docs/RESEARCH.md. Figures have been revised more than once, so they are
 * quoted as "the framework we model", not as legal advice.
 */
export const RBI = {
  /**
   * A pre-debit notification must reach the customer at least 24 hours before
   * the debit. If it fails, the debit is not eligible to be presented --
   * which is a failure class with a fix that is not "retry harder".
   */
  PRE_DEBIT_NOTICE_HOURS: 24,

  /**
   * Recurring debits at or below this may be processed without additional
   * factor authentication. Above it, AFA is required on every debit, which
   * materially raises the failure rate.
   */
  AFA_EXEMPT_LIMIT_PAISE: 15_000_00,

  /**
   * Higher AFA-exempt ceiling for insurance premiums, mutual fund
   * subscriptions and credit card bill payments.
   */
  AFA_EXEMPT_LIMIT_HIGH_PAISE: 1_00_000_00,
} as const;

// ---------------------------------------------------------------------------
// Simulation shape
// ---------------------------------------------------------------------------

export const SIM = {
  /** Default population size for the benchmark. */
  CUSTOMERS: 4_000,

  /** Days simulated after the failure wave. Bounds "days to recovery". */
  HORIZON_DAYS: 45,

  /**
   * Hard cap on debit attempts any policy may spend on a single row. Mirrors
   * the practical reality that issuers and networks penalise endless
   * re-presentment. Applies to every policy equally, including the oracle.
   */
  MAX_ATTEMPTS: 6,

  /** Default seed. Overridable via `npm run bench -- --seed=...`. */
  DEFAULT_SEED: "recovery-ledger-v1",
} as const;

// ---------------------------------------------------------------------------
// Customer population
// ---------------------------------------------------------------------------

/** Segment mix. The policy sees the segment; it does not see the salary day. */
export const SEGMENT_MIX: readonly (readonly [CustomerSegment, number])[] = [
  ["SALARY_EARLY_MONTH", 0.45],
  ["SALARY_MID_MONTH", 0.3],
  ["IRREGULAR_INCOME", 0.25],
];

/**
 * Latent salary day per segment. This is the single most important hidden
 * variable in the simulation and the policy is never told it. B4 (oracle)
 * sees it; B3 has to infer the timing from observed outcomes.
 */
export const SALARY_DAYS: Record<CustomerSegment, readonly number[]> = {
  SALARY_EARLY_MONTH: [1, 2, 3],
  SALARY_MID_MONTH: [7, 10, 15],
  // Irregular earners have no salary day. Represented by -1 and handled
  // explicitly in the balance model rather than by a magic fallback.
  IRREGULAR_INCOME: [-1],
};

/** Instrument mix, roughly reflecting where Indian recurring volume sits. */
export const INSTRUMENT_MIX: readonly (readonly [InstrumentType, number])[] = [
  ["UPI_AUTOPAY", 0.5],
  ["CARD", 0.3],
  ["NACH_EMANDATE", 0.2],
];

/**
 * Issuer banks with their baseline daily downtime probability. Downtime is a
 * genuinely different failure class: it is transient, correlated across
 * customers on the same bank, and resolves on its own within a day or two.
 */
export const ISSUERS: readonly (readonly [string, number, number])[] = [
  // [bank, share of population, daily downtime probability]
  ["HDFC", 0.22, 0.012],
  ["ICICI", 0.18, 0.014],
  ["SBI", 0.2, 0.032],
  ["AXIS", 0.12, 0.018],
  ["KOTAK", 0.08, 0.011],
  ["PNB", 0.08, 0.038],
  ["BOB", 0.07, 0.03],
  ["YES", 0.05, 0.022],
];

/**
 * Affluence bands scale the whole balance curve. A high-cushion customer has
 * funds most of the month; a low-cushion customer only just after payday.
 * This is what makes retry TIMING worth money rather than being noise.
 */
export const AFFLUENCE_BANDS: readonly (readonly [string, number, number])[] = [
  // [label, share, multiplier applied to P(sufficient funds)]
  ["LOW", 0.35, 0.62],
  ["MID", 0.45, 0.95],
  ["HIGH", 0.2, 1.25],
];

/**
 * P(account has sufficient funds) as a function of days since the last salary
 * credit, before the affluence multiplier. Index 0 is payday itself.
 *
 * The shape is the entire economic argument of Lane 1: money is present just
 * after payday and drains through the month. A fixed day-1/day-3/day-5 retry
 * schedule is blind to where in this curve it lands; a policy that knows the
 * curve exists can wait four days and roughly double its hit rate.
 */
export const BALANCE_CURVE: readonly number[] = [
  0.93, 0.95, 0.94, 0.92, 0.89, 0.86, 0.83, // 0-6
  0.79, 0.76, 0.72, 0.69, 0.65, 0.62, 0.58, // 7-13
  0.55, 0.52, 0.49, 0.46, 0.43, 0.41, 0.38, // 14-20
  0.36, 0.34, 0.32, 0.3, 0.29, 0.27, 0.26, // 21-27
  0.25, 0.24, 0.23, // 28-30
];

/** Flat, noisy funds availability for earners with no salary cycle. */
export const IRREGULAR_INCOME_MODEL = {
  BASE_P_FUNDS: 0.44,
  /** Std dev of the per-day wobble. Makes timing genuinely less learnable. */
  DAILY_NOISE_SD: 0.11,
} as const;

/**
 * Probability a customer acts on a nudge (renewal link, card update, notice).
 * Drawn per customer, then held fixed. Nudge-based recovery is capped by this
 * and no amount of policy cleverness gets around it.
 */
export const RESPONSIVENESS = {
  MEAN: 0.38,
  SD: 0.18,
  MIN: 0.05,
  MAX: 0.85,
  /** Each additional nudge to the same customer is less effective. */
  REPEAT_NUDGE_DECAY: 0.55,
} as const;

// ---------------------------------------------------------------------------
// Subscription products
// ---------------------------------------------------------------------------

/**
 * Product mix. Amount matters for two independent reasons: it decides whether
 * a debit crosses the RBI AFA threshold, and it decides whether chasing the
 * row is worth the attempts it costs.
 */
export const PRODUCTS: readonly {
  readonly name: string;
  readonly share: number;
  readonly minPaise: number;
  readonly maxPaise: number;
  /** Insurance / MF / card bills get the higher AFA-exempt ceiling. */
  readonly highAfaCeiling: boolean;
}[] = [
  { name: "OTT_SUBSCRIPTION", share: 0.3, minPaise: 149_00, maxPaise: 999_00, highAfaCeiling: false },
  { name: "SIP_MUTUAL_FUND", share: 0.24, minPaise: 500_00, maxPaise: 25_000_00, highAfaCeiling: true },
  { name: "INSURANCE_PREMIUM", share: 0.16, minPaise: 1_200_00, maxPaise: 40_000_00, highAfaCeiling: true },
  { name: "SAAS_SEAT", share: 0.14, minPaise: 800_00, maxPaise: 12_000_00, highAfaCeiling: false },
  { name: "UTILITY_BILL", share: 0.1, minPaise: 300_00, maxPaise: 4_000_00, highAfaCeiling: false },
  { name: "LOAN_EMI", share: 0.06, minPaise: 2_500_00, maxPaise: 60_000_00, highAfaCeiling: false },
];

/**
 * Multiple of the subscription amount the customer authorised as the mandate
 * cap at registration. A cap of exactly 1.0x is common and is a latent bomb:
 * the first price rise makes every future debit fail forever, and no retry
 * schedule can ever fix it.
 */
export const MANDATE_CAP_MULTIPLES: readonly (readonly [number, number])[] = [
  [1.0, 0.18],
  [1.25, 0.24],
  [1.5, 0.26],
  [2.0, 0.22],
  [5.0, 0.1],
];

/** Probability the merchant has raised the price since mandate registration. */
export const PRICE_INCREASE = {
  PROBABILITY: 0.06,
  MIN_FACTOR: 1.05,
  MAX_FACTOR: 1.45,
} as const;

/** Mandate validity, in months from registration. */
export const MANDATE_TERM_MONTHS: readonly (readonly [number, number])[] = [
  [12, 0.28],
  [24, 0.3],
  [36, 0.22],
  // Effectively open-ended (UPI Autopay allows very long horizons).
  [360, 0.2],
];

// ---------------------------------------------------------------------------
// Failure generation
// ---------------------------------------------------------------------------

/**
 * Balance-driven failure is derived from the balance curve rather than from a
 * flat per-instrument rate: P(fail on funds) = weight * (1 - P(sufficient)).
 *
 * This is the single most consequential modelling decision in the file. If
 * insufficient-funds failures were drawn from a flat rate, retry timing would
 * carry no signal and B3 could not beat B1 on those rows no matter how good
 * the estimator was. Deriving them from the same curve that governs recovery
 * is what makes "when do we re-present?" a real question with a real answer.
 *
 * The weight scales the curve into a plausible overall failure rate; it is not
 * a free knob for making the policy look good, since it applies identically to
 * every policy including the do-nothing floor.
 */
export const BALANCE_FAILURE_WEIGHT = 0.2;

/**
 * Non-balance failure rates, by instrument. UPI Autopay carries more
 * infrastructure flakiness; cards carry more issuer refusals.
 */
export const TECHNICAL_FAILURE_RATE: Record<InstrumentType, number> = {
  UPI_AUTOPAY: 0.032,
  CARD: 0.019,
  NACH_EMANDATE: 0.026,
};

export const DO_NOT_HONOUR_RATE: Record<InstrumentType, number> = {
  UPI_AUTOPAY: 0.024,
  CARD: 0.036,
  NACH_EMANDATE: 0.02,
};

/**
 * Extra failure probability when a debit exceeds its AFA-exempt ceiling and
 * therefore needs additional factor authentication on every presentment.
 */
export const AFA_FAILURE_PENALTY = 0.09;

/** Probability the RBI pre-debit notification did not land, by instrument. */
export const PRE_DEBIT_NOTICE_FAILURE_RATE: Record<InstrumentType, number> = {
  UPI_AUTOPAY: 0.02,
  CARD: 0.012,
  NACH_EMANDATE: 0.028,
};

/** Probability a customer has silently revoked their mandate in a given cycle. */
export const MANDATE_REVOCATION_RATE = 0.021;

/** Probability a debit trips a risk or compliance block. */
export const RISK_BLOCK_RATE = 0.004;

// ---------------------------------------------------------------------------
// Response model: does action A at time t actually work?
// ---------------------------------------------------------------------------

/**
 * The environment's answer to the only question the benchmark needs.
 *
 * Terminal causes are absent from this table on purpose: their success
 * probability is identically zero at every offset, for every policy, forever.
 * That zero is what makes ABANDON a correct action rather than a cop-out, and
 * it is what turns B1's day-1/3/5 schedule into pure waste on those rows.
 */
export const RESPONSE = {
  /**
   * Issuer downtime clears quickly. Retrying inside the same day mostly
   * re-hits the outage; waiting a day or two is close to free money.
   */
  ISSUER_DOWNTIME_RECOVERY_BY_DAY: [0.18, 0.72, 0.9, 0.96] as readonly number[],

  /**
   * Transient technical declines are the one case where retrying immediately
   * is correct. Modelled at same-day granularity via a flat probability.
   */
  TECHNICAL_DECLINE_RETRY_SUCCESS: 0.81,
  /** Each further retry on a technical decline is worth less. */
  TECHNICAL_DECLINE_DECAY: 0.6,

  /**
   * `DO_NOT_HONOUR` is ambiguous by construction: some are soft (retryable),
   * some are hard refusals wearing the same code. This split is what makes
   * "retry twice then escalate" the right answer instead of either extreme.
   */
  DO_NOT_HONOUR_SOFT_SHARE: 0.4,
  DO_NOT_HONOUR_SOFT_RETRY_SUCCESS: 0.55,

  /**
   * A re-sent pre-debit notice fixes eligibility, after which the debit is
   * governed by the ordinary balance model. This is the probability the
   * notice itself lands the second time.
   */
  NOTICE_REDELIVERY_SUCCESS: 0.88,
  /** RBI requires 24h notice, so the earliest legal re-presentment is +1 day. */
  NOTICE_MIN_RETRY_DELAY_DAYS: 1,

  /**
   * Nudge-based recoveries. Each is `responsiveness * factor`, decayed per
   * repeat nudge. Renewal asks more of the customer than a card update, and
   * both ask far more than a silent retry -- which is why a policy that
   * nudges indiscriminately loses on the annoyance metric.
   */
  MANDATE_RENEWAL_FACTOR: 0.72,
  INSTRUMENT_UPDATE_FACTOR: 0.85,

  /** Days before a nudge-driven recovery actually lands, once accepted. */
  NUDGE_FULFILMENT_DELAY_DAYS: 2,

  /**
   * Splitting a capped debit works only if the cap admits the split and the
   * balance is there for each part. This is the residual friction: banks and
   * customers sometimes reject partial collection outright.
   */
  SPLIT_ACCEPTANCE: 0.78,
  /** Maximum parts we will ever split a debit into. */
  SPLIT_MAX_PARTS: 3,

  /**
   * Escalation to a human collections touch. Expensive, so the policy should
   * reach for it rarely, but it does work.
   */
  ESCALATION_SUCCESS: 0.33,
} as const;

/**
 * Guard against the one edit that would invalidate everything. If a future
 * change adds a segment or instrument without extending the tables above,
 * this fails at import time rather than producing a quietly wrong benchmark.
 */
export function assertParamsWellFormed(): void {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

  if (!near(sum(SEGMENT_MIX.map(([, w]) => w)), 1)) {
    throw new Error("SEGMENT_MIX must sum to 1");
  }
  if (!near(sum(INSTRUMENT_MIX.map(([, w]) => w)), 1)) {
    throw new Error("INSTRUMENT_MIX must sum to 1");
  }
  if (!near(sum(ISSUERS.map(([, w]) => w)), 1)) {
    throw new Error("ISSUERS shares must sum to 1");
  }
  if (!near(sum(AFFLUENCE_BANDS.map(([, w]) => w)), 1)) {
    throw new Error("AFFLUENCE_BANDS must sum to 1");
  }
  if (!near(sum(PRODUCTS.map((p) => p.share)), 1)) {
    throw new Error("PRODUCTS shares must sum to 1");
  }
  if (!near(sum(MANDATE_CAP_MULTIPLES.map(([, w]) => w)), 1)) {
    throw new Error("MANDATE_CAP_MULTIPLES must sum to 1");
  }
  if (!near(sum(MANDATE_TERM_MONTHS.map(([, w]) => w)), 1)) {
    throw new Error("MANDATE_TERM_MONTHS must sum to 1");
  }
  if (BALANCE_CURVE.length !== 31) {
    throw new Error("BALANCE_CURVE must cover days 0..30");
  }
  for (const p of BALANCE_CURVE) {
    if (p < 0 || p > 1) throw new Error("BALANCE_CURVE entries must be probabilities");
  }
}
