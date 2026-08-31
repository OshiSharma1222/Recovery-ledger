import { LedgerStore } from "../src/core/ledger-store.js";
import { assertParamsWellFormed, SIM } from "../src/core/simulator/params.js";
import { buildWorld } from "../src/core/simulator/population.js";
import { formatPaise, type RootCauseKind } from "../src/core/taxonomy.js";

const DB_PATH = "data/ledger.db";

function main(): void {
  assertParamsWellFormed();

  const seed = process.argv.find((a) => a.startsWith("--seed="))?.slice(7);
  const world = buildWorld(seed ?? SIM.DEFAULT_SEED, SIM.CUSTOMERS);

  const store = new LedgerStore(DB_PATH);
  store.reset();
  store.insertMany(world.rows);

  const atRisk = world.rows.reduce((sum, r) => sum + r.amountPaise, 0);
  const failureRate = world.rows.length / world.customers.length;

  console.log("");
  console.log("  Recovery Ledger -- seed");
  console.log("  " + "-".repeat(58));
  console.log(`  seed              ${seed ?? SIM.DEFAULT_SEED}`);
  console.log(`  customers         ${world.customers.length.toLocaleString("en-IN")}`);
  console.log(
    `  failed debits     ${world.rows.length.toLocaleString("en-IN")}  (${(failureRate * 100).toFixed(1)}% of cycles)`,
  );
  console.log(`  rupees at risk    ${formatPaise(atRisk)}`);
  console.log(`  written to        ${DB_PATH}`);
  console.log("");

  const byCause = new Map<RootCauseKind, { n: number; paise: number }>();
  for (const [, failure] of world.latent) {
    const key = failure.trueCause.kind;
    const acc = byCause.get(key) ?? { n: 0, paise: 0 };
    acc.n += 1;
    acc.paise += failure.customer.presentedPaise;
    byCause.set(key, acc);
  }

  const sorted = [...byCause.entries()].sort((a, b) => b[1].n - a[1].n);
  const width = Math.max(...sorted.map(([k]) => k.length));

  console.log("  Ground-truth root cause mix (latent -- not visible to any policy)");
  console.log("  " + "-".repeat(58));
  for (const [cause, { n, paise }] of sorted) {
    const share = ((n / world.rows.length) * 100).toFixed(1).padStart(5);
    const terminal = TERMINAL.has(cause) ? "  terminal" : "";
    console.log(
      `  ${cause.padEnd(width)}  ${String(n).padStart(5)}  ${share}%  ${formatPaise(paise).padStart(16)}${terminal}`,
    );
  }

  const terminalCount = sorted
    .filter(([c]) => TERMINAL.has(c))
    .reduce((s, [, v]) => s + v.n, 0);
  const terminalPaise = sorted
    .filter(([c]) => TERMINAL.has(c))
    .reduce((s, [, v]) => s + v.paise, 0);

  console.log("  " + "-".repeat(58));
  console.log(
    `  Structurally unrecoverable: ${terminalCount} rows (${((terminalCount / world.rows.length) * 100).toFixed(1)}%), ${formatPaise(terminalPaise)}.`,
  );
  console.log(
    `  A day-1/3/5 retry schedule will spend ~${terminalCount * 3} attempts on these`,
  );
  console.log(`  and recover nothing. That gap is what the benchmark measures.`);
  console.log("");

  store.close();
}

const TERMINAL = new Set<RootCauseKind>([
  "MANDATE_EXPIRED",
  "MANDATE_AMOUNT_EXCEEDED",
  "MANDATE_REVOKED",
  "CARD_EXPIRED",
  "RISK_BLOCKED",
]);

main();
