import {
  AFFLUENCE_BANDS,
  AFA_FAILURE_PENALTY,
  BALANCE_CURVE,
  BALANCE_FAILURE_WEIGHT,
  DO_NOT_HONOUR_RATE,
  TECHNICAL_FAILURE_RATE,
  INSTRUMENT_MIX,
  IRREGULAR_INCOME_MODEL,
  ISSUERS,
  MANDATE_CAP_MULTIPLES,
  MANDATE_REVOCATION_RATE,
  MANDATE_TERM_MONTHS,
  PRE_DEBIT_NOTICE_FAILURE_RATE,
  PRICE_INCREASE,
  PRODUCTS,
  RBI,
  RESPONSIVENESS,
  RISK_BLOCK_RATE,
  SALARY_DAYS,
  SEGMENT_MIX,
  SIM,
} from "./params.js";
import { Rng, clamp01 } from "./rng.js";
import {
  newLedgerRow,
  type LedgerRow,
} from "../ledger.js";
import type {
  CustomerSegment,
  InstrumentType,
  RawReasonCode,
  RootCause,
} from "../taxonomy.js";

export const MONTH_DAYS = 30;

export interface Customer {
  readonly id: string;

  readonly segment: CustomerSegment;
  readonly instrumentType: InstrumentType;
  readonly issuerBank: string;
  readonly product: string;

  readonly presentedPaise: number;

  readonly salaryDay: number;

  readonly affluence: number;

  readonly responsiveness: number;

  readonly mandateCapPaise: number;

  readonly mandateExpiryDay: number;

  readonly cardExpiryDay: number | null;

  readonly revokedOnDay: number | null;

  readonly highAfaCeiling: boolean;
}

export function merchantMandateRecord(c: Customer): {
  capPaise: number;
  expiryDay: number;
  instrumentExpiryDay: number | null;
} {
  return {
    capPaise: c.mandateCapPaise,
    expiryDay: c.mandateExpiryDay,
    instrumentExpiryDay: c.cardExpiryDay,
  };
}

export function requiresAfa(c: Customer): boolean {
  const ceiling = c.highAfaCeiling
    ? RBI.AFA_EXEMPT_LIMIT_HIGH_PAISE
    : RBI.AFA_EXEMPT_LIMIT_PAISE;
  return c.presentedPaise > ceiling;
}

export function dayOfMonth(simDay: number): number {
  return (((simDay % MONTH_DAYS) + MONTH_DAYS) % MONTH_DAYS) + 1;
}

export function daysSinceSalary(c: Customer, simDay: number): number {
  if (c.salaryDay < 0) return -1;
  const dom = dayOfMonth(simDay);
  return (dom - c.salaryDay + MONTH_DAYS) % MONTH_DAYS;
}

export function pSufficientFunds(c: Customer, simDay: number, rng: Rng): number {
  if (c.salaryDay < 0) {
    const noise = rng.normal(0, IRREGULAR_INCOME_MODEL.DAILY_NOISE_SD);
    return clamp01((IRREGULAR_INCOME_MODEL.BASE_P_FUNDS + noise) * c.affluence);
  }
  const offset = daysSinceSalary(c, simDay);

  const base = BALANCE_CURVE[Math.min(offset, BALANCE_CURVE.length - 1)]!;
  return clamp01(base * c.affluence);
}

export type DowntimeSchedule = ReadonlyMap<string, ReadonlySet<number>>;

export function generateDowntime(rng: Rng, horizonDays: number): DowntimeSchedule {
  const schedule = new Map<string, ReadonlySet<number>>();
  for (const [bank, , dailyProbability] of ISSUERS) {
    const days = new Set<number>();
    for (let day = 0; day < horizonDays; day++) {
      if (rng.bool(dailyProbability)) {
        days.add(day);

        if (rng.bool(0.35)) days.add(day + 1);
      }
    }
    schedule.set(bank, days);
  }
  return schedule;
}

export function isBankDown(
  schedule: DowntimeSchedule,
  bank: string,
  simDay: number,
): boolean {
  return schedule.get(bank)?.has(simDay) ?? false;
}

