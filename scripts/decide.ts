import { classify } from "../src/core/classify.js";
import { decide } from "../src/core/policy/engine.js";
import {
  assertDisjointSeeds,
  trainTimingEstimator,
  TEST_SEED,
  TRAIN_SEED,
} from "../src/core/policy/train.js";
import { assertParamsWellFormed } from "../src/core/simulator/params.js";
import {
  buildWorld,
  merchantMandateRecord,
} from "../src/core/simulator/population.js";
import { formatPaise, type RootCauseKind } from "../src/core/taxonomy.js";

function main(): void {
  assertParamsWellFormed();
  assertDisjointSeeds(TRAIN_SEED, TEST_SEED);

  console.log("");
  console.log("  Training the timing estimator");
  console.log("  " + "-".repeat(70));
  const t0 = Date.now();
  const { estimator, rowsProbed, observations } = trainTimingEstimator({
    seed: TRAIN_SEED,
  });
  console.log(`  train seed        ${TRAIN_SEED}`);
  console.log(`  rows probed       ${rowsProbed.toLocaleString("en-IN")}`);
  console.log(`  observations      ${observations.toLocaleString("en-IN")}`);
  console.log(`  elapsed           ${Date.now() - t0}ms`);
  console.log("");
  console.log(`  eval seed         ${TEST_SEED}  (disjoint -- no leakage)`);
  console.log("");

  console.log("  What the estimator learned: P(retry clears | INSUFFICIENT_FUNDS)");
  console.log("  " + "-".repeat(70));
  const days = [1, 3, 5, 8, 11, 14, 17, 20, 23, 26, 29];
  const header = days.map((d) => String(d).padStart(5)).join("");
  console.log(`  ${"day of month".padEnd(22)}${header}`);
  for (const segment of [
    "SALARY_EARLY_MONTH",
    "SALARY_MID_MONTH",
    "IRREGULAR_INCOME",
  ] as const) {
    const cells = estimator
      .curve("INSUFFICIENT_FUNDS", segment, days)
      .map((c) => `${(c.probability * 100).toFixed(0)}%`.padStart(5))
      .join("");
    console.log(`  ${segment.padEnd(22)}${cells}`);
  }
  console.log("");
  console.log("  Read across a row: for early-month earners the odds are best right");
  console.log("  after payday and worst at month end. A fixed day-1/3/5 schedule");
  console.log("  cannot express that, because it never asks what day it lands on.");
  console.log("");

  const world = buildWorld(TEST_SEED);
  const byAction = new Map<string, number>();
  const byCause = new Map<RootCauseKind, number>();
  const samples: string[] = [];
  const seenCauses = new Set<RootCauseKind>();

  let correct = 0;
  let classified = 0;

  for (const row of world.rows) {
    const failure = world.latent.get(row.id);
    if (!failure) continue;

    const classification = classify({
      row,
      mandate: merchantMandateRecord(failure.customer),
      issuerDegraded: false,
    });
    const decision = decide({
      row,
      classification,
      estimator,
      attemptsSpent: 0,
      nudgesSent: 0,
    });

    classified += 1;
    if (classification.cause.kind === failure.trueCause.kind) correct += 1;

    byAction.set(decision.action.kind, (byAction.get(decision.action.kind) ?? 0) + 1);
    byCause.set(
      classification.cause.kind,
      (byCause.get(classification.cause.kind) ?? 0) + 1,
    );

    if (!seenCauses.has(classification.cause.kind)) {
      seenCauses.add(classification.cause.kind);
      samples.push(
        [
          `  ${row.id}   ${formatPaise(row.amountPaise)}   ${row.instrumentType}   ${row.issuerBank}`,
          `    raw code    ${row.rawCode}`,
          `    root cause  ${classification.cause.kind}  (confidence ${(classification.confidence * 100).toFixed(0)}%)`,
          `    evidence    ${classification.evidence.join("; ")}`,
          `    action      ${decision.action.kind}  at +${decision.dayOffset}d`,
          `    rationale   ${wrap(decision.rationale, 66, "                ")}`,
        ].join("\n"),
      );
    }
  }

  console.log("  Classifier accuracy against the simulator's ground truth");
  console.log("  " + "-".repeat(70));
  console.log(
    `  ${correct} / ${classified} = ${((correct / classified) * 100).toFixed(1)}%`,
  );
  console.log("  Not 100%, and it should not be: payment_failed and payment_declined");
  console.log("  are each emitted by several unrelated causes. The residual error is");
  console.log("  the genuine ambiguity in the raw code space, not a bug.");
  console.log("");

  console.log("  Actions chosen");
  console.log("  " + "-".repeat(70));
  const sortedActions = [...byAction.entries()].sort((a, b) => b[1] - a[1]);
  const w = Math.max(...sortedActions.map(([k]) => k.length));
  for (const [action, n] of sortedActions) {
    const share = ((n / classified) * 100).toFixed(1).padStart(5);
    console.log(`  ${action.padEnd(w)}  ${String(n).padStart(5)}  ${share}%`);
  }
  const abandoned = byAction.get("ABANDON") ?? 0;
  console.log("  " + "-".repeat(70));
  console.log(
    `  ${abandoned} rows (${((abandoned / classified) * 100).toFixed(1)}%) were abandoned without spending a further attempt.`,
  );
  console.log("  A fixed day-1/3/5 schedule would have spent " + abandoned * 3 + " attempts on them.");
  console.log("");

  console.log("  One worked example per cause");
  console.log("  " + "=".repeat(70));
  for (const s of samples) {
    console.log(s);
    console.log("");
  }
}

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else {
      line += " " + word;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n" + indent);
}

main();
