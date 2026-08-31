import type { CustomerSegment, RootCauseKind } from "../taxonomy.js";

export type FeatureKind = "CALENDAR_DAY" | "ELAPSED_DAYS";

export function featureKindFor(cause: RootCauseKind): FeatureKind {
  return cause === "INSUFFICIENT_FUNDS" ? "CALENDAR_DAY" : "ELAPSED_DAYS";
}

export interface TimingObservation {
  readonly cause: RootCauseKind;
  readonly segment: CustomerSegment;

  readonly feature: number;
  readonly success: boolean;
}

interface Cell {
  successes: number;
  trials: number;
}

const emptyCell = (): Cell => ({ successes: 0, trials: 0 });

const SHRINKAGE = 8;

export class TimingEstimator {
  private readonly full = new Map<string, Cell>();

  private readonly byCauseFeature = new Map<string, Cell>();

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

  private static shrink(cell: Cell | undefined, prior: number): number {
    if (!cell || cell.trials === 0) return prior;
    return (cell.successes + SHRINKAGE * prior) / (cell.trials + SHRINKAGE);
  }

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

  support(cause: RootCauseKind, segment: CustomerSegment, feature: number): number {
    return this.full.get(`${cause}|${segment}|${Math.round(feature)}`)?.trials ?? 0;
  }

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

  get observationCount(): number {
    return this.global.trials;
  }

  toJSON(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const [k, v] of this.full) out[k] = [v.successes, v.trials];
    return out;
  }
}
