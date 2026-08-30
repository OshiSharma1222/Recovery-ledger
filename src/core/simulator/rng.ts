/**
 * Seeded pseudo-random number generation.
 *
 * `Math.random()` is banned everywhere in this repo. The benchmark's central
 * claim is that a reviewer can clone the repo, run one command, and see the
 * same numbers we published. That is only true if every stochastic decision
 * in the simulator is driven from an explicit seed.
 *
 * Algorithm is sfc32 (Small Fast Counter, 32-bit), seeded through cyrb128 so
 * that a human-readable string can be used as the seed. Both are public
 * domain, ~20 lines, and pass PractRand at the sizes we care about -- which is
 * far more than a benchmark over a few thousand customers needs.
 */

/** Expand an arbitrary string into four 32-bit seed words. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/**
 * A deterministic random source.
 *
 * Pass one of these explicitly rather than reaching for a module-level
 * singleton: separate streams for population generation and for outcome
 * resolution mean that changing the number of policies under test cannot
 * shift the population, which would silently invalidate a comparison.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string) {
    const [a, b, c, d] = cyrb128(seed);
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    // Discard the first few outputs; sfc32 needs a short warm-up before its
    // state is well mixed.
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  /** True with probability p. */
  bool(p: number): boolean {
    return this.next() < p;
  }

  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Rng.pick called on an empty array");
    }
    // Safe: index is bounded by length and length > 0.
    return items[this.int(0, items.length - 1)]!;
  }

  /**
   * Weighted pick. Weights need not sum to 1; they are normalised here.
   * Throws on a non-positive total so a mis-specified table fails loudly
   * instead of silently always returning the first entry.
   */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of entries) {
      if (w < 0) throw new Error("Rng.weighted: negative weight");
      total += w;
    }
    if (total <= 0) throw new Error("Rng.weighted: weights sum to zero");
    let roll = this.next() * total;
    for (const [value, w] of entries) {
      roll -= w;
      if (roll < 0) return value;
    }
    // Floating point can leave a sliver at the top of the range.
    return entries[entries.length - 1]![0];
  }

  /** Standard normal via Box-Muller, clamped to avoid log(0). */
  normal(mean = 0, stdDev = 1): number {
    const u1 = Math.max(this.next(), Number.EPSILON);
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  }

  /** Fisher-Yates, returning a new array. */
  shuffled<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = out[i]!;
      const b = out[j]!;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }

  /** A child stream, deterministically derived. Keeps concerns independent. */
  fork(label: string): Rng {
    return new Rng(`${this.a}:${this.b}:${this.c}:${this.d}:${label}`);
  }
}

/** Clamp helper used wherever a probability is assembled from parts. */
export function clamp01(x: number): number {
  if (Number.isNaN(x)) throw new Error("clamp01 received NaN");
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
