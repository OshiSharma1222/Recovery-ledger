/**
 * Screen 1: the ledger.
 *
 * The point of this table is that it does not branch on `source` except to
 * render a badge. Failed recurring debits and chargebacks sit in the same
 * rows, with the same statuses and the same rationale column, because they are
 * the same problem: money the merchant is owed and has not got.
 */

import Link from "next/link";

import { getLedger, getSummary } from "@/lib/data";
import {
  ActionBadge,
  CauseBadge,
  formatRupees,
  Stat,
  StatusBadge,
} from "@/components/ui";

export default function LedgerPage() {
  const ledger = getLedger();
  const summary = getSummary();

  // Biggest exposure first: that is the order a recovery analyst works in.
  const rows = [...ledger].sort((a, b) => b.row.amountPaise - a.row.amountPaise);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recovery Ledger</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Every rupee a merchant is owed and has not got, in one table. Money
          that was never captured (failed recurring debits) and money that was
          captured and clawed back (disputes) are two <em>sources</em> feeding
          one schema and one policy interface.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="At risk" value={formatRupees(summary.atRisk)} hint={`${summary.rows} rows`} />
        <Stat
          label="Recovered"
          value={formatRupees(summary.recovered)}
          hint={`${((summary.recovered / summary.atRisk) * 100).toFixed(1)}% of at-risk`}
        />
        <Stat label="Failed debits" value={summary.failures.toLocaleString("en-IN")} hint="Lane 1" />
        <Stat label="Disputes" value={String(summary.disputes)} hint="Lane 2" />
        <Stat
          label="Abandoned"
          value={summary.abandoned.toLocaleString("en-IN")}
          hint="a decision, not a failure"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Row</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Raw code</th>
                <th className="px-4 py-3 font-medium">Root cause</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, 120).map(({ row, classification }) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/row/${row.id}`}
                      className="font-mono text-xs text-indigo-600 hover:underline"
                    >
                      {row.id}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-xs ring-1 ring-inset ${
                        row.source === "DISPUTE"
                          ? "bg-purple-50 text-purple-700 ring-purple-200"
                          : "bg-slate-50 text-slate-600 ring-slate-200"
                      }`}
                    >
                      {row.source === "DISPUTE" ? "dispute" : "debit"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                    {formatRupees(row.amountPaise)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                    {row.rawCode}
                  </td>
                  <td className="px-4 py-2.5">
                    {classification ? (
                      <CauseBadge cause={classification.cause.kind} />
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.action ? <ActionBadge action={row.action.kind} /> : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 120 && (
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Showing the 120 largest of {rows.length.toLocaleString("en-IN")} rows.
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Red root causes are <strong>terminal</strong>: no retry can ever succeed
        on them. Amber <code className="font-mono">ABANDON</code> actions are
        decisions to stop, not failures to recover.
      </p>
    </div>
  );
}
