import type { LedgerRow } from "../ledger.js";
import { isTerminal } from "../taxonomy.js";
import type { LatentFailure } from "../simulator/population.js";

export interface Metrics {
  readonly policyId: string;
  readonly policyName: string;

  readonly atRiskPaise: number;
  readonly recoveredPaise: number;

  readonly recoveryRate: number;

  readonly rowsTotal: number;
  readonly rowsRecovered: number;
  readonly rowsAbandoned: number;
  readonly rowsLost: number;

  readonly retries: number;

  readonly nudges: number;

  readonly wastedRetries: number;

  readonly unrecoverablePaise: number;

  readonly retriesPerRecovery: number;

  readonly meanDaysToRecovery: number;

  ceilingCapture: number | null;
}

export interface RunResult {
  readonly policyId: string;
  readonly policyName: string;
  readonly rows: readonly LedgerRow[];
}

export function computeMetrics(
  result: RunResult,
  latent: ReadonlyMap<string, LatentFailure>,
): Metrics {
  let atRiskPaise = 0;
  let recoveredPaise = 0;
  let rowsRecovered = 0;
  let rowsAbandoned = 0;
  let rowsLost = 0;
  let retries = 0;
  let nudges = 0;
  let wastedRetries = 0;
  let unrecoverablePaise = 0;
  let daysToRecoverySum = 0;

  for (const row of result.rows) {
    atRiskPaise += row.amountPaise;
    recoveredPaise += row.recoveredPaise;

    const rowRetries = Math.max(0, row.attempts - 1);
    retries += rowRetries;
    nudges += row.nudges;

    switch (row.status) {
      case "RECOVERED":
        rowsRecovered += 1;
        if (row.resolvedOnDay !== null) {
          daysToRecoverySum += row.resolvedOnDay - row.failedOnDay;
        }
        break;
      case "ABANDONED":
        rowsAbandoned += 1;
        break;
      case "LOST":
        rowsLost += 1;
        break;
      default:

        rowsLost += 1;
        break;
    }

    const failure = latent.get(row.id);
    if (failure && isTerminal(failure.trueCause)) {
      unrecoverablePaise += row.amountPaise;
      wastedRetries += rowRetries;
    }
  }

  return {
    policyId: result.policyId,
    policyName: result.policyName,
    atRiskPaise,
    recoveredPaise,
    recoveryRate: atRiskPaise === 0 ? 0 : recoveredPaise / atRiskPaise,
    rowsTotal: result.rows.length,
    rowsRecovered,
    rowsAbandoned,
    rowsLost,
    retries,
    nudges,
    wastedRetries,
    unrecoverablePaise,
    retriesPerRecovery: rowsRecovered === 0 ? Infinity : retries / rowsRecovered,
    meanDaysToRecovery: rowsRecovered === 0 ? 0 : daysToRecoverySum / rowsRecovered,
    ceilingCapture: null,
  };
}

export function withCeilingCapture(
  metrics: readonly Metrics[],
  oraclePolicyId = "B4",
): Metrics[] {
  const oracle = metrics.find((m) => m.policyId === oraclePolicyId);
  if (!oracle || oracle.recoveredPaise === 0) {
    return metrics.map((m) => ({ ...m }));
  }
  return metrics.map((m) => ({
    ...m,
    ceilingCapture: m.recoveredPaise / oracle.recoveredPaise,
  }));
}
