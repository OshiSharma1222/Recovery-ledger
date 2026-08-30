/**
 * The entire component library.
 *
 * Four primitives, no dependency, no custom CSS beyond Tailwind utilities.
 * The plan budgeted half a day for the dashboard and identified the frontend
 * as the largest schedule risk in the project, so this is deliberately the
 * smallest thing that films well.
 */

import type { ReactNode } from "react";

import type { LedgerStatus } from "@/core/ledger";
import type { RecoveryActionKind, RootCauseKind } from "@/core/taxonomy";

export function formatRupees(paise: number): string {
  const r = paise / 100;
  if (r >= 10_000_000) return `₹${(r / 10_000_000).toFixed(2)}Cr`;
  if (r >= 100_000) return `₹${(r / 100_000).toFixed(2)}L`;
  return `₹${r.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {title && (
        <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
          {title}
        </h2>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<LedgerStatus, string> = {
  RECOVERED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  ABANDONED: "bg-amber-50 text-amber-700 ring-amber-200",
  LOST: "bg-rose-50 text-rose-700 ring-rose-200",
  OPEN: "bg-slate-50 text-slate-600 ring-slate-200",
  IN_PROGRESS: "bg-sky-50 text-sky-700 ring-sky-200",
};

/**
 * ABANDONED is amber, not red.
 *
 * It is a decision, not a failure, and the colour should say so. LOST -- we
 * tried and ran out of runway -- is the red one. Reviewers read the legend.
 */
export function StatusBadge({ status }: { status: LedgerStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {status.toLowerCase().replace("_", " ")}
    </span>
  );
}

const TERMINAL_CAUSES = new Set<RootCauseKind>([
  "MANDATE_EXPIRED",
  "MANDATE_AMOUNT_EXCEEDED",
  "MANDATE_REVOKED",
  "CARD_EXPIRED",
  "RISK_BLOCKED",
]);

export function CauseBadge({ cause }: { cause: RootCauseKind }) {
  const terminal = TERMINAL_CAUSES.has(cause);
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 font-mono text-xs ring-1 ring-inset ${
        terminal
          ? "bg-rose-50 text-rose-700 ring-rose-200"
          : "bg-slate-50 text-slate-700 ring-slate-200"
      }`}
      title={terminal ? "Terminal: no retry can ever succeed" : "Retryable"}
    >
      {cause}
    </span>
  );
}

export function ActionBadge({ action }: { action: RecoveryActionKind }) {
  const abandon = action === "ABANDON";
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 font-mono text-xs ring-1 ring-inset ${
        abandon
          ? "bg-amber-50 text-amber-800 ring-amber-200"
          : "bg-indigo-50 text-indigo-700 ring-indigo-200"
      }`}
    >
      {action}
    </span>
  );
}
