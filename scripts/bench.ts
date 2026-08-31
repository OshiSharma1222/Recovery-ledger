import { writeFileSync, mkdirSync } from "node:fs";

import { ALL_POLICIES } from "../src/core/policy/baselines.js";
import { SIM } from "../src/core/simulator/params.js";
import {
  assertBenchmarkIntegrity,
  runBenchmark,
  type BenchReport,
} from "../src/core/bench/run.js";
import type { Metrics } from "../src/core/bench/metrics.js";

const rupees = (paise: number): string => {
  const r = Math.round(paise / 100);
  if (r >= 10_000_000) return `₹${(r / 10_000_000).toFixed(2)}Cr`;
  if (r >= 100_000) return `₹${(r / 100_000).toFixed(2)}L`;
  return `₹${r.toLocaleString("en-IN")}`;
};

const pct = (x: number | null, digits = 1): string =>
  x === null ? "--" : `${(x * 100).toFixed(digits)}%`;

const num = (x: number, digits = 2): string =>
  Number.isFinite(x) ? x.toFixed(digits) : "--";

interface Column {
  readonly header: string;
  readonly value: (m: Metrics) => string;
  readonly align: "left" | "right";
}

const COLUMNS: readonly Column[] = [
  { header: "", value: (m) => m.policyId, align: "left" },
  { header: "policy", value: (m) => m.policyName, align: "left" },
  { header: "recovered", value: (m) => rupees(m.recoveredPaise), align: "right" },
  { header: "rate", value: (m) => pct(m.recoveryRate), align: "right" },
  { header: "of ceiling", value: (m) => pct(m.ceilingCapture), align: "right" },
  { header: "retries", value: (m) => m.retries.toLocaleString("en-IN"), align: "right" },
  { header: "wasted", value: (m) => m.wastedRetries.toLocaleString("en-IN"), align: "right" },
  { header: "per win", value: (m) => num(m.retriesPerRecovery), align: "right" },
  { header: "nudges", value: (m) => m.nudges.toLocaleString("en-IN"), align: "right" },
  { header: "days", value: (m) => num(m.meanDaysToRecovery, 1), align: "right" },
];

function renderTable(metrics: readonly Metrics[], pad = "  "): string {
  const rows = metrics.map((m) => COLUMNS.map((c) => c.value(m)));
  const widths = COLUMNS.map((c, i) =>
    Math.max(c.header.length, ...rows.map((r) => r[i]!.length)),
  );

  const line = (cells: readonly string[]) =>
    pad +
    cells
      .map((cell, i) =>
        COLUMNS[i]!.align === "left"
          ? cell.padEnd(widths[i]!)
          : cell.padStart(widths[i]!),
      )
      .join("  ");

  const out = [
    line(COLUMNS.map((c) => c.header)),
    pad + widths.map((w) => "-".repeat(w)).join("  "),
    ...rows.map(line),
  ];
  return out.join("\n");
}

function renderMarkdownTable(metrics: readonly Metrics[]): string {
  const head = `| ${COLUMNS.map((c) => c.header || "id").join(" | ")} |`;
  const sep = `| ${COLUMNS.map((c) => (c.align === "right" ? "---:" : ":---")).join(" | ")} |`;
  const body = metrics.map((m) => {
    const cells = COLUMNS.map((c) => {
      const v = c.value(m);
      return m.policyId === "B3" ? `**${v}**` : v;
    });
    return `| ${cells.join(" | ")} |`;
  });
  return [head, sep, ...body].join("\n");
}

function headline(report: BenchReport): string[] {
  const get = (id: string) => report.metrics.find((m) => m.policyId === id);
  const b1 = get("B1");
  const b3 = get("B3");
  const b4 = get("B4");
  if (!b1 || !b3 || !b4) return [];

  const lift = b1.recoveredPaise === 0 ? 0 : b3.recoveredPaise / b1.recoveredPaise - 1;
  const retrySaving = b1.retries === 0 ? 0 : 1 - b3.retries / b1.retries;
  const wasteSaving =
    b1.wastedRetries === 0 ? 0 : 1 - b3.wastedRetries / b1.wastedRetries;

  return [
    `Against the fixed day-1/3/5 schedule almost every dunning stack ships with,`,
    `the Recovery Ledger recovers ${lift >= 0 ? "+" : ""}${pct(lift)} more money ` +
      `(${rupees(b3.recoveredPaise)} vs ${rupees(b1.recoveredPaise)})`,
    `while spending ${pct(retrySaving)} fewer retries and ${pct(wasteSaving)} fewer`,
    `attempts on rows that could never have been recovered.`,
    ``,
    `It captures ${pct(b3.ceilingCapture)} of what a policy with perfect knowledge`,
    `of every latent variable managed. ${pct(b4.ceilingCapture)} is the ceiling, not 100%:`,
    `${rupees(b3.unrecoverablePaise)} of this ledger is structurally unrecoverable.`,
  ];
}

