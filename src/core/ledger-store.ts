import Database from "better-sqlite3";
import type { Database as Db, Statement } from "better-sqlite3";
import type {
  CustomerSegment,
  InstrumentType,
  RecoveryAction,
  RootCause,
} from "./taxonomy.js";
import type { LedgerRow, LedgerSource, LedgerStatus } from "./ledger.js";

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

export class LedgerStore {
  private readonly db: Db;
  private readonly stmts: {
    insert: Statement<unknown[], unknown>;
    update: Statement<unknown[], unknown>;
    byId: Statement<unknown[], unknown>;
    all: Statement<unknown[], unknown>;
    bySource: Statement<unknown[], unknown>;
  };

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

  reset(): void {
    this.db.exec("DELETE FROM ledger");
  }

  close(): void {
    this.db.close();
  }
}
