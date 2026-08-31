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