function main(): void {
  const arg = (name: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

  const customers = arg("customers") ? Number(arg("customers")) : undefined;
  const seed = arg("seed");

  const report = runBenchmark({
    customers,
    ...(seed ? { trainSeed: `${seed}:train`, testSeed: `${seed}:test` } : {}),
  });
  assertBenchmarkIntegrity(report);

  const atRisk = report.metrics[0]?.atRiskPaise ?? 0;
  const unrecoverable = report.metrics[0]?.unrecoverablePaise ?? 0;

  console.log("");
  console.log("  RECOVERY LEDGER -- policy benchmark");
  console.log("  " + "=".repeat(96));
  console.log(`  population        ${report.customers.toLocaleString("en-IN")} customers`);
  console.log(
    `  ledger            ${report.metrics[0]?.rowsTotal.toLocaleString("en-IN")} failed debits, ${rupees(atRisk)} at risk`,
  );
  console.log(
    `  unrecoverable     ${rupees(unrecoverable)} (${pct(unrecoverable / atRisk)}) -- terminal causes, zero at every offset`,
  );
  console.log(`  train seed        ${report.trainSeed}  (${report.trainingObservations.toLocaleString("en-IN")} observations)`);
  console.log(`  eval seed         ${report.testSeed}  (disjoint)`);
  console.log(`  classifier        ${pct(report.classifierAccuracy)} vs ground truth`);
  console.log(`  attempt cap       ${SIM.MAX_ATTEMPTS} per row, applied to every policy`);
  console.log(`  elapsed           ${report.elapsedMs}ms`);
  console.log("");
  console.log(renderTable(report.metrics));
  console.log("");
  console.log("  " + "-".repeat(96));
  for (const line of headline(report)) console.log("  " + line);
  console.log("");

  writeReport(report);
  console.log("  Written to results/benchmark.md");
  console.log("");
}

function writeReport(report: BenchReport): void {
  const atRisk = report.metrics[0]?.atRiskPaise ?? 0;
  const unrecoverable = report.metrics[0]?.unrecoverablePaise ?? 0;

  const md = `# Benchmark results

_Generated by \`npm run bench\`. Seeded end to end, so these numbers are
byte-identical on any machine. No API key, no database, no network._

## Setup

| | |
|---|---|
| population | ${report.customers.toLocaleString("en-IN")} customers |
| ledger | ${report.metrics[0]?.rowsTotal.toLocaleString("en-IN")} failed debits, ${rupees(atRisk)} at risk |
| structurally unrecoverable | ${rupees(unrecoverable)} (${pct(unrecoverable / atRisk)}) |
| training seed | \`${report.trainSeed}\` (${report.trainingObservations.toLocaleString("en-IN")} observations) |
| evaluation seed | \`${report.testSeed}\` — disjoint from training |
| classifier accuracy | ${pct(report.classifierAccuracy)} against ground truth |
| attempt cap | ${SIM.MAX_ATTEMPTS} per row, applied identically to every policy |

## Results

${renderMarkdownTable(report.metrics)}

**Columns.** \`recovered\` is money returned. \`rate\` is that as a share of all
rupees at risk. \`of ceiling\` is the share of what the oracle managed.
\`retries\` counts debit attempts beyond the original failed presentment;
\`wasted\` is the subset of those spent on rows whose true cause was terminal.
\`per win\` is retries per successful recovery. \`nudges\` counts customer-facing
messages — the annoyance proxy. \`days\` is mean time from failure to money
landing.

## Reading this

${headline(report)
  .filter(Boolean)
  .join("\n")}

## Why the oracle is here

Reporting a bare recovery rate invites the question "out of what?". Roughly
${pct(unrecoverable / atRisk, 0)} of this ledger is structurally unrecoverable — expired mandates,
debits above the authorised cap, customer revocations, risk blocks. For those
rows the probability of success is identically zero at every offset, for every
policy, forever. No amount of retrying moves them.

B4 sees every latent variable — salary day, true balance curve, mandate state,
responsiveness, the downtime schedule — and takes the best action available.
It is a **greedy** oracle, not a proven optimum: it does not solve the
multi-step scheduling problem exactly, so it is a very strong upper bound
rather than a mathematical one. Quoting it as "optimal" would be an overclaim.

## Methodology notes

**Common random numbers.** The world's randomness is seeded per (row, attempt),
not per policy. If two policies re-present the same debit on the same day they
receive the same coin flip, so differences between them reflect policy quality
rather than sampling luck.

**Train/test split.** The timing estimator is fitted on a population generated
from a different seed than the one scored here, and \`assertDisjointSeeds()\`
refuses to run if they ever match.

**Frozen parameters.** Every probability in the simulator was committed before
the policy engine was written. Verify with:

\`\`\`
git log --follow --oneline -- src/core/simulator/params.ts
\`\`\`

That file should have exactly one commit, and it should be an ancestor of the
first commit touching \`src/core/policy/\`.

**The limitation.** The response model is authored by me, so this measures
policy quality against a stated model of the world, not against production
reality. See the README.
`;

  mkdirSync("results", { recursive: true });
  writeFileSync("results/benchmark.md", md, "utf8");
}

main();
