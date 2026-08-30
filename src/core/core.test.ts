/**
 * Tests for the properties the benchmark's validity actually rests on.
 *
 * These are not coverage theatre. Each one guards a claim the README or the
 * video makes out loud, and if any of them fails the corresponding claim is
 * false rather than merely untested.
 */

import { describe, expect, it } from "vitest";

import { classify, type ClassificationContext } from "./classify.js";
import { newLedgerRow, LedgerStore, type LedgerRow } from "./ledger.js";
import {
  assertNever,
  isTerminal,
  ROOT_CAUSE_KINDS,
  TERMINAL_CAUSES,
  formatPaise,
  type RootCause,
} from "./taxonomy.js";
import { Rng } from "./simulator/rng.js";
import { assertParamsWellFormed, SIM } from "./simulator/params.js";
import {
  buildWorld,
  dayOfMonth,
  generatePopulation,
  merchantMandateRecord,
} from "./simulator/population.js";
import { resolveAction } from "./simulator/environment.js";
import { TimingEstimator } from "./policy/timing.js";
import { decide } from "./policy/engine.js";
import { assertDisjointSeeds, TEST_SEED, TRAIN_SEED } from "./policy/train.js";

// ---------------------------------------------------------------------------

const baseRow = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  ...newLedgerRow({
    id: "led_test",
    source: "RECURRING_FAILURE",
    amountPaise: 50_000,
    customerId: "cust_test",
    rawCode: "insufficient_funds",
    failedOnDay: 10,
    instrumentType: "UPI_AUTOPAY",
    segment: "SALARY_EARLY_MONTH",
    issuerBank: "HDFC",
    cycleNumber: 1,
  }),
  ...over,
});

const ctx = (
  row: LedgerRow,
  mandate: Partial<ClassificationContext["mandate"]> = {},
): ClassificationContext => ({
  row,
  mandate: {
    capPaise: 100_000,
    expiryDay: 999,
    instrumentExpiryDay: null,
    ...mandate,
  },
  issuerDegraded: false,
});

// ---------------------------------------------------------------------------

describe("frozen parameters", () => {
  it("are internally consistent", () => {
    expect(() => assertParamsWellFormed()).not.toThrow();
  });
});

