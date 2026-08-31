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

  assertDisjointSeeds(trainSeed, testSeed);

  const training = trainTimingEstimator({ seed: trainSeed, customers });
  const world = buildWorld(testSeed, customers);

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

export function assertBenchmarkIntegrity(report: BenchReport): void {
  const [first, ...rest] = report.results;
  if (!first) throw new Error("benchmark produced no results");

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
        console.warn(
          `  WARNING: ${m.policyId} recovered more than the oracle. The ceiling ` +
            `claim does not hold on this seed and should not be quoted.`,
        );
      }
    }
  }

  void assertNever;
}