export function generatePopulation(rng: Rng, count: number): Customer[] {
  const customers: Customer[] = [];

  for (let i = 0; i < count; i++) {
    const segment = rng.weighted(SEGMENT_MIX);
    const salaryDay = rng.pick(SALARY_DAYS[segment]);
    const instrumentType = rng.weighted(INSTRUMENT_MIX);
    const issuerBank = rng.weighted(ISSUERS.map(([b, s]) => [b, s] as const));
    const affluence = rng.weighted(
      AFFLUENCE_BANDS.map(([, share, mult]) => [mult, share] as const),
    );

    const product = rng.weighted(PRODUCTS.map((p) => [p, p.share] as const));

    const spread = rng.next() ** 1.7;
    const basePaise = Math.round(
      product.minPaise + spread * (product.maxPaise - product.minPaise),
    );

    const capMultiple = rng.weighted(MANDATE_CAP_MULTIPLES);
    const mandateCapPaise = Math.round(basePaise * capMultiple);

    const priceFactor = rng.bool(PRICE_INCREASE.PROBABILITY)
      ? rng.float(PRICE_INCREASE.MIN_FACTOR, PRICE_INCREASE.MAX_FACTOR)
      : 1;
    const presentedPaise = Math.round(basePaise * priceFactor);

    const termMonths = rng.weighted(MANDATE_TERM_MONTHS);
    const monthsElapsed = rng.float(0, termMonths);
    const mandateExpiryDay = Math.round((termMonths - monthsElapsed) * MONTH_DAYS);

    const cardExpiryDay =
      instrumentType === "CARD"
        ? // Cards run 3-5 years; only a thin slice expires inside the horizon.
          rng.bool(0.045)
          ? rng.int(0, SIM.HORIZON_DAYS)
          : rng.int(SIM.HORIZON_DAYS + 1, 1800)
        : null;

    const revokedOnDay = rng.bool(MANDATE_REVOCATION_RATE)
      ? rng.int(0, SIM.HORIZON_DAYS)
      : null;

    const responsiveness = clamp01(
      Math.min(
        RESPONSIVENESS.MAX,
        Math.max(
          RESPONSIVENESS.MIN,
          rng.normal(RESPONSIVENESS.MEAN, RESPONSIVENESS.SD),
        ),
      ),
    );

    customers.push({
      id: `cust_${String(i).padStart(6, "0")}`,
      segment,
      instrumentType,
      issuerBank,
      product: product.name,
      presentedPaise,
      salaryDay,
      affluence,
      responsiveness,
      mandateCapPaise,
      mandateExpiryDay,
      cardExpiryDay,
      revokedOnDay,
      highAfaCeiling: product.highAfaCeiling,
    });
  }

  return customers;
}

export interface LatentFailure {
  readonly rowId: string;
  readonly customer: Customer;
  readonly trueCause: RootCause;
  readonly rawCode: RawReasonCode;
  readonly failedOnDay: number;
}

const RAW_CODES_BY_CAUSE: Record<
  RootCause["kind"],
  readonly (readonly [RawReasonCode, number])[]
> = {
  INSUFFICIENT_FUNDS: [
    ["insufficient_funds", 0.94],
    ["payment_declined", 0.06],
  ],
  MANDATE_EXPIRED: [
    ["mandate_not_active", 0.72],
    ["mandate_creation_expired", 0.18],
    ["payment_failed", 0.1],
  ],
  MANDATE_AMOUNT_EXCEEDED: [
    ["transaction_limit_exceeded", 0.52],
    ["invalid_amount", 0.24],
    ["mcc_amount_limit_exceeded", 0.14],
    ["payment_declined", 0.1],
  ],
  MANDATE_REVOKED: [
    ["mandate_not_active", 0.46],
    ["payment_cancelled", 0.3],
    ["debit_instrument_blocked", 0.14],
    ["payment_failed", 0.1],
  ],
  CARD_EXPIRED: [
    ["card_expired", 0.81],
    ["incorrect_card_expiry_date", 0.11],
    ["card_declined", 0.08],
  ],
  PRE_DEBIT_NOTICE_FAILED: [
    ["reqauth_mandate_not_acknowledged", 0.64],
    ["payment_mandate_not_active", 0.26],
    ["input_validation_failed", 0.1],
  ],
  ISSUER_DOWNTIME: [
    ["bank_technical_error", 0.38],
    ["bank_not_available", 0.2],
    ["issuer_technical_error", 0.16],
    ["psp_not_available", 0.1],
    ["bank_cutoff_in_progress", 0.08],
    ["upi_app_technical_error", 0.05],
    ["payment_declined_due_to_high_traffic", 0.03],
  ],
  TECHNICAL_DECLINE: [
    ["gateway_technical_error", 0.34],
    ["server_error", 0.24],
    ["payment_timed_out", 0.2],
    ["request_timed_out", 0.12],
    ["invalid_response_from_gateway", 0.1],
  ],
  DO_NOT_HONOUR: [
    ["payment_declined", 0.4],
    ["payment_failed", 0.34],
    ["debit_declined", 0.16],
    ["card_declined", 0.1],
  ],
  RISK_BLOCKED: [
    ["payment_risk_check_failed", 0.78],
    ["compliance_violation", 0.22],
  ],
};

