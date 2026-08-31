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

const DEFAULT_KEY = "__default__";
const reportCache = new Map<string, BenchReport>();
const ledgerCache = new Map<string, LedgerView[]>();

export function normalizeSeed(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().slice(0, 40).replace(/[^\w\s.-]/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}

export function getReport(seed?: string): BenchReport {
  const key = seed ?? DEFAULT_KEY;
  const cached = reportCache.get(key);
  if (cached) return cached;

  if (reportCache.size > 30) reportCache.clear();
  const report = seed
    ? runBenchmark({ trainSeed: `${seed}:train`, testSeed: `${seed}:test` })
    : runBenchmark();
  reportCache.set(key, report);
  return report;
}

export function getLedger(seed?: string): LedgerView[] {
  const key = seed ?? DEFAULT_KEY;
  const cached = ledgerCache.get(key);
  if (cached) return cached;

  const report = getReport(seed);
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

  if (ledgerCache.size > 30) ledgerCache.clear();
  const views = [...lane2, ...lane1];
  ledgerCache.set(key, views);
  return views;
}

export function getRow(id: string, seed?: string): LedgerView | null {
  return getLedger(seed).find((v) => v.row.id === id) ?? null;
}

export function getSummary(seed?: string) {
  const ledger = getLedger(seed);
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

export interface ReplayRow {
  readonly id: string;
  readonly amountPaise: number;
  readonly failedDay: number;
  readonly resolvedDay: number;
  readonly status: "RECOVERED" | "ABANDONED" | "LOST";
  readonly actionKind: string;
  readonly causeKind: string;
}

export interface ReplayPolicy {
  readonly id: string;
  readonly name: string;
  readonly rows: readonly ReplayRow[];
}

export interface ReplayData {
  readonly horizon: number;
  readonly atRiskPaise: number;
  readonly policies: readonly ReplayPolicy[];
}

export function getReplay(seed?: string): ReplayData {
  const report = getReport(seed);
  const horizon = Math.max(
    ...report.results.flatMap((r) => r.rows.map((x) => x.resolvedOnDay ?? 0)),
  );

  const toReplay = (policyId: string): ReplayPolicy => {
    const result = report.results.find((r) => r.policyId === policyId);
    if (!result) throw new Error(`no result for ${policyId}`);
    return {
      id: result.policyId,
      name: result.policyName,
      rows: result.rows.map((row) => ({
        id: row.id,
        amountPaise: row.amountPaise,
        failedDay: row.failedOnDay,
        resolvedDay: row.resolvedOnDay ?? horizon,
        status:
          row.status === "RECOVERED" || row.status === "ABANDONED"
            ? row.status
            : "LOST",
        actionKind: row.action?.kind.toLowerCase() ?? "none",
        causeKind: row.rootCause?.kind.toLowerCase() ?? "unclassified",
      })),
    };
  };

  return {
    horizon,
    atRiskPaise: report.metrics[0]?.atRiskPaise ?? 0,
    policies: [toReplay("B1"), toReplay("B3")],
  };
}