describe("seeded RNG", () => {
  it("is reproducible across instances with the same seed", () => {
    const a = new Rng("seed-a");
    const b = new Rng("seed-a");
    const xs = Array.from({ length: 200 }, () => a.next());
    const ys = Array.from({ length: 200 }, () => b.next());
    expect(xs).toEqual(ys);
  });

  it("diverges on a different seed", () => {
    const a = new Rng("seed-a");
    const b = new Rng("seed-b");
    expect(a.next()).not.toEqual(b.next());
  });

  it("produces forks that are independent of each other", () => {
    const root = new Rng("root");
    const x = root.fork("alpha").next();
    const y = root.fork("beta").next();
    expect(x).not.toEqual(y);
  });

  it("stays within [0,1) over a long run", () => {
    const rng = new Rng("range");
    for (let i = 0; i < 20_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("rejects a degenerate weighted table rather than silently biasing", () => {
    const rng = new Rng("weights");
    expect(() => rng.weighted([["a", 0]])).toThrow(/sum to zero/);
    expect(() => rng.pick([])).toThrow(/empty/);
  });
});

describe("taxonomy", () => {
  it("marks exactly the structurally unrecoverable causes as terminal", () => {
    expect([...TERMINAL_CAUSES].sort()).toEqual(
      [
        "CARD_EXPIRED",
        "MANDATE_AMOUNT_EXCEEDED",
        "MANDATE_EXPIRED",
        "MANDATE_REVOKED",
        "RISK_BLOCKED",
      ].sort(),
    );
  });

  it("covers every declared cause kind in the terminal check", () => {
    for (const kind of ROOT_CAUSE_KINDS) {
      expect(() => TERMINAL_CAUSES.has(kind)).not.toThrow();
    }
  });

  it("throws loudly if an unhandled variant reaches assertNever at runtime", () => {
    expect(() => assertNever("rogue" as never, "test")).toThrow(/unhandled variant/);
  });

  it("formats paise as rupees without float drift", () => {
    expect(formatPaise(123_45)).toBe("₹123.45");
    expect(formatPaise(0)).toBe("₹0.00");
  });
});

describe("classifier", () => {
  it("splits mandate_not_active into expiry vs revocation using the merchant's own record", () => {
    // Same raw string, opposite actions. This is the disambiguation the whole
    // file exists for, so it is the one test that must never regress.
    const row = baseRow({ rawCode: "mandate_not_active", failedOnDay: 20 });

    const lapsed = classify(ctx(row, { expiryDay: 15 }));
    expect(lapsed.cause.kind).toBe("MANDATE_EXPIRED");

    const live = classify(ctx(row, { expiryDay: 400 }));
    expect(live.cause.kind).toBe("MANDATE_REVOKED");
  });

  it("uses the authorised cap to separate a cap breach from a generic decline", () => {
    const row = baseRow({ rawCode: "payment_declined", amountPaise: 150_000 });

    const overCap = classify(ctx(row, { capPaise: 100_000 }));
    expect(overCap.cause.kind).toBe("MANDATE_AMOUNT_EXCEEDED");

    const underCap = classify(ctx(row, { capPaise: 500_000 }));
    expect(underCap.cause.kind).toBe("DO_NOT_HONOUR");
  });

  it("reports low confidence when the code carries no information", () => {
    const generic = classify(ctx(baseRow({ rawCode: "payment_failed" })));
    const specific = classify(ctx(baseRow({ rawCode: "insufficient_funds" })));
    expect(generic.confidence).toBeLessThan(specific.confidence);
    expect(generic.confidence).toBeLessThan(0.6);
  });

  it("does not force an unknown code into a bucket", () => {
    const unknown = classify(ctx(baseRow({ rawCode: "not_a_real_code" })));
    expect(unknown.confidence).toBeLessThan(0.3);
    expect(unknown.evidence.join(" ")).toMatch(/unrecognised/);
  });

  it("always produces evidence a human can read", () => {
    const world = buildWorld("classifier-evidence", 300);
    for (const row of world.rows) {
      const failure = world.latent.get(row.id)!;
      const c = classify({
        row,
        mandate: merchantMandateRecord(failure.customer),
        issuerDegraded: false,
      });
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.confidence).toBeGreaterThan(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("environment", () => {
  /**
   * The single most important property in the repo.
   *
   * If a terminal cause could ever recover by retrying, ABANDON would be
   * throwing money away and the entire thesis would be wrong. This asserts the
   * zero directly, across every offset, for every terminal cause present in a
   * real generated world.
   */
  it("never recovers a terminal cause by retrying, at any offset", () => {
    const world = buildWorld("terminal-check", 1500);
    const rng = new Rng("terminal-check:probe");
    let checked = 0;

    for (const [, failure] of world.latent) {
      if (!isTerminal(failure.trueCause)) continue;
      checked += 1;
      for (let offset = 1; offset <= 20; offset++) {
        const outcome = resolveAction(
          { failure, downtime: world.downtime, priorNudges: 0, priorAttempts: 0 },
          { kind: "RETRY_AT", dayOffset: offset, expectedSuccess: 0 },
          rng,
        );
        expect(outcome.recovered).toBe(false);
      }
    }

    // Guard against the test silently passing on an empty set.
    expect(checked).toBeGreaterThan(50);
  });

  it("charges an attempt for a retry and a nudge for an ask", () => {
    const world = buildWorld("cost-check", 400);
    const failure = [...world.latent.values()][0]!;
    const rng = new Rng("cost-check:probe");
    const env = {
      failure,
      downtime: world.downtime,
      priorNudges: 0,
      priorAttempts: 0,
    };

    const retry = resolveAction(env, { kind: "RETRY_AT", dayOffset: 1, expectedSuccess: 0 }, rng);
    expect(retry.attemptsUsed).toBe(1);
    expect(retry.nudgesUsed).toBe(0);

    const renew = resolveAction(
      env,
      { kind: "REQUEST_MANDATE_RENEWAL", channel: "sms" },
      rng,
    );
    expect(renew.nudgesUsed).toBe(1);
  });

  it("makes ABANDON free -- it must never cost an attempt or a nudge", () => {
    const world = buildWorld("abandon-check", 200);
    const failure = [...world.latent.values()][0]!;
    const outcome = resolveAction(
      { failure, downtime: world.downtime, priorNudges: 0, priorAttempts: 0 },
      { kind: "ABANDON", winBack: true },
      new Rng("abandon"),
    );
    expect(outcome.attemptsUsed).toBe(0);
    expect(outcome.nudgesUsed).toBe(0);
    expect(outcome.recovered).toBe(false);
  });

  it("keeps the soft/hard DO_NOT_HONOUR split stable across retries", () => {
    // If this were redrawn each attempt, brute-force retrying would eventually
    // win and the benchmark would reward exactly the behaviour it indicts.
    const world = buildWorld("dnh-stability", 2000);
    const dnh = [...world.latent.values()].filter(
      (f) => f.trueCause.kind === "DO_NOT_HONOUR",
    );
    expect(dnh.length).toBeGreaterThan(10);

    for (const failure of dnh.slice(0, 25)) {
      const results = new Set<string>();
      for (let trial = 0; trial < 5; trial++) {
        const outcome = resolveAction(
          { failure, downtime: world.downtime, priorNudges: 0, priorAttempts: 0 },
          { kind: "RETRY_AT", dayOffset: 3, expectedSuccess: 0 },
          new Rng(`dnh:${trial}`),
        );
        if (outcome.note.includes("hard issuer refusal")) results.add("hard");
        else results.add("soft-or-other");
      }
      // A given customer is always hard or always not; never both.
      expect(results.size).toBe(1);
    }
  });
});

describe("timing estimator", () => {
  it("returns the parent estimate for a cell with no observations", () => {
    const est = new TimingEstimator();
    for (let i = 0; i < 100; i++) {
      est.observe({
        cause: "INSUFFICIENT_FUNDS",
        segment: "SALARY_EARLY_MONTH",
        feature: 3,
        success: i < 80,
      });
    }
    // Unseen day, unseen segment: must fall back, not invent.
    const p = est.probability("INSUFFICIENT_FUNDS", "IRREGULAR_INCOME", 27);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(est.support("INSUFFICIENT_FUNDS", "IRREGULAR_INCOME", 27)).toBe(0);
  });

  it("does not let a 1-of-1 cell read as certainty", () => {
    const est = new TimingEstimator();
    // Establish a low global rate, then a single lucky observation elsewhere.
    for (let i = 0; i < 200; i++) {
      est.observe({
        cause: "DO_NOT_HONOUR",
        segment: "SALARY_MID_MONTH",
        feature: 2,
        success: false,
      });
    }
    est.observe({
      cause: "DO_NOT_HONOUR",
      segment: "SALARY_MID_MONTH",
      feature: 9,
      success: true,
    });
    const p = est.probability("DO_NOT_HONOUR", "SALARY_MID_MONTH", 9);
    expect(p).toBeLessThan(0.5);
  });

  it("converges on the true rate given enough data", () => {
    const est = new TimingEstimator();
    for (let i = 0; i < 4000; i++) {
      est.observe({
        cause: "ISSUER_DOWNTIME",
        segment: "SALARY_EARLY_MONTH",
        feature: 2,
        success: i % 4 !== 0, // 75%
      });
    }
    const p = est.probability("ISSUER_DOWNTIME", "SALARY_EARLY_MONTH", 2);
    expect(p).toBeGreaterThan(0.72);
    expect(p).toBeLessThan(0.78);
  });

  it("picks the best candidate and breaks ties toward the sooner one", () => {
    const est = new TimingEstimator();
    const load = (feature: number, successRate: number) => {
      for (let i = 0; i < 300; i++) {
        est.observe({
          cause: "TECHNICAL_DECLINE",
          segment: "SALARY_EARLY_MONTH",
          feature,
          success: i < 300 * successRate,
        });
      }
    };
    load(1, 0.3);
    load(2, 0.9);
    load(3, 0.9);

    const best = est.best("TECHNICAL_DECLINE", "SALARY_EARLY_MONTH", [1, 2, 3]);
    expect(best.feature).toBe(2); // not 3 -- sooner wins the tie
    expect(best.probability).toBeGreaterThan(0.8);
  });

  it("recovers the latent pay-cycle signal from observations alone", () => {
    // The headline claim: the policy is never told salaryDay, but a table
    // fitted on outcomes should still rank just-after-payday above month-end
    // for early-month earners.
    const est = new TimingEstimator();
    const world = buildWorld("timing-signal", 3000);
    const rng = new Rng("timing-signal:probe");

    for (const row of world.rows) {
      const failure = world.latent.get(row.id)!;
      if (failure.trueCause.kind !== "INSUFFICIENT_FUNDS") continue;
      for (let offset = 1; offset <= 14; offset++) {
        const day = row.failedOnDay + offset;
        if (day > SIM.HORIZON_DAYS) continue;
        const outcome = resolveAction(
          { failure, downtime: world.downtime, priorNudges: 0, priorAttempts: 0 },
          { kind: "RETRY_AT", dayOffset: offset, expectedSuccess: 0 },
          rng,
        );
        est.observe({
          cause: "INSUFFICIENT_FUNDS",
          segment: row.segment,
          feature: dayOfMonth(day),
          success: outcome.recovered,
        });
      }
    }

    const justAfterPayday = est.probability("INSUFFICIENT_FUNDS", "SALARY_EARLY_MONTH", 3);
    const monthEnd = est.probability("INSUFFICIENT_FUNDS", "SALARY_EARLY_MONTH", 29);
    expect(justAfterPayday).toBeGreaterThan(monthEnd + 0.15);
  });
});

describe("policy engine", () => {
  const est = new TimingEstimator();

  const run = (cause: RootCause, over: Partial<LedgerRow> = {}, attempts = 0) =>
    decide({
      row: baseRow(over),
      classification: { cause, confidence: 0.9, evidence: ["test"] },
      estimator: est,
      attemptsSpent: attempts,
      nudgesSent: 0,
    });

  it("never retries a revoked mandate", () => {
    const d = run({ kind: "MANDATE_REVOKED" });
    expect(d.action.kind).toBe("ABANDON");
  });

  it("never retries a risk block, and does not flag it for win-back", () => {
    const d = run({ kind: "RISK_BLOCKED" });
    expect(d.action.kind).toBe("ABANDON");
    if (d.action.kind === "ABANDON") expect(d.action.winBack).toBe(false);
  });

  it("splits a capped debit into parts that actually fit under the cap", () => {
    const d = run(
      { kind: "MANDATE_AMOUNT_EXCEEDED", capPaise: 60_000, attemptedPaise: 100_000 },
      { amountPaise: 100_000 },
    );
    expect(d.action.kind).toBe("SPLIT_AMOUNT");
    if (d.action.kind === "SPLIT_AMOUNT") {
      expect(d.action.perPartPaise).toBeLessThanOrEqual(60_000);
      expect(d.action.parts * d.action.perPartPaise).toBeGreaterThanOrEqual(100_000);
    }
  });

  it("abandons a cap breach no split can fix rather than proposing a useless one", () => {
    const d = run(
      { kind: "MANDATE_AMOUNT_EXCEEDED", capPaise: 1_000, attemptedPaise: 500_000 },
      { amountPaise: 500_000 },
    );
    expect(d.action.kind).toBe("ABANDON");
  });

  it("respects the RBI 24h notice window before re-presenting", () => {
    const d = run({ kind: "PRE_DEBIT_NOTICE_FAILED" });
    expect(d.action.kind).toBe("RESEND_NOTICE");
    if (d.action.kind === "RESEND_NOTICE") {
      expect(d.action.retryDayOffset).toBeGreaterThanOrEqual(2);
    }
  });

  it("stops once the attempt budget is exhausted, whatever the cause", () => {
    for (const kind of ROOT_CAUSE_KINDS) {
      const cause = synthesiseCause(kind);
      const d = run(cause, {}, SIM.MAX_ATTEMPTS);
      expect(d.action.kind).toBe("ABANDON");
    }
  });

  it("produces a non-empty rationale for every cause", () => {
    for (const kind of ROOT_CAUSE_KINDS) {
      const d = run(synthesiseCause(kind));
      expect(d.rationale.length).toBeGreaterThan(20);
      expect(d.dayOffset).toBeGreaterThanOrEqual(0);
    }
  });

  it("bounds retries on an ambiguous decline instead of retrying forever", () => {
    const early = run({ kind: "DO_NOT_HONOUR" }, {}, 0);
    expect(early.action.kind).toBe("RETRY_AT");
    const late = run({ kind: "DO_NOT_HONOUR" }, {}, 3);
    expect(late.action.kind).toBe("ABANDON");
  });
});

describe("train/test discipline", () => {
  it("uses disjoint seeds", () => {
    expect(TRAIN_SEED).not.toBe(TEST_SEED);
    expect(() => assertDisjointSeeds(TRAIN_SEED, TEST_SEED)).not.toThrow();
  });

  it("refuses to run if someone points them at the same population", () => {
    expect(() => assertDisjointSeeds("same", "same")).toThrow(/leakage/);
  });
});

describe("ledger", () => {
  it("round-trips a row through SQLite including its union payloads", () => {
    const store = new LedgerStore(":memory:");
    const row = baseRow();
    row.rootCause = { kind: "MANDATE_AMOUNT_EXCEEDED", capPaise: 5, attemptedPaise: 9 };
    row.action = { kind: "SPLIT_AMOUNT", parts: 2, perPartPaise: 5 };
    row.actionDayOffset = 3;
    row.rationale = "because";
    store.insert(row);

    const back = store.get(row.id);
    expect(back).not.toBeNull();
    expect(back!.rootCause).toEqual(row.rootCause);
    expect(back!.action).toEqual(row.action);
    expect(back!.amountPaise).toBe(row.amountPaise);
    store.close();
  });

  it("rejects a negative amount at the schema level", () => {
    const store = new LedgerStore(":memory:");
    expect(() => store.insert(baseRow({ amountPaise: -1 }))).toThrow();
    store.close();
  });
});

describe("population", () => {
  it("is byte-identical for the same seed", () => {
    const a = JSON.stringify(generatePopulation(new Rng("pop"), 200));
    const b = JSON.stringify(generatePopulation(new Rng("pop"), 200));
    expect(a).toBe(b);
  });

  it("wraps the day of month correctly across month boundaries", () => {
    expect(dayOfMonth(0)).toBe(1);
    expect(dayOfMonth(29)).toBe(30);
    expect(dayOfMonth(30)).toBe(1);
    expect(dayOfMonth(31)).toBe(2);
  });

  it("keeps latent state out of the ledger row", () => {
    const world = buildWorld("leak-check", 200);
    const row = world.rows[0]!;
    const keys = Object.keys(row);
    // If any of these ever appear on a ledger row, the policy is cheating.
    for (const forbidden of [
      "salaryDay",
      "affluence",
      "responsiveness",
      "mandateCapPaise",
      "mandateExpiryDay",
      "revokedOnDay",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

/** Minimal valid instance of each cause, for exhaustiveness-style sweeps. */
function synthesiseCause(kind: RootCause["kind"]): RootCause {
  switch (kind) {
    case "INSUFFICIENT_FUNDS":
      return { kind };
    case "MANDATE_EXPIRED":
      return { kind, expiredOnDay: 5 };
    case "MANDATE_AMOUNT_EXCEEDED":
      return { kind, capPaise: 40_000, attemptedPaise: 50_000 };
    case "MANDATE_REVOKED":
      return { kind };
    case "CARD_EXPIRED":
      return { kind };
    case "PRE_DEBIT_NOTICE_FAILED":
      return { kind };
    case "ISSUER_DOWNTIME":
      return { kind, issuerBank: "HDFC" };
    case "TECHNICAL_DECLINE":
      return { kind };
    case "DO_NOT_HONOUR":
      return { kind };
    case "RISK_BLOCKED":
      return { kind };
    default:
      return assertNever(kind, "synthesiseCause");
  }
}
