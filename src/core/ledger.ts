/**
 * The Recovery Ledger.
 *
 * One table. Every at-risk rupee is a row, whether it was never captured
 * (a failed recurring debit) or was captured and clawed back (a dispute).
 * Both sources feed the same schema and the same policy interface, which is
 * the structural claim of the whole project: recovery is one problem, not two.
 *
 * Nothing in this file imports React or Next. `src/core/` is a plain
 * TypeScript library that happens to have a dashboard bolted onto it.
 */

import type {
  CustomerSegment,
  InstrumentType,
  RecoveryAction,
  RootCause,
} from "./taxonomy.js";

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

/** Which recovery lane produced this row. A third source would slot in here. */
export type LedgerSource = "RECURRING_FAILURE" | "DISPUTE";

export type LedgerStatus =
  /** Classified, no action taken yet. */
  | "OPEN"
  /** An action has fired and we are waiting on the outcome. */
  | "IN_PROGRESS"
  /** Money came back. */
  | "RECOVERED"
  /** We chose to stop spending attempts. A decision, not a failure. */
  | "ABANDONED"
  /** We tried and ran out of runway. A failure, not a decision. */
  | "LOST";

export interface LedgerRow {
  readonly id: string;
  readonly source: LedgerSource;

  /** Integer paise, matching Razorpay's API. Never a float. */
  readonly amountPaise: number;
  readonly customerId: string;

  /** The gateway string exactly as received, before any interpretation. */
  readonly rawCode: string;

  /** Populated by the classifier. Null until classified. */
  rootCause: RootCause | null;
  /** Populated by the policy engine. Null until a decision is made. */
  action: RecoveryAction | null;
  /** Days from the original failure at which the action fires. */
  actionDayOffset: number | null;

  status: LedgerStatus;
  /** Debit attempts consumed against the mandate so far. */
  attempts: number;
  /** Customer-facing messages sent. The annoyance proxy. */
  nudges: number;
  recoveredPaise: number;
  /** Human-readable justification. Surfaced verbatim in the dashboard. */
  rationale: string;

  /** Day index of the original failure, relative to the simulation start. */
  readonly failedOnDay: number;
  /** Day the row reached a terminal status. */
  resolvedOnDay: number | null;

  // Context the policy is allowed to see. Note this is strictly coarser than
  // the simulator's latent customer state -- the policy cannot see salary day,
  // balance curve, or true mandate expiry. It has to infer.
  readonly instrumentType: InstrumentType;
  readonly segment: CustomerSegment;
  readonly issuerBank: string;
  /** Which presentment of this subscription failed (1 = first ever). */
  readonly cycleNumber: number;
}

/** Statuses from which no further action is taken. */
export const TERMINAL_STATUSES: ReadonlySet<LedgerStatus> = new Set<LedgerStatus>([
  "RECOVERED",
  "ABANDONED",
  "LOST",
]);

export function isResolved(row: LedgerRow): boolean {
  return TERMINAL_STATUSES.has(row.status);
}

// ---------------------------------------------------------------------------
// Construction helper
// ---------------------------------------------------------------------------

/**
 * Build an unclassified, undecided row. Classification and policy are separate
 * steps on purpose: the benchmark runs several policies over the same set of
 * freshly-created rows, so creation must not bake in a decision.
 */
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

/** Deep-ish copy so each policy run gets its own mutable ledger. */
export function cloneRow(row: LedgerRow): LedgerRow {
  return { ...row };
}
