import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { formatPaise } from "../taxonomy.js";
import { reasonCode, EVIDENCE_LABELS, type EvidenceAssessment } from "./evidence.js";
import type { DisputeCase } from "./cases.js";

const CACHE_DIR = "data/llm-cache";
const MODEL = "claude-sonnet-5";

export type DraftSource = "MODEL" | "TEMPLATE" | "CACHE";

export interface RepresentmentDraft {
  readonly caseId: string;
  readonly source: DraftSource;

  readonly model: string | null;
  readonly promptHash: string;
  readonly letter: string;
}

export function buildPrompt(
  dispute: DisputeCase,
  assessment: EvidenceAssessment,
): string {
  const rc = reasonCode(dispute.reasonCodeId);
  const held = assessment.present.map((k) => `- ${EVIDENCE_LABELS[k]}`).join("\n");
  const missing =
    assessment.gaps.length === 0
      ? "- (none)"
      : assessment.gaps
          .map((g) => `- ${g.label}${g.mandatory ? " [MANDATORY]" : ""}`)
          .join("\n");

  return [
    `You are drafting a chargeback representment letter for an Indian merchant.`,
    ``,
    `Network: ${rc.network}`,
    `Reason code: ${rc.code} (${rc.title})`,
    `Category: ${rc.category}`,
    `Disputed amount: ${formatPaise(dispute.amountPaise)}`,
    `Response window: ${rc.responseWindowDays} days`,
    `Merchant's note on the case: ${dispute.merchantNote}`,
    ``,
    `Evidence the merchant HOLDS and can attach:`,
    held,
    ``,
    `Evidence the merchant DOES NOT hold:`,
    missing,
    ``,
    `Write a representment letter of at most 250 words addressed to the issuing`,
    `bank. Rules:`,
    `1. Reference ONLY evidence from the "holds" list. Never imply the merchant`,
    `   can produce anything from the "does not hold" list.`,
    `2. Open by stating the reason code and why it does not apply here.`,
    `3. Cite each attached artifact and what it establishes.`,
    `4. Close with a specific request to reverse the chargeback.`,
    `5. Professional, factual, no emotional appeals, no legal threats.`,
    `Return only the letter body.`,
  ].join("\n");
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

interface CacheEntry {
  readonly caseId: string;
  readonly model: string;
  readonly promptHash: string;
  readonly letter: string;
  readonly generatedAt: string;
}

function cachePath(hash: string): string {
  return join(CACHE_DIR, `${hash}.json`);
}

function readCache(hash: string): CacheEntry | null {
  const p = cachePath(hash);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(entry.promptHash), JSON.stringify(entry, null, 2), "utf8");
}

export function templateLetter(
  dispute: DisputeCase,
  assessment: EvidenceAssessment,
): string {
  const rc = reasonCode(dispute.reasonCodeId);
  const artifacts = assessment.present.map((k) => EVIDENCE_LABELS[k]);

  const opening: Record<string, string> = {
    VISA_13_2:
      "The cardholder asserts this recurring charge was taken after cancellation. Our records show the mandate was active and unrevoked on the debit date.",
    MC_4841:
      "The cardholder asserts this recurring charge followed a cancellation. Our records show no cancellation was received before the debit date.",
    VISA_13_1:
      "The cardholder asserts the service was not received. Our records establish fulfilment.",
    VISA_10_4:
      "The cardholder asserts this card-absent transaction was unauthorised. Our authentication records indicate otherwise.",
    MC_4837:
      "The cardholder does not recognise this transaction. Our records establish an ongoing authorised relationship.",
    VISA_12_6:
      "The cardholder asserts duplicate processing. The two transactions are distinct and separately authorised.",
    VISA_13_6:
      "The cardholder asserts a credit was not processed. Our records show the credit was issued.",
    VISA_13_3:
      "The cardholder asserts the goods were not as described. Our records establish what was ordered and delivered.",
  };

  return [
    `Re: Chargeback under ${rc.network} reason code ${rc.code} (${rc.title})`,
    `Disputed amount: ${formatPaise(dispute.amountPaise)}`,
    ``,
    `To the issuing bank,`,
    ``,
    opening[dispute.reasonCodeId] ??
      `We are contesting this chargeback raised under ${rc.network} ${rc.code}.`,
    ``,
    `We attach the following documentation in support:`,
    ...artifacts.map((a, i) => `  ${i + 1}. ${a}`),
    ``,
    `Taken together these records establish that the transaction was properly`,
    `authorised and that the merchant met its obligations to the cardholder.`,
    ``,
    `We respectfully request that this chargeback be reversed and the disputed`,
    `amount of ${formatPaise(dispute.amountPaise)} be re-credited to the merchant.`,
    ``,
    `Regards,`,
    `Merchant Disputes Team`,
  ].join("\n");
}

export interface DraftOptions {
  readonly live?: boolean;
}

export async function draftRepresentment(
  dispute: DisputeCase,
  assessment: EvidenceAssessment,
  options: DraftOptions = {},
): Promise<RepresentmentDraft> {
  const prompt = buildPrompt(dispute, assessment);
  const promptHash = hashPrompt(prompt);

  const cached = readCache(promptHash);
  if (cached) {
    return {
      caseId: dispute.id,
      source: "CACHE",
      model: cached.model,
      promptHash,
      letter: cached.letter,
    };
  }

  if (options.live) {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      throw new Error(
        "--live was passed but ANTHROPIC_API_KEY is not set. Refusing to " +
          "silently fall back to a template while implying a model wrote it.",
      );
    }
    const letter = await callClaude(prompt, apiKey);
    writeCache({
      caseId: dispute.id,
      model: MODEL,
      promptHash,
      letter,
      generatedAt: new Date().toISOString(),
    });
    return { caseId: dispute.id, source: "MODEL", model: MODEL, promptHash, letter };
  }

  return {
    caseId: dispute.id,
    source: "TEMPLATE",
    model: null,
    promptHash,
    letter: templateLetter(dispute, assessment),
  };
}

async function callClaude(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Anthropic API returned ${response.status}: ${await response.text()}`,
    );
  }

  const body = (await response.json()) as {
    content: { type: string; text?: string }[];
  };
  const text = body.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  if (!text) throw new Error("Anthropic API returned no text content");
  return text;
}
