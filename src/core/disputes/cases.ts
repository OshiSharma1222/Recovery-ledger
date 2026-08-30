/**
 * Loading the hand-authored dispute cases and folding them into the ledger.
 *
 * Nine cases, authored rather than simulated. They exist to exercise every
 * branch of the evidence engine -- a clear contest, a clear abandon, a
 * blocking gap, a complete packet that is still EV-negative, and the Lane 1
 * overlap -- not to support a statistical claim. Lane 2 makes no quantitative
 * claim at all, and the README says so.
 */

import { readFileSync } from "node:fs";

import { newLedgerRow, type LedgerRow } from "../ledger.js";
import {
  assessEvidence,
  reasonCode,
  type EvidenceAssessment,
  type EvidenceKind,
} from "./evidence.js";

export interface DisputeCase {
  readonly id: string;
  readonly reasonCodeId: string;
  readonly amountPaise: number;
  readonly customerId: string;
  readonly merchantNote: string;
  readonly raisedOnDay: number;
  readonly available: readonly EvidenceKind[];
  /**
   * What actually happened, authored alongside the case.
   *
   * NEVER passed to the evidence engine or the drafter. It is here so a
   * reviewer can check whether the recommendation was sensible, in the same
   * spirit as the simulator's latent state in Lane 1.
   */
  readonly truth: string;
}

interface CasesFile {
  readonly cases: readonly DisputeCase[];
}

const DEFAULT_PATH = "data/disputes/cases.json";

export function loadDisputeCases(path: string = DEFAULT_PATH): DisputeCase[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as CasesFile;
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error(`No dispute cases found in ${path}`);
  }
  for (const c of parsed.cases) {
    // Fail loudly on a typo in the data file rather than silently scoring a
    // case against a reason code that does not exist.
    reasonCode(c.reasonCodeId);
    if (!Number.isInteger(c.amountPaise) || c.amountPaise <= 0) {
      throw new Error(`Case ${c.id} has a non-integer or non-positive amount`);
    }
  }
  return [...parsed.cases];
}

export interface AssessedCase {
  readonly dispute: DisputeCase;
  readonly assessment: EvidenceAssessment;
  readonly row: LedgerRow;
}

/**
 * Assess every case and produce the ledger row for each.
 *
 * This is the structural payoff of the whole project: a dispute becomes a
 * `LedgerRow` with `source: "DISPUTE"` and flows through the same table, the
 * same statuses and the same dashboard as a failed recurring debit. Nothing in
 * `ledger.ts` needed to change to accommodate it.
 */
export function assessAllCases(path: string = DEFAULT_PATH): AssessedCase[] {
  return loadDisputeCases(path).map((dispute) => {
    const assessment = assessEvidence(
      dispute.reasonCodeId,
      dispute.amountPaise,
      dispute.available,
    );
    const rc = reasonCode(dispute.reasonCodeId);

    const row = newLedgerRow({
      id: dispute.id,
      source: "DISPUTE",
      amountPaise: dispute.amountPaise,
      customerId: dispute.customerId,
      rawCode: `${rc.network} ${rc.code}`,
      failedOnDay: dispute.raisedOnDay,
      // Disputes have no instrument-level failure, so these carry the case's
      // own context rather than a debit's. The schema absorbs it unchanged.
      instrumentType: "CARD",
      segment: "SALARY_MID_MONTH",
      issuerBank: rc.network,
      cycleNumber: 1,
    });

    row.rationale = assessment.rationale;
    row.actionDayOffset = 1;

    if (assessment.action.kind === "DO_NOT_CONTEST") {
      row.status = "ABANDONED";
      row.action = { kind: "ABANDON", winBack: false };
      row.resolvedOnDay = dispute.raisedOnDay;
    } else {
      row.status = "IN_PROGRESS";
      row.action = {
        kind: "ESCALATE",
        note: `Representment for ${rc.network} ${rc.code}`,
      };
    }

    return { dispute, assessment, row };
  });
}
