import Link from "next/link";

import { getLedger, getSummary, normalizeSeed } from "@/lib/data";
import {
  ActionBadge,
  CauseBadge,
  Eyebrow,
  formatRupees,
  PageTitle,
  Stat,
  StatRow,
  StatusBadge,
} from "@/components/ui";

export default async function LedgerTablePage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string }>;
}) {
  const seed = normalizeSeed((await searchParams).seed);
  const ledger = getLedger(seed);
  const summary = getSummary(seed);
  const rows = [...ledger].sort((a, b) => b.row.amountPaise - a.row.amountPaise);

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Lane 1 + Lane 2{seed ? ` · world "${seed}"` : ""}</Eyebrow>
        <PageTitle>The ledger</PageTitle>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-sub">
          The merchant&rsquo;s list of stuck money, one row per rupee at
          risk. Failed subscription payments and chargebacks sit in the same
          table because they are the same problem. Click any row to see its
          full story: what the bank said, what it really means, and what the
          engine chose to do about it.
        </p>
      </div>

      <StatRow>
        <Stat
          label="At risk"
          value={formatRupees(summary.atRisk)}
          hint={`${summary.rows.toLocaleString("en-IN")} rows`}
        />
        <Stat
          label="Recovered"
          value={formatRupees(summary.recovered)}
          hint={`${((summary.recovered / summary.atRisk) * 100).toFixed(1)}% of at-risk`}
          tone="good"
        />
        <Stat
          label="Failed debits"
          value={summary.failures.toLocaleString("en-IN")}
          hint="Lane 1 · recurring"
        />
        <Stat
          label="Disputes"
          value={String(summary.disputes)}
          hint="Lane 2 · chargebacks"
        />
        <Stat
          label="Abandoned"
          value={summary.abandoned.toLocaleString("en-IN")}
          hint="a decision, not a failure"
          tone="warn"
        />
      </StatRow>

      <div className="border border-line bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-[0.08em] text-faint">
                <th className="px-5 py-3 font-medium">Row</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">What the bank said</th>
                <th className="px-4 py-3 font-medium">Why it failed</th>
                <th className="px-4 py-3 font-medium">What we did</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linefaint">
              {rows.slice(0, 120).map(({ row, classification }) => (
                <tr key={row.id} className="transition-colors hover:bg-paper">
                  <td className="px-5 py-3">
                    <Link
                      href={`/row/${row.id}${seed ? `?seed=${encodeURIComponent(seed)}` : ""}`}
                      className="font-mono text-xs text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                    >
                      {row.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-sub">
                    {row.source === "DISPUTE" ? "Dispute" : "Debit"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatRupees(row.amountPaise)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-faint">
                    {row.rawCode}
                  </td>
                  <td className="px-4 py-3">
                    {classification ? (
                      <CauseBadge cause={classification.cause.kind} />
                    ) : (
                      <span className="text-xs text-faint">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.action ? <ActionBadge action={row.action.kind} /> : null}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 120 && (
          <div className="border-t border-line px-5 py-3 text-xs text-faint">
            Showing the 120 largest of {rows.length.toLocaleString("en-IN")} rows
          </div>
        )}
      </div>

      <p className="max-w-2xl text-[13px] leading-relaxed text-faint">
        Red reasons are dead ends: no retry can ever bring that money back.
        Amber actions mean the engine chose to stop chasing, which is a
        decision, not a failure. Every other row gets the one fix that can
        actually work.
      </p>
    </div>
  );
}
