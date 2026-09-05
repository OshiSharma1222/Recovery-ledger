import { formatRupees } from "@/components/ui";

export interface PreviewRow {
  readonly id: string;
  readonly rawCode: string;
  readonly cause: string;
  readonly action: string;
  readonly amountPaise: number;
  readonly recovered: boolean;
  readonly abandoned: boolean;
}

export interface PreviewStats {
  readonly atRiskPaise: number;
  readonly recoveredPaise: number;
  readonly abandoned: number;
}

export function LedgerPreview({
  rows,
  stats,
}: {
  rows: readonly PreviewRow[];
  stats: PreviewStats;
}) {
  return (
    <div className="overflow-hidden border border-line bg-card shadow-[0_1px_2px_rgba(20,23,31,0.04),0_12px_40px_-16px_rgba(20,23,31,0.14)]">
      <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
        </span>
        <span className="mx-auto rounded border border-line bg-card px-3 py-1 font-mono text-[11px] text-faint">
          localhost:3000/ledger
        </span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
        <div className="px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.1em] text-faint">
            At risk
          </div>
          <div className="mt-1.5 text-[22px] font-semibold tracking-tight">
            {formatRupees(stats.atRiskPaise)}
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.1em] text-faint">
            Recovered
          </div>
          <div className="mt-1.5 text-[22px] font-semibold tracking-tight text-good">
            {formatRupees(stats.recoveredPaise)}
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.1em] text-faint">
            Stopped on purpose
          </div>
          <div className="mt-1.5 text-[22px] font-semibold tracking-tight text-warn">
            {stats.abandoned.toLocaleString("en-IN")}
          </div>
        </div>
      </div>

      <ul className="divide-y divide-linefaint">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5"
          >
            <div className="min-w-40">
              <div className="font-mono text-[13px] text-ink">{r.id}</div>
              <div className="font-mono text-[11px] text-faint">{r.rawCode}</div>
            </div>
            <span className="font-mono text-[11px] text-sub">{r.cause}</span>
            <span
              className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-medium ${
                r.abandoned
                  ? "bg-warnsoft text-warn"
                  : r.recovered
                    ? "bg-goodsoft text-good"
                    : "bg-infosoft text-info"
              }`}
            >
              {r.action}
            </span>
            <span className="w-24 text-right text-[13px] font-semibold tabular-nums">
              {formatRupees(r.amountPaise)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
