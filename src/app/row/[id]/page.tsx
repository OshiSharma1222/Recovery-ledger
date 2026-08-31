import Link from "next/link";
import { notFound } from "next/navigation";

import { getRow, normalizeSeed } from "@/lib/data";
import {
  ActionBadge,
  Card,
  CauseBadge,
  formatRupees,
  StatusBadge,
} from "@/components/ui";
import { EVIDENCE_LABELS, reasonCode } from "@/core/disputes/evidence";

export default async function RowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ seed?: string }>;
}) {
  const { id } = await params;
  const seed = normalizeSeed((await searchParams).seed);
  const view = getRow(id, seed);
  if (!view) notFound();

  const { row, classification, causeDescription, dispute } = view;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/"
          className="text-[13px] font-medium text-sub transition-colors hover:text-ink"
        >
          ← Back to the ledger
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <h1 className="font-mono text-[22px] font-medium tracking-tight text-ink">
            {row.id}
          </h1>
          <span className="text-[22px] font-semibold tabular-nums tracking-tight">
            {formatRupees(row.amountPaise)}
          </span>
          <StatusBadge status={row.status} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="What the gateway said">
            <div className="flex flex-wrap items-center gap-3">
              <code className="bg-linefaint px-2.5 py-1 font-mono text-[13px] text-ink">
                {row.rawCode}
              </code>
              <span className="text-[13px] text-faint">
                {row.source === "DISPUTE"
                  ? "network reason code"
                  : "raw reason code, exactly as received"}
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-sub">
              This string is all a real merchant gets. Everything below is
              inferred from it plus data the merchant already holds.
            </p>
          </Card>

          {classification && (
            <Card title="What it actually means">
              <div className="flex flex-wrap items-center gap-4">
                <CauseBadge cause={classification.cause.kind} />
                <span className="text-[13px] text-faint">
                  classifier confidence{" "}
                  <strong className="font-semibold text-ink">
                    {(classification.confidence * 100).toFixed(0)}%
                  </strong>
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-sub">
                {causeDescription}
              </p>
              <ul className="mt-4 space-y-1.5 border-t border-linefaint pt-3">
                {classification.evidence.map((e) => (
                  <li key={e} className="flex gap-2 text-[13px] text-sub">
                    <span className="text-faint">-</span>
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {dispute && (
            <Card title="Evidence gap analysis">
              <p className="mb-5 text-sm leading-relaxed text-sub">
                {reasonCode(dispute.dispute.reasonCodeId).note}
              </p>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-good">
                    On file
                  </h3>
                  <ul className="space-y-1.5">
                    {dispute.assessment.present.map((k) => (
                      <li key={k} className="flex gap-2 text-[13px] text-sub">
                        <span className="text-good">✓</span>
                        <span>{EVIDENCE_LABELS[k]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-bad">
                    Missing
                  </h3>
                  {dispute.assessment.gaps.length === 0 ? (
                    <p className="text-[13px] text-faint">Nothing missing.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {dispute.assessment.gaps.map((g) => (
                        <li key={g.kind} className="flex gap-2 text-[13px] text-sub">
                          <span className="text-bad">✗</span>
                          <span>
                            {g.label}
                            {g.mandatory && (
                              <span className="ml-1.5 font-mono text-[10px] font-semibold uppercase text-bad">
                                blocking
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 border-t border-linefaint pt-4 text-[13px]">
                <div>
                  <dt className="inline text-faint">coverage </dt>
                  <dd className="inline font-semibold tabular-nums text-ink">
                    {(dispute.assessment.coverage * 100).toFixed(0)}%
                  </dd>
                </div>
                <div>
                  <dt className="inline text-faint">win probability (assumed prior) </dt>
                  <dd className="inline font-semibold tabular-nums text-ink">
                    {(dispute.assessment.winProbability * 100).toFixed(0)}%
                  </dd>
                </div>
                <div>
                  <dt className="inline text-faint">expected value </dt>
                  <dd
                    className={`inline font-semibold tabular-nums ${
                      dispute.assessment.expectedValuePaise > 0
                        ? "text-good"
                        : "text-bad"
                    }`}
                  >
                    {formatRupees(dispute.assessment.expectedValuePaise)}
                  </dd>
                </div>
              </dl>
            </Card>
          )}

          <Card title="What we are doing, and why">
            {row.action && (
              <div className="mb-4 flex flex-wrap items-center gap-4">
                <ActionBadge action={row.action.kind} />
                {row.actionDayOffset !== null && row.action.kind !== "ABANDON" && (
                  <span className="text-[13px] text-faint">
                    fires at{" "}
                    <strong className="font-semibold text-ink">
                      +{row.actionDayOffset}d
                    </strong>{" "}
                    from failure
                  </span>
                )}
              </div>
            )}
            <blockquote className="border-l-2 border-ink pl-4 text-[15px] leading-relaxed text-ink">
              {row.rationale}
            </blockquote>
            {row.action?.kind === "ABANDON" && (
              <p className="mt-4 border-l-2 border-warn bg-warnsoft py-2.5 pl-4 pr-4 text-[13px] leading-relaxed text-warn">
                Stopping is the feature. Every attempt not spent here is an
                attempt available for a row that can actually be recovered.
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Context">
            <dl className="space-y-2.5 text-[13px]">
              <Row label="Source" value={row.source === "DISPUTE" ? "Dispute" : "Debit"} />
              <Row label="Customer" value={row.customerId} mono />
              <Row label="Instrument" value={row.instrumentType.replace(/_/g, " ")} />
              <Row label="Issuer" value={row.issuerBank} />
              <Row
                label="Segment"
                value={row.segment.toLowerCase().replace(/_/g, " ")}
              />
              <Row label="Failed on day" value={String(row.failedOnDay)} />
              <Row label="Attempts spent" value={String(row.attempts)} />
              <Row label="Nudges sent" value={String(row.nudges)} />
              {row.resolvedOnDay !== null && (
                <Row label="Resolved on day" value={String(row.resolvedOnDay)} />
              )}
              {row.recoveredPaise > 0 && (
                <Row label="Recovered" value={formatRupees(row.recoveredPaise)} />
              )}
            </dl>
          </Card>

          <Card title="Not visible to the policy">
            <p className="text-[13px] leading-relaxed text-sub">
              Salary day, balance curve, responsiveness and whether the customer
              has quietly revoked are all latent. The policy infers from the
              columns above and nothing else. Only the oracle baseline in the
              benchmark is allowed to see the rest.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-faint">{label}</dt>
      <dd className={`text-right text-ink ${mono ? "font-mono text-xs" : "tabular-nums"}`}>
        {value}
      </dd>
    </div>
  );
}
