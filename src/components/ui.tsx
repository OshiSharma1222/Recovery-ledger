import type { ReactNode } from "react";

import type { LedgerStatus } from "@/core/ledger";
import type { RecoveryActionKind, RootCauseKind } from "@/core/taxonomy";

export function formatRupees(paise: number): string {
  const r = paise / 100;
  if (r >= 10_000_000) return `₹${(r / 10_000_000).toFixed(2)}Cr`;
  if (r >= 100_000) return `₹${(r / 100_000).toFixed(2)}L`;
  return `₹${r.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
      {children}
    </p>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="mt-1.5 font-display text-[34px] font-medium leading-tight tracking-tight text-ink">
      {children}
    </h1>
  );
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
    <section className={`border border-line bg-card ${className}`}>
      {title && (
        <h2 className="border-b border-linefaint px-5 py-3 text-[13px] font-semibold text-ink">
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
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ink" | "good" | "warn";
}) {
  const toneClass =
    tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="px-5 py-4 sm:px-6">
      <div className="text-xs text-sub">{label}</div>
      <div
        className={`mt-1 text-[26px] font-semibold leading-none tracking-tight ${toneClass}`}
      >
        {value}
      </div>
      {hint && <div className="mt-1.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-line border border-line bg-card max-sm:divide-y sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none sm:divide-x">
      {children}
    </div>
  );
}

const STATUS: Record<LedgerStatus, { dot: string; text: string; label: string }> = {
  RECOVERED: { dot: "bg-good", text: "text-good", label: "Recovered" },
  ABANDONED: { dot: "bg-warn", text: "text-warn", label: "Abandoned" },
  LOST: { dot: "bg-bad", text: "text-bad", label: "Lost" },
  IN_PROGRESS: { dot: "bg-info", text: "text-info", label: "In progress" },
  OPEN: { dot: "bg-faint", text: "text-sub", label: "Open" },
};

export function StatusBadge({ status }: { status: LedgerStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
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
      className={`font-mono text-xs ${terminal ? "text-bad" : "text-sub"}`}
      title={terminal ? "Terminal: no retry can ever succeed" : "Retryable"}
    >
      {cause.toLowerCase()}
    </span>
  );
}

export function ActionBadge({ action }: { action: RecoveryActionKind }) {
  const abandon = action === "ABANDON";
  return (
    <span
      className={`font-mono text-xs ${abandon ? "font-medium text-warn" : "text-ink"}`}
    >
      {action.toLowerCase()}
    </span>
  );
}
