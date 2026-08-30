/**
 * The benchmark harness.
 *
 * Runs every policy over the SAME seeded population and reports the same
 * metrics for each. No native dependencies anywhere on this path -- see the
 * header of `ledger-store.ts` for why that matters.
 *
 * ## Common random numbers
 *
 * The world's randomness is seeded per (row, attempt number), not per policy.
 * If B1 and B3 both re-present the same debit on the same day, they get the
 * same coin flip. Without this, a large slice of any observed difference
 * between policies would be sampling noise rather than policy quality, and
 * with 900-odd rows that noise is not small. It is the cheapest variance
 * reduction available and it costs one line.
 *
 * ## What each policy sees
 *
 * Every policy is handed the same classification, produced by the same
 * classifier from the same raw code. Only B4 additionally receives the
 * `OracleView`. B1 and B2 ignore the classification entirely, which is the
 * point of including them: that is what fixed-schedule dunning does.
 */

import { classify } from "../classify.js";
import { cloneRow, type LedgerRow } from "../ledger.js";
import {
  ALL_POLICIES,
  merchantMandateRecord,
  type Policy,
} from "../policy/baselines.js";
import { TimingEstimator } from "../policy/timing.js";
import {
  assertDisjointSeeds,
  trainTimingEstimator,
  TEST_SEED,
  TRAIN_SEED,
} from "../policy/train.js";
import { resolveAction } from "../simulator/environment.js";
import { assertParamsWellFormed, SIM } from "../simulator/params.js";
import { buildWorld, type FailureWave } from "../simulator/population.js";
import { Rng } from "../simulator/rng.js";
import { assertNever } from "../taxonomy.js";
import {
  computeMetrics,
  withCeilingCapture,
  type Metrics,
  type RunResult,
} from "./metrics.js";

export interface BenchOptions {
  readonly trainSeed?: string;
  readonly testSeed?: string;
  readonly customers?: number;
}

export interface BenchReport {
  readonly metrics: readonly Metrics[];
  readonly results: readonly RunResult[];
  readonly world: FailureWave;
  readonly trainSeed: string;
  readonly testSeed: string;
  readonly customers: number;
  readonly trainingObservations: number;
  readonly classifierAccuracy: number;
  readonly elapsedMs: number;
}

/**
 * Run one policy over the whole ledger.
 *
 * Each row is driven to a terminal status: recovered, abandoned, or out of
 * budget. The loop is bounded twice over -- by the attempt cap and by an
 * explicit iteration guard -- because a policy that returns a non-terminal
 * action forever would otherwise hang the benchmark rather than fail it.
 */
function runPolicy(
  policy: Policy,
  world: FailureWave,
  estimator: TimingEstimator,
  testSeed: string,
): RunResult {
  const rows: LedgerRow[] = [];

  for (const original of world.rows) {
    const row = cloneRow(original);
    const failure = world.latent.get(row.id);
    if (!failure) continue;

    const classification = classify({
      row,
      mandate: merchantMandateRecord(failure.customer),
      issuerDegraded: false,
    });
    row.rootCause = classification.cause;

    let guard = 0;
    while (guard++ < SIM.MAX_ATTEMPTS + 4) {
      const retriesSpent = Math.max(0, row.attempts - 1);

      const decision = policy.decide({
        row,
        classification,
        estimator,
        attemptsSpent: row.attempts,
        retriesSpent,
        nudgesSent: row.nudges,
        oracle: policy.usesOracle
          ? { failure, downtime: world.downtime }
          : null,
      });

      row.action = decision.action;
      row.actionDayOffset = decision.dayOffset;
      row.rationale = decision.rationale;

      if (decision.action.kind === "ABANDON") {
        row.status = "ABANDONED";
        row.resolvedOnDay = row.failedOnDay + decision.dayOffset;
        break;
      }

      // Common random numbers: keyed on the row and how many attempts have
      // been spent, never on which policy is asking.
      const rng = new Rng(`${testSeed}:outcome:${row.id}:${row.attempts}`);

      const outcome = resolveAction(
        {
          failure,
          downtime: world.downtime,
          priorNudges: row.nudges,
          priorAttempts: retriesSpent,
        },
        decision.action,
        rng,
      );

      row.attempts += outcome.attemptsUsed;
      row.nudges += outcome.nudgesUsed;

      if (outcome.recovered) {
        row.status = "RECOVERED";
        row.recoveredPaise = row.amountPaise;
        row.resolvedOnDay = outcome.recoveredOnDay;
        break;
      }

      row.status = "IN_PROGRESS";

      // Out of budget, or the action could not fire at all. A policy that
      // keeps proposing actions costing nothing would spin forever otherwise.
      if (row.attempts >= SIM.MAX_ATTEMPTS) {
        row.status = "LOST";
        row.resolvedOnDay = SIM.HORIZON_DAYS;
        break;
      }
      if (outcome.attemptsUsed === 0 && outcome.nudgesUsed === 0) {
        row.status = "LOST";
        row.resolvedOnDay = SIM.HORIZON_DAYS;
        break;
      }
    }

    if (row.status === "IN_PROGRESS" || row.status === "OPEN") {
      row.status = "LOST";
      row.resolvedOnDay = SIM.HORIZON_DAYS;
    }

    rows.push(row);
  }

  return { policyId: policy.id, policyName: policy.name, rows };
}

