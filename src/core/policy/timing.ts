/**
 * The learned component: P(success | cause, segment, timing).
 *
 * This is the ONLY part of the system that is fitted rather than authored.
 * `classify.ts` is rules and says so; this file is where the lift over
 * fixed-schedule dunning actually comes from.
 *
 * ## Why a counting estimator and not a model
 *
 * TypeScript has no mature scikit-learn and I did not go looking for a
 * JavaScript substitute. At this problem size a smoothed contingency table is
 * cheaper to write than a dependency is to justify, and it has a property a
 * fitted model does not: when a merchant asks "why did you retry on the 3rd?",
 * the answer is a cell you can point at, with the trial count that produced it.
 *
 * ## Hierarchical shrinkage rather than flat Laplace
 *
 * Bucketing by (cause, segment, day) creates ~900 cells, and the thin ones
 * would be noise under flat Laplace smoothing -- a cell with 1 success in 1
 * trial should not read as 100%. Each level instead shrinks toward its parent:
 *
 *     (cause, segment, day)  ->  (cause, day)  ->  (cause)  ->  global
 *
 * A cell with no data inherits its parent's estimate exactly; a cell with
 * plenty of data overrides it. That is a genuine hierarchical Bayesian prior,
 * it is about forty lines, and it is the right amount of machinery here.
 *
 * ## The feature depends on the cause
 *
 * This matters more than the smoothing. For INSUFFICIENT_FUNDS the predictive
 * variable is WHERE IN THE MONTH the debit is presented, because that is where
 * the balance curve lives. For downtime and technical faults it is HOW LONG we
 * waited, because those decay with elapsed time and do not care about the
 * calendar. Conditioning both on the same axis would blur two unrelated
 * mechanisms together and is, I suspect, roughly what fixed-schedule dunning
 * does implicitly.
 */

import type { CustomerSegment, RootCauseKind } from "../taxonomy.js";

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/**
 * Which axis carries the signal for a given cause.
 *
 * CALENDAR_DAY  - day of month (1..30). Balance-driven causes.
 * ELAPSED_DAYS  - days waited since the failure. Time-decaying causes.
 */
export type FeatureKind = "CALENDAR_DAY" | "ELAPSED_DAYS";

export function featureKindFor(cause: RootCauseKind): FeatureKind {
  return cause === "INSUFFICIENT_FUNDS" ? "CALENDAR_DAY" : "ELAPSED_DAYS";
}

export interface TimingObservation {
  readonly cause: RootCauseKind;
  readonly segment: CustomerSegment;
  /** Day of month for CALENDAR_DAY causes, days waited for ELAPSED_DAYS. */
  readonly feature: number;
  readonly success: boolean;
}

interface Cell {
  successes: number;
  trials: number;
}

const emptyCell = (): Cell => ({ successes: 0, trials: 0 });

/**
 * Pseudo-count controlling how fast a cell escapes its parent's prior. At 8,
 * a cell needs roughly a dozen observations before it meaningfully asserts
 * itself, which suppresses the 1-of-1 cells without flattening real signal.
 */
const SHRINKAGE = 8;

// ---------------------------------------------------------------------------
// Estimator
// ---------------------------------------------------------------------------

export class TimingEstimator {
  /** (cause | segment | feature) -> cell */
  private readonly full = new Map<string, Cell>();
  /** (cause | feature) -> cell */
  private readonly byCauseFeature = new Map<string, Cell>();
  /** (cause) -> cell */
  private readonly byCause = new Map<string, Cell>();
  private readonly global: Cell = emptyCell();

  private static bump(map: Map<string, Cell>, key: string, success: boolean): void {
    let cell = map.get(key);
    if (!cell) {
      cell = emptyCell();
      map.set(key, cell);
    }
    cell.trials += 1;
    if (success) cell.successes += 1;
  }

  observe(o: TimingObservation): void {
    const f = Math.round(o.feature);
    TimingEstimator.bump(this.full, `${o.cause}|${o.segment}|${f}`, o.success);
    TimingEstimator.bump(this.byCauseFeature, `${o.cause}|${f}`, o.success);
    TimingEstimator.bump(this.byCause, o.cause, o.success);
    this.global.trials += 1;
    if (o.success) this.global.successes += 1;
  }

  observeMany(observations: Iterable<TimingObservation>): void {
    for (const o of observations) this.observe(o);
  }

  /** Shrink a cell toward a prior. Empty cell returns the prior unchanged. */
  private static shrink(cell: Cell | undefined, prior: number): number {
    if (!cell || cell.trials === 0) return prior;
    return (cell.successes + SHRINKAGE * prior) / (cell.trials + SHRINKAGE);
  }

  /**
   * P(success | cause, segment, feature), walking the hierarchy down from the
   * global rate to the specific cell.
   */
  probability(
    cause: RootCauseKind,
    segment: CustomerSegment,
    feature: number,
  ): number {
    const f = Math.round(feature);

    const globalRate =
      this.global.trials === 0 ? 0.3 : this.global.successes / this.global.trials;
    const causeRate = TimingEstimator.shrink(this.byCause.get(cause), globalRate);
    const causeFeatureRate = TimingEstimator.shrink(
      this.byCauseFeature.get(`${cause}|${f}`),
      causeRate,
    );
    return TimingEstimator.shrink(
      this.full.get(`${cause}|${segment}|${f}`),
      causeFeatureRate,
    );
  }

  /** Observation count behind a specific cell. Drives the confidence story. */
  support(cause: RootCauseKind, segment: CustomerSegment, feature: number): number {
    return this.full.get(`${cause}|${segment}|${Math.round(feature)}`)?.trials ?? 0;
  }

  /**
   * The best feature value in a candidate set, with its estimated probability.
   *
   * This is what the policy engine actually calls. Ties break toward the
   * earlier candidate, because recovering the same rupee sooner is strictly
   * better for working capital.
   */
  best(
    cause: RootCauseKind,
    segment: CustomerSegment,
    candidates: readonly number[],
  ): { feature: number; probability: number; support: number } {
    if (candidates.length === 0) {
      throw new Error("TimingEstimator.best called with no candidates");
    }
    let bestFeature = candidates[0]!;
    let bestP = -1;
    for (const candidate of candidates) {
      const p = this.probability(cause, segment, candidate);
      if (p > bestP + 1e-9) {
        bestP = p;
        bestFeature = candidate;
      }
    }
    return {
      feature: bestFeature,
      probability: bestP,
      support: this.support(cause, segment, bestFeature),
    };
  }

  /**
   * A human-readable curve for one (cause, segment). Powers the "why day 3?"
   * answer on the row detail screen -- the interpretability this estimator was
   * chosen for is worth nothing if it is never surfaced.
   */
  curve(
    cause: RootCauseKind,
    segment: CustomerSegment,
    features: readonly number[],
  ): { feature: number; probability: number; support: number }[] {
    return features.map((f) => ({
      feature: f,
      probability: this.probability(cause, segment, f),
      support: this.support(cause, segment, f),
    }));
  }

  /** Total observations. Printed by the benchmark so training size is visible. */
  get observationCount(): number {
    return this.global.trials;
  }

  /** Serialisable snapshot, so a trained table can be committed and inspected. */
  toJSON(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const [k, v] of this.full) out[k] = [v.successes, v.trials];
    return out;
  }
}
