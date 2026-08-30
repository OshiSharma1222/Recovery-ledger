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

import Database from "better-sqlite3";
import type { Database as Db, Statement } from "better-sqlite3";
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
// SQL schema
// ---------------------------------------------------------------------------

/**
 * `root_cause` and `action` are stored as JSON text rather than exploded into
 * columns. They are discriminated unions with per-variant payloads, so a
 * relational shredding would need either a wide sparse table or a join per
 * variant. JSON keeps the TypeScript union as the single definition of the
 * shape, and we never query on the payload -- only on `kind`, which is
 * denormalised into its own indexed column.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger (
  id                TEXT PRIMARY KEY,
  source            TEXT NOT NULL CHECK (source IN ('RECURRING_FAILURE','DISPUTE')),
  amount_paise      INTEGER NOT NULL CHECK (amount_paise >= 0),
  customer_id       TEXT NOT NULL,
  raw_code          TEXT NOT NULL,
  root_cause_kind   TEXT,
  root_cause        TEXT,
  action_kind       TEXT,
  action            TEXT,
  action_day_offset INTEGER,
  status            TEXT NOT NULL CHECK (status IN ('OPEN','IN_PROGRESS','RECOVERED','ABANDONED','LOST')),
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  nudges            INTEGER NOT NULL DEFAULT 0 CHECK (nudges >= 0),
  recovered_paise   INTEGER NOT NULL DEFAULT 0 CHECK (recovered_paise >= 0),
  rationale         TEXT NOT NULL DEFAULT '',
  failed_on_day     INTEGER NOT NULL,
  resolved_on_day   INTEGER,
  instrument_type   TEXT NOT NULL,
  segment           TEXT NOT NULL,
  issuer_bank       TEXT NOT NULL,
  cycle_number      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_status ON ledger (status);
CREATE INDEX IF NOT EXISTS idx_ledger_cause  ON ledger (root_cause_kind);
CREATE INDEX IF NOT EXISTS idx_ledger_source ON ledger (source);
`;

// ---------------------------------------------------------------------------
// Row <-> SQL mapping
// ---------------------------------------------------------------------------

interface LedgerRecord {
  id: string;
  source: string;
  amount_paise: number;
  customer_id: string;
  raw_code: string;
  root_cause_kind: string | null;
  root_cause: string | null;
  action_kind: string | null;
  action: string | null;
  action_day_offset: number | null;
  status: string;
  attempts: number;
  nudges: number;
  recovered_paise: number;
  rationale: string;
  failed_on_day: number;
  resolved_on_day: number | null;
  instrument_type: string;
  segment: string;
  issuer_bank: string;
  cycle_number: number;
}

function toRow(r: LedgerRecord): LedgerRow {
  return {
    id: r.id,
    source: r.source as LedgerSource,
    amountPaise: r.amount_paise,
    customerId: r.customer_id,
    rawCode: r.raw_code,
    rootCause: r.root_cause ? (JSON.parse(r.root_cause) as RootCause) : null,
    action: r.action ? (JSON.parse(r.action) as RecoveryAction) : null,
    actionDayOffset: r.action_day_offset,
    status: r.status as LedgerStatus,
    attempts: r.attempts,
    nudges: r.nudges,
    recoveredPaise: r.recovered_paise,
    rationale: r.rationale,
    failedOnDay: r.failed_on_day,
    resolvedOnDay: r.resolved_on_day,
    instrumentType: r.instrument_type as InstrumentType,
    segment: r.segment as CustomerSegment,
    issuerBank: r.issuer_bank,
    cycleNumber: r.cycle_number,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Synchronous SQLite store.
 *
 * better-sqlite3 is synchronous by design, which is exactly right here: the
 * benchmark is a single-threaded CLI loop, and an async driver would buy
 * nothing but await noise. The dashboard reads it from server components.
 */
export class LedgerStore {
  private readonly db: Db;
  private readonly stmts: {
    insert: Statement<unknown[], unknown>;
    update: Statement<unknown[], unknown>;
    byId: Statement<unknown[], unknown>;
    all: Statement<unknown[], unknown>;
    bySource: Statement<unknown[], unknown>;
  };