export function runBenchmark(options: BenchOptions = {}): BenchReport {
  const started = Date.now();
  assertParamsWellFormed();

  const trainSeed = options.trainSeed ?? TRAIN_SEED;
  const testSeed = options.testSeed ?? TEST_SEED;
  const customers = options.customers ?? SIM.CUSTOMERS;

  // Refuses to run rather than silently reporting leakage as lift.
  assertDisjointSeeds(trainSeed, testSeed);

  const training = trainTimingEstimator({ seed: trainSeed, customers });
  const world = buildWorld(testSeed, customers);

  // Classifier accuracy is reported alongside the results so the reader can
  // see how much of any shortfall is misclassification rather than policy.
  let correct = 0;
  for (const row of world.rows) {
    const failure = world.latent.get(row.id);
    if (!failure) continue;
    const { cause } = classify({
      row,
      mandate: merchantMandateRecord(failure.customer),
      issuerDegraded: false,
    });
    if (cause.kind === failure.trueCause.kind) correct += 1;
  }

  const results = ALL_POLICIES.map((p) =>
    runPolicy(p, world, training.estimator, testSeed),
  );
  const metrics = withCeilingCapture(
    results.map((r) => computeMetrics(r, world.latent)),
  );

  return {
    metrics,
    results,
    world,
    trainSeed,
    testSeed,
    customers,
    trainingObservations: training.observations,
    classifierAccuracy: world.rows.length === 0 ? 0 : correct / world.rows.length,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Assert the invariants that make the comparison meaningful. Called by the
 * bench script before anything is printed, so a broken run fails loudly rather
 * than publishing a wrong table.
 */
export function assertBenchmarkIntegrity(report: BenchReport): void {
  const [first, ...rest] = report.results;
  if (!first) throw new Error("benchmark produced no results");

  // Every policy must have been scored on exactly the same ledger.
  for (const r of rest) {
    if (r.rows.length !== first.rows.length) {
      throw new Error(
        `policy ${r.policyId} scored ${r.rows.length} rows but ${first.policyId} scored ${first.rows.length}`,
      );
    }
  }

  for (const m of report.metrics) {
    if (m.recoveredPaise > m.atRiskPaise) {
      throw new Error(`${m.policyId} recovered more than was at risk`);
    }
    if (m.rowsRecovered + m.rowsAbandoned + m.rowsLost !== m.rowsTotal) {
      throw new Error(`${m.policyId} has rows in no terminal state`);
    }
  }

  const b0 = report.metrics.find((m) => m.policyId === "B0");
  if (b0 && b0.recoveredPaise !== 0) {
    throw new Error("B0 does nothing and must recover nothing");
  }

  const oracle = report.metrics.find((m) => m.policyId === "B4");
  if (oracle) {
    for (const m of report.metrics) {
      if (m.policyId === "B4") continue;
      if (m.recoveredPaise > oracle.recoveredPaise) {
        // Not a crash: the oracle is greedy, not proven optimal, so this is
        // possible in principle. It must be surfaced rather than hidden,
        // because the "% of ceiling" framing stops being meaningful.
        console.warn(
          `  WARNING: ${m.policyId} recovered more than the oracle. The ceiling ` +
            `claim does not hold on this seed and should not be quoted.`,
        );
      }
    }
  }

  // Exhaustiveness is proven at compile time elsewhere; this keeps the import
  // honest so the symbol cannot be dropped without noticing.
  void assertNever;
}