function rawCodeFor(rng: Rng, cause: RootCause): RawReasonCode {
  return rng.weighted(RAW_CODES_BY_CAUSE[cause.kind]);
}

function determineTrueCause(
  c: Customer,
  simDay: number,
  downtime: DowntimeSchedule,
  rng: Rng,
): RootCause | null {
  if (c.revokedOnDay !== null && simDay >= c.revokedOnDay) {
    return { kind: "MANDATE_REVOKED" };
  }
  if (simDay >= c.mandateExpiryDay) {
    return { kind: "MANDATE_EXPIRED", expiredOnDay: c.mandateExpiryDay };
  }
  if (c.cardExpiryDay !== null && simDay >= c.cardExpiryDay) {
    return { kind: "CARD_EXPIRED" };
  }
  if (c.presentedPaise > c.mandateCapPaise) {
    return {
      kind: "MANDATE_AMOUNT_EXCEEDED",
      capPaise: c.mandateCapPaise,
      attemptedPaise: c.presentedPaise,
    };
  }
  if (rng.bool(RISK_BLOCK_RATE)) {
    return { kind: "RISK_BLOCKED" };
  }

  if (isBankDown(downtime, c.issuerBank, simDay)) {
    return { kind: "ISSUER_DOWNTIME", issuerBank: c.issuerBank };
  }
  if (rng.bool(PRE_DEBIT_NOTICE_FAILURE_RATE[c.instrumentType])) {
    return { kind: "PRE_DEBIT_NOTICE_FAILED" };
  }

  const pFunds = pSufficientFunds(c, simDay, rng);
  let pBalanceFailure = BALANCE_FAILURE_WEIGHT * (1 - pFunds);

  if (requiresAfa(c)) pBalanceFailure += AFA_FAILURE_PENALTY;

  if (rng.bool(clamp01(pBalanceFailure))) return { kind: "INSUFFICIENT_FUNDS" };
  if (rng.bool(DO_NOT_HONOUR_RATE[c.instrumentType])) {
    return { kind: "DO_NOT_HONOUR" };
  }
  if (rng.bool(TECHNICAL_FAILURE_RATE[c.instrumentType])) {
    return { kind: "TECHNICAL_DECLINE" };
  }
  return null; // debit succeeded
}

export interface FailureWave {
  readonly rows: LedgerRow[];

  readonly latent: ReadonlyMap<string, LatentFailure>;
  readonly downtime: DowntimeSchedule;
  readonly customers: readonly Customer[];
}

export function generateFailureWave(
  rng: Rng,
  customers: readonly Customer[],
  downtime: DowntimeSchedule,
  options: { readonly billingDaySpread?: number } = {},
): FailureWave {
  const spread = options.billingDaySpread ?? MONTH_DAYS;
  const causeRng = rng.fork("cause");
  const codeRng = rng.fork("code");
  const dayRng = rng.fork("billing-day");

  const rows: LedgerRow[] = [];
  const latent = new Map<string, LatentFailure>();

  for (const customer of customers) {
    const failedOnDay = dayRng.int(0, spread - 1);
    const trueCause = determineTrueCause(customer, failedOnDay, downtime, causeRng);
    if (trueCause === null) continue;

    const rawCode = rawCodeFor(codeRng, trueCause);
    const rowId = `led_${customer.id.slice(5)}`;

    rows.push(
      newLedgerRow({
        id: rowId,
        source: "RECURRING_FAILURE",
        amountPaise: customer.presentedPaise,
        customerId: customer.id,
        rawCode,
        failedOnDay,
        instrumentType: customer.instrumentType,
        segment: customer.segment,
        issuerBank: customer.issuerBank,
        cycleNumber: 1,
      }),
    );

    latent.set(rowId, { rowId, customer, trueCause, rawCode, failedOnDay });
  }

  rows.sort((a, b) => a.failedOnDay - b.failedOnDay || a.id.localeCompare(b.id));

  return { rows, latent, downtime, customers };
}

export function buildWorld(
  seed: string = SIM.DEFAULT_SEED,
  customerCount: number = SIM.CUSTOMERS,
): FailureWave {
  const root = new Rng(seed);
  const customers = generatePopulation(root.fork("population"), customerCount);
  const downtime = generateDowntime(root.fork("downtime"), SIM.HORIZON_DAYS + 10);
  return generateFailureWave(root.fork("failures"), customers, downtime);
}
