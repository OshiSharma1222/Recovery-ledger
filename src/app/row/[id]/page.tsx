import Link from "next/link";
import { notFound } from "next/navigation";

import { getRow } from "@/lib/data";
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const view = getRow(id);
  if (!view) notFound();

  const { row, classification, causeDescription, dispute } = view;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-indigo-600 hover:underline">
          ← Ledger
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold">{row.id}</h1>
          <StatusBadge status={row.status} />
          <span className="text-xl font-semibold tabular-nums">
            {formatRupees(row.amountPaise)}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="What the gateway said">
            <div className="flex items-center gap-3">
              <code className="rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-800">
                {row.rawCode}
              </code>
              <span className="text-sm text-slate-500">
                {row.source === "DISPUTE"
                  ? "network reason code"
                  : "raw reason code, exactly as received"}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              This string is all a real merchant gets. Everything below is
              inferred from it plus data the merchant already holds.
            </p>
          </Card>

          {classification && (
            <Card title="What it actually means">
              <div className="flex flex-wrap items-center gap-3">
                <CauseBadge cause={classification.cause.kind} />
                <span className="text-sm text-slate-500">
                  classifier confidence{" "}
                  <strong className="text-slate-700">
                    {(classification.confidence * 100).toFixed(0)}%
                  </strong>
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-700">{causeDescription}</p>
              <ul className="mt-3 space-y-1">
                {classification.evidence.map((e) => (
                  <li key={e} className="text-sm text-slate-600">
                    <span className="text-slate-400">•</span> {e}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {dispute && (
            <Card title="Evidence gap analysis">
              <div className="mb-4 text-sm text-slate-600">
                {reasonCode(dispute.dispute.reasonCodeId).note}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    On file
                  </h3>
                  <ul className="space-y-1">
                    {dispute.assessment.present.map((k) => (
                      <li key={k} className="text-sm text-slate-700">
                        ✓ {EVIDENCE_LABELS[k]}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                    Missing
                  </h3>
                  {dispute.assessment.gaps.length === 0 ? (
                    <p className="text-sm text-slate-500">Nothing missing.</p>
                  ) : (
                    <ul className="space-y-1">
                      {dispute.assessment.gaps.map((g) => (
                        <li key={g.kind} className="text-sm text-slate-700">
                          ✗ {g.label}
                          {g.mandatory && (
                            <span className="ml-1 rounded bg-rose-100 px-1 text-xs font-semibold text-rose-700">
                              BLOCKING
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="mt-4 flex gap-6 border-t border-slate-100 pt-3 text-sm">
                <span className="text-slate-500">
                  coverage{" "}
                  <strong className="text-slate-800">
                    {(dispute.assessment.coverage * 100).toFixed(0)}%
                  </strong>
                </span>
                <span className="text-slate-500">
                  win probability{" "}
                  <strong className="text-slate-800">
                    {(dispute.assessment.winProbability * 100).toFixed(0)}%
                  </strong>
                </span>
                <span className="text-slate-500">
                  expected value{" "}
                  <strong
                    className={
                      dispute.assessment.expectedValuePaise > 0
                        ? "text-emerald-700"
                        : "text-rose-700"
                    }
                  >
                    {formatRupees(dispute.assessment.expectedValuePaise)}
                  </strong>
                </span>
              </div>
            </Card>
          )}

          <Card title="What we are doing, and why">
            {row.action && (
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <ActionBadge action={row.action.kind} />
                {row.actionDayOffset !== null && row.action.kind !== "ABANDON" && (
                  <span className="text-sm text-slate-500">
                    fires at{" "}
                    <strong className="text-slate-700">
                      +{row.actionDayOffset}d
                    </strong>{" "}
                    from failure
                  </span>
                )}
              </div>
            )}
            <p className="text-sm leading-relaxed text-slate-800">{row.rationale}</p>
            {row.action?.kind === "ABANDON" && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
                Stopping is the feature. Every attempt not spent here is an
                attempt available for a row that can actually be recovered.
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Context">
            <dl className="space-y-2 text-sm">
              <Row label="Source" value={row.source} />
              <Row label="Customer" value={row.customerId} mono />
              <Row label="Instrument" value={row.instrumentType} />
              <Row label="Issuer" value={row.issuerBank} />
              <Row label="Segment" value={row.segment.toLowerCase().replace(/_/g, " ")} />
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
            <p className="text-sm text-slate-600">
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
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