  /** Pass ':memory:' for the benchmark, a path for the dashboard. */
  constructor(location: string = ":memory:") {
    this.db = new Database(location);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);

    this.stmts = {
      insert: this.db.prepare(`
        INSERT INTO ledger (
          id, source, amount_paise, customer_id, raw_code,
          root_cause_kind, root_cause, action_kind, action, action_day_offset,
          status, attempts, nudges, recovered_paise, rationale,
          failed_on_day, resolved_on_day,
          instrument_type, segment, issuer_bank, cycle_number
        ) VALUES (
          @id, @source, @amount_paise, @customer_id, @raw_code,
          @root_cause_kind, @root_cause, @action_kind, @action, @action_day_offset,
          @status, @attempts, @nudges, @recovered_paise, @rationale,
          @failed_on_day, @resolved_on_day,
          @instrument_type, @segment, @issuer_bank, @cycle_number
        )
      `),
      update: this.db.prepare(`
        UPDATE ledger SET
          root_cause_kind = @root_cause_kind,
          root_cause = @root_cause,
          action_kind = @action_kind,
          action = @action,
          action_day_offset = @action_day_offset,
          status = @status,
          attempts = @attempts,
          nudges = @nudges,
          recovered_paise = @recovered_paise,
          rationale = @rationale,
          resolved_on_day = @resolved_on_day
        WHERE id = @id
      `),
      byId: this.db.prepare(`SELECT * FROM ledger WHERE id = ?`),
      all: this.db.prepare(`SELECT * FROM ledger ORDER BY failed_on_day, id`),
      bySource: this.db.prepare(
        `SELECT * FROM ledger WHERE source = ? ORDER BY failed_on_day, id`,
      ),
    };
  }

  private params(row: LedgerRow): Record<string, unknown> {
    return {
      id: row.id,
      source: row.source,
      amount_paise: row.amountPaise,
      customer_id: row.customerId,
      raw_code: row.rawCode,
      root_cause_kind: row.rootCause?.kind ?? null,
      root_cause: row.rootCause ? JSON.stringify(row.rootCause) : null,
      action_kind: row.action?.kind ?? null,
      action: row.action ? JSON.stringify(row.action) : null,
      action_day_offset: row.actionDayOffset,
      status: row.status,
      attempts: row.attempts,
      nudges: row.nudges,
      recovered_paise: row.recoveredPaise,
      rationale: row.rationale,
      failed_on_day: row.failedOnDay,
      resolved_on_day: row.resolvedOnDay,
      instrument_type: row.instrumentType,
      segment: row.segment,
      issuer_bank: row.issuerBank,
      cycle_number: row.cycleNumber,
    };
  }

  insert(row: LedgerRow): void {
    this.stmts.insert.run(this.params(row));
  }

  /** Bulk insert inside one transaction. Orders of magnitude faster. */
  insertMany(rows: readonly LedgerRow[]): void {
    const tx = this.db.transaction((batch: readonly LedgerRow[]) => {
      for (const row of batch) this.stmts.insert.run(this.params(row));
    });
    tx(rows);
  }

  update(row: LedgerRow): void {
    this.stmts.update.run(this.params(row));
  }

  updateMany(rows: readonly LedgerRow[]): void {
    const tx = this.db.transaction((batch: readonly LedgerRow[]) => {
      for (const row of batch) this.stmts.update.run(this.params(row));
    });
    tx(rows);
  }

  get(id: string): LedgerRow | null {
    const rec = this.stmts.byId.get(id) as LedgerRecord | undefined;
    return rec ? toRow(rec) : null;
  }

  all(): LedgerRow[] {
    return (this.stmts.all.all() as LedgerRecord[]).map(toRow);
  }

  bySource(source: LedgerSource): LedgerRow[] {
    return (this.stmts.bySource.all(source) as LedgerRecord[]).map(toRow);
  }

  /** Replace the whole table. Used by the seed script so it is idempotent. */
  reset(): void {
    this.db.exec("DELETE FROM ledger");
  }

  close(): void {
    this.db.close();
  }
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
