import type {
  CustomerSegment,
  InstrumentType,
  RecoveryAction,
  RootCause,
} from "./taxonomy.js";

export type LedgerSource = "RECURRING_FAILURE" | "DISPUTE";

export type LedgerStatus =

  | "OPEN"

  | "IN_PROGRESS"

  | "RECOVERED"

  | "ABANDONED"

  | "LOST";

export interface LedgerRow {
  readonly id: string;
  readonly source: LedgerSource;

  readonly amountPaise: number;
  readonly customerId: string;

  readonly rawCode: string;

  rootCause: RootCause | null;

  action: RecoveryAction | null;

  actionDayOffset: number | null;

  status: LedgerStatus;

  attempts: number;

  nudges: number;
  recoveredPaise: number;

  rationale: string;

  readonly failedOnDay: number;

  resolvedOnDay: number | null;

  readonly instrumentType: InstrumentType;
  readonly segment: CustomerSegment;
  readonly issuerBank: string;

  readonly cycleNumber: number;
}

export const TERMINAL_STATUSES: ReadonlySet<LedgerStatus> = new Set<LedgerStatus>([
  "RECOVERED",
  "ABANDONED",
  "LOST",
]);

export function isResolved(row: LedgerRow): boolean {
  return TERMINAL_STATUSES.has(row.status);
}

export function newLedgerRow(input: {
  id: string;
  source: LedgerSource;
  amountPaise: number;
  customerId: string;
  rawCode: string;
  failedOnDay: number;
  instrumentType: InstrumentType;
  segment: CustomerSegment;
  issuerBank: string;
  cycleNumber: number;
}): LedgerRow {
  return {
    ...input,
    rootCause: null,
    action: null,
    actionDayOffset: null,
    status: "OPEN",
    attempts: 1, // the failed debit itself already cost one attempt
    nudges: 0,
    recoveredPaise: 0,
    rationale: "",
    resolvedOnDay: null,
  };
}

export function cloneRow(row: LedgerRow): LedgerRow {
  return { ...row };
}
