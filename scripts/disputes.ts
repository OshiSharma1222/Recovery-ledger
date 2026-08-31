import { assessAllCases } from "../src/core/disputes/cases.js";
import { draftRepresentment } from "../src/core/disputes/draft.js";
import { reasonCode, DISPUTE_ECONOMICS } from "../src/core/disputes/evidence.js";
import { formatPaise } from "../src/core/taxonomy.js";

function wrap(text: string, width: number, indent: string): string {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > width) {
      out.push(line.trim());
      line = word;
    } else line += " " + word;
  }
  if (line.trim()) out.push(line.trim());
  return out.join("\n" + indent);
}

async function main(): Promise<void> {
  const live = process.argv.includes("--live");
  const cases = assessAllCases();

  console.log("");
  console.log("  RECOVERY LEDGER -- Lane 2: disputes");
  console.log("  " + "=".repeat(78));
  console.log(
    `  ${cases.length} hand-authored cases. Same ledger, same statuses, different action set.`,
  );
  console.log(
    `  Cost to file one representment: ${formatPaise(DISPUTE_ECONOMICS.REPRESENTMENT_COST_PAISE)}`,
  );
  console.log("");

  let contested = 0;
  let dropped = 0;
  let atRisk = 0;
  let chased = 0;
  let savedFiling = 0;

  for (const { dispute, assessment } of cases) {
    const rc = reasonCode(dispute.reasonCodeId);
    const contest = assessment.action.kind === "CONTEST";
    if (contest) {
      contested += 1;
      chased += dispute.amountPaise;
    } else {
      dropped += 1;
      savedFiling += DISPUTE_ECONOMICS.REPRESENTMENT_COST_PAISE;
    }
    atRisk += dispute.amountPaise;

    console.log(
      `  ${dispute.id}   ${rc.network} ${rc.code}  ${rc.title}`,
    );
    console.log(
      `    amount      ${formatPaise(dispute.amountPaise).padEnd(16)} coverage ${(assessment.coverage * 100).toFixed(0)}%   win ${(assessment.winProbability * 100).toFixed(0)}%   EV ${formatPaise(assessment.expectedValuePaise)}`,
    );

    if (assessment.blockingGaps.length > 0) {
      console.log(
        `    BLOCKING    ${assessment.blockingGaps.map((g) => g.label).join("; ")}`,
      );
    }
    const soft = assessment.gaps.filter((g) => !g.mandatory);
    if (soft.length > 0) {
      console.log(`    gaps        ${soft.map((g) => g.label).join("; ")}`);
    }

    console.log(
      `    decision    ${contest ? "CONTEST" : "DO NOT CONTEST"}`,
    );
    console.log(`    rationale   ${wrap(assessment.rationale, 62, "                ")}`);
    console.log("");
  }

  console.log("  " + "-".repeat(78));
  console.log(
    `  ${contested} contested, ${dropped} dropped, out of ${formatPaise(atRisk)} disputed.`,
  );
  console.log(
    `  Chasing only the ${formatPaise(chased)} worth chasing, and not spending`,
  );
  console.log(
    `  ${formatPaise(savedFiling)} to lose the rest. Same thesis as Lane 1: the hard part`,
  );
  console.log("  is knowing what not to chase.");
  console.log("");

  const blockingCounts = new Map<string, number>();
  for (const { assessment } of cases) {
    for (const g of assessment.blockingGaps) {
      blockingCounts.set(g.label, (blockingCounts.get(g.label) ?? 0) + 1);
    }
  }
  if (blockingCounts.size > 0) {
    console.log("  Systemic evidence gaps -- fix these upstream and the losses stop");
    console.log("  " + "-".repeat(78));
    for (const [label, n] of [...blockingCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(2)} case(s) blocked by: ${label}`);
    }
    console.log("");
  }

  const contestable = cases.find((c) => c.assessment.action.kind === "CONTEST");
  if (contestable) {
    const draft = await draftRepresentment(
      contestable.dispute,
      contestable.assessment,
      { live },
    );
    console.log("  Drafted representment");
    console.log("  " + "=".repeat(78));
    console.log(`  case         ${draft.caseId}`);
    console.log(
      `  source       ${draft.source}${draft.model ? ` (${draft.model})` : ""}`,
    );
    console.log(`  prompt hash  ${draft.promptHash}`);
    if (draft.source === "TEMPLATE") {
      console.log("");
      console.log("  NOTE: this is the deterministic template, NOT model output.");
      console.log("  Run with --live and ANTHROPIC_API_KEY set to generate a real");
      console.log("  draft and cache it. The repo never calls the API implicitly.");
    }
    console.log("  " + "-".repeat(78));
    for (const line of draft.letter.split("\n")) console.log(`  ${line}`);
    console.log("");
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
