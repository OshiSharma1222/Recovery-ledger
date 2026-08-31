import "server-only";

import { classify, describeCause, type Classification } from "@/core/classify";
import type { LedgerRow } from "@/core/ledger";
import { runBenchmark, type BenchReport } from "@/core/bench/run";
import { assessAllCases, type AssessedCase } from "@/core/disputes/cases";
import { merchantMandateRecord } from "@/core/simulator/population";

export interface LedgerView {
  readonly row: LedgerRow;
  readonly classification: Classification | null;
  readonly causeDescription: string | null;

  readonly dispute: AssessedCase | null;
}

let cachedReport: BenchReport | null = null;
let cachedViews: LedgerView[] | null = null;

export function getReport(): BenchReport {
  if (!cachedReport) cachedReport = runBenchmark();
  return cachedReport;
}

export function getLedger(): LedgerView[] {
  if (cachedViews) return cachedViews;

  const report = getReport();
  const b3 = report.results.find((r) => r.policyId === "B3");
  if (!b3) throw new Error("benchmark did not produce a B3 result");

  const lane1: LedgerView[] = b3.rows.map((row) => {
    const failure = report.world.latent.get(row.id);
    const classification = failure
      ? classify({
          row,
          mandate: merchantMandateRecord(failure.customer),
          issuerDegraded: false,
        })
      : null;
    return {
      row,
      classification,
      causeDescription: classification ? describeCause(classification.cause) : null,
      dispute: null,
    };
  });

  const lane2: LedgerView[] = assessAllCases().map((assessed) => ({
    row: assessed.row,
    classification: null,
    causeDescription: null,
    dispute: assessed,
  }));

  cachedViews = [...lane2, ...lane1];
  return cachedViews;
}

export function getRow(id: string): LedgerView | null {
  return getLedger().find((v) => v.row.id === id) ?? null;
}

export function getSummary() {
  const ledger = getLedger();
  const atRisk = ledger.reduce((s, v) => s + v.row.amountPaise, 0);
  const recovered = ledger.reduce((s, v) => s + v.row.recoveredPaise, 0);
  const abandoned = ledger.filter((v) => v.row.status === "ABANDONED").length;
  const disputes = ledger.filter((v) => v.row.source === "DISPUTE").length;
  return {
    rows: ledger.length,
    atRisk,
    recovered,
    abandoned,
    disputes,
    failures: ledger.length - disputes,
  };
}
