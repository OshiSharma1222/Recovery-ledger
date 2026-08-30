/**
 * Benchmark metrics.
 *
 * Every one of these is reported, and that is a deliberate choice rather than
 * thoroughness for its own sake. A policy that recovers slightly less money
 * while sending half the nudges and burning a third of the attempts is
 * arguably the better policy, and a single headline recovery rate hides that
 * entirely. Reporting the full set is also the only honest way to present a
 * result where the system under test does not win on every axis.
 */

import type { LedgerRow } from "../ledger.js";
import { isTerminal } from "../taxonomy.js";
import type { LatentFailure } from "../simulator/population.js";

export interface Metrics {
  readonly policyId: string;
  readonly policyName: string;

  /** Rupees at risk across the whole ledger, in paise. */
  readonly atRiskPaise: number;
  readonly recoveredPaise: number;
  /** recoveredPaise / atRiskPaise. */
  readonly recoveryRate: number;

  readonly rowsTotal: number;
  readonly rowsRecovered: number;
  readonly rowsAbandoned: number;
  readonly rowsLost: number;

  /** Debit attempts beyond the original failed presentment. */
  readonly retries: number;
  /** Customer-facing messages sent. The annoyance proxy. */
  readonly nudges: number;

  /**
   * Retries spent on rows whose TRUE cause is terminal.
   *
   * Measured against the simulator's ground truth, not against what any
   * policy believed. This is a measurement, never an input to a decision --
   * no policy is allowed to see it.
   */
  readonly wastedRetries: number;
  /** Money that could never have been recovered, in paise. */
  readonly unrecoverablePaise: number;

  /** Retries per successful recovery. Lower is better. Infinity if none. */
  readonly retriesPerRecovery: number;
  /** Mean days from failure to money landing, over recovered rows only. */
  readonly meanDaysToRecovery: number;

  /** recoveredPaise / oracle's recoveredPaise. Set by the runner. */
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

    // `attempts` starts at 1 for the original failed presentment, which no
    // policy chose and none should be charged for.
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
        // OPEN / IN_PROGRESS at the horizon count as lost: the money did not
        // come back, and calling it anything softer would flatter the policy.
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

/**
 * Fill in each policy's share of the oracle's recovery.
 *
 * This is the number worth quoting. "61% of at-risk rupees" invites the
 * question "out of what?"; "78% of everything that was recoverable at all"
 * answers it, and shows the difference between a result and a bound.
 */
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
