/**
 * Fitting the timing estimator.
 *
 * ## The train/test split is the important part
 *
 * The estimator is fitted on a population generated from a DIFFERENT seed than
 * the one the benchmark evaluates on. Fitting and scoring on the same
 * customers would be leakage, and the resulting lift would be an artefact of
 * memorising individual people rather than learning that balances recover
 * after payday. `assertDisjointSeeds` makes that structural instead of a
 * convention someone can quietly break later.
 *
 * ## Training uses CLASSIFIED causes, not true causes
 *
 * Observations are keyed by what `classify()` says, never by the simulator's
 * private truth. At inference the policy only ever has a classified cause, so
 * training on ground truth would produce a table it cannot actually address.
 * It also means classifier errors propagate into the fitted table exactly as
 * they would in production -- which is the honest outcome, not a bug.
 *
 * ## Stated limitation
 *
 * Real merchant history is not a clean random probe. It is whatever the old
 * dunning system happened to do, which means it is heavily confounded: you
 * mostly observe outcomes at day 1, 3 and 5 because that is where the old
 * system retried. Uniform exploration over offsets is an idealisation that
 * makes the estimator's job easier than reality would, and it belongs in the
 * README's limitations section rather than being glossed over here.
 */

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

/** Retry offsets the probe explores, in days after the failure. */
export const PROBE_OFFSETS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
];

export interface TrainingResult {
  readonly estimator: TimingEstimator;
  readonly rowsProbed: number;
  readonly observations: number;
  readonly seed: string;
}

/**
 * Probe a training world and count outcomes.
 *
 * Each row is probed at several independent offsets. These probes are
 * counterfactuals -- what WOULD have happened had we retried on day k -- which
 * is exactly what a merchant accumulates over months of real dunning, just
 * without the confounding.
 */
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
      // The downtime feed is not consulted during training; it only sharpens
      // confidence, never the cause, and leaving it out keeps the probe
      // independent of feed availability.
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

/**
 * Guard against the mistake that would silently invalidate every number the
 * benchmark prints. Called by the bench harness before it runs.
 */
export function assertDisjointSeeds(trainSeed: string, testSeed: string): void {
  if (trainSeed === testSeed) {
    throw new Error(
      `Training and evaluation seeds are identical ("${trainSeed}"). The timing ` +
        `estimator would be fitted on the same customers it is scored against, ` +
        `and the reported lift would be leakage rather than learning.`,
    );
  }
}

/** Conventional seeds, so train/test separation is visible at a glance. */
export const TRAIN_SEED = `${SIM.DEFAULT_SEED}:train`;
export const TEST_SEED = `${SIM.DEFAULT_SEED}:test`;
