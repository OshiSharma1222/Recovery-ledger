import { classify } from "../classify.js";
import { newLedgerRow } from "../ledger.js";
import { Rng } from "../simulator/rng.js";
import { SIM } from "../simulator/params.js";
import {
  buildWorld,
  dayOfMonth,
  merchantMandateRecord,
  type FailureWave,
} from "../simulator/population.js";
import { resolveAction } from "../simulator/environment.js";
import { featureKindFor, TimingEstimator } from "./timing.js";

export const PROBE_OFFSETS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
];

export interface TrainingResult {
  readonly estimator: TimingEstimator;
  readonly rowsProbed: number;
  readonly observations: number;
  readonly seed: string;
}

export function trainTimingEstimator(options: {
  readonly seed: string;
  readonly customers?: number;
  readonly probesPerRow?: number;
}): TrainingResult {
  const world: FailureWave = buildWorld(
    options.seed,
    options.customers ?? SIM.CUSTOMERS,
  );
  const estimator = new TimingEstimator();
  const rng = new Rng(`${options.seed}:probe`);
  const probesPerRow = options.probesPerRow ?? 6;

  let observations = 0;

  for (const row of world.rows) {
    const failure = world.latent.get(row.id);
    if (!failure) continue;

    const { cause } = classify({
      row,
      mandate: merchantMandateRecord(failure.customer),

      issuerDegraded: false,
    });

    const offsets = rng.shuffled(PROBE_OFFSETS).slice(0, probesPerRow);
    for (const offset of offsets) {
      const day = row.failedOnDay + offset;
      if (day > SIM.HORIZON_DAYS) continue;

      const outcome = resolveAction(
        {
          failure,
          downtime: world.downtime,
          priorNudges: 0,
          priorAttempts: 0,
        },
        { kind: "RETRY_AT", dayOffset: offset, expectedSuccess: 0 },
        rng,
      );

      const feature =
        featureKindFor(cause.kind) === "CALENDAR_DAY" ? dayOfMonth(day) : offset;

      estimator.observe({
        cause: cause.kind,
        segment: row.segment,
        feature,
        success: outcome.recovered,
      });
      observations += 1;
    }
  }

  return {
    estimator,
    rowsProbed: world.rows.length,
    observations,
    seed: options.seed,
  };
}

export function assertDisjointSeeds(trainSeed: string, testSeed: string): void {
  if (trainSeed === testSeed) {
    throw new Error(
      `Training and evaluation seeds are identical ("${trainSeed}"). The timing ` +
        `estimator would be fitted on the same customers it is scored against, ` +
        `and the reported lift would be leakage rather than learning.`,
    );
  }
}

export const TRAIN_SEED = `${SIM.DEFAULT_SEED}:train`;
export const TEST_SEED = `${SIM.DEFAULT_SEED}:test`;
