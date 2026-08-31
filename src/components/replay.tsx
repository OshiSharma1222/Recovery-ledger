"use client";

import { useEffect, useMemo, useState } from "react";

import type { ReplayData, ReplayRow } from "@/lib/data";
import { formatRupees } from "@/components/ui";

const TICK_MS = 160;

interface Totals {
  recoveredPaise: number;
  recoveredRows: number;
  abandonedRows: number;
  lostRows: number;
}

function totalsAt(rows: readonly ReplayRow[], day: number): Totals {
  let recoveredPaise = 0;
  let recoveredRows = 0;
  let abandonedRows = 0;
  let lostRows = 0;
  for (const r of rows) {
    if (r.resolvedDay > day) continue;
    if (r.status === "RECOVERED") {
      recoveredPaise += r.amountPaise;
      recoveredRows += 1;
    } else if (r.status === "ABANDONED") {
      abandonedRows += 1;
    } else {
      lostRows += 1;
    }
  }
  return { recoveredPaise, recoveredRows, abandonedRows, lostRows };
}

export function ReplayPlayer({ data }: { data: ReplayData }) {
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const b1 = data.policies[0]!;
  const b3 = data.policies[1]!;

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setDay((d) => {
        if (d >= data.horizon) {
          setPlaying(false);
          return d;
        }
        return d + 1;
      });
    }, TICK_MS / speed);
    return () => clearInterval(t);
  }, [playing, speed, data.horizon]);

  const t1 = useMemo(() => totalsAt(b1.rows, day), [b1.rows, day]);
  const t3 = useMemo(() => totalsAt(b3.rows, day), [b3.rows, day]);

  const events = useMemo(() => {
    const out = b3.rows
      .filter((r) => r.resolvedDay <= day)
      .sort((a, b) => b.resolvedDay - a.resolvedDay || b.amountPaise - a.amountPaise)
      .slice(0, 9);
    return out;
  }, [b3.rows, day]);

  const gap = t3.recoveredPaise - t1.recoveredPaise;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 border border-line bg-card px-5 py-4">
        <button
          onClick={() => {
            if (day >= data.horizon) setDay(0);
            setPlaying((p) => !p);
          }}
          className="border border-ink bg-ink px-5 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-85"
        >
          {playing ? "Pause" : day >= data.horizon ? "Replay" : day > 0 ? "Resume" : `Play ${data.horizon} days`}
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            setDay(0);
          }}
          className="border border-line px-4 py-2 text-[13px] font-medium text-sub transition-colors hover:border-ink hover:text-ink"
        >
          Reset
        </button>
        <div className="flex items-center gap-1">
          {[1, 2, 4].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2.5 py-1.5 font-mono text-xs transition-colors ${
                speed === s ? "bg-ink text-white" : "text-sub hover:text-ink"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={data.horizon}
          value={day}
          onChange={(e) => {
            setPlaying(false);
            setDay(Number(e.target.value));
          }}
          className="min-w-40 flex-1 accent-ink"
        />
        <div className="font-mono text-sm tabular-nums text-ink">
          day {String(day).padStart(2, "0")} / {data.horizon}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {[
          { policy: b1, totals: t1, accent: false },
          { policy: b3, totals: t3, accent: true },
        ].map(({ policy, totals, accent }) => (
          <div
            key={policy.id}
            className={`border bg-card ${accent ? "border-good" : "border-line"}`}
          >
            <div className="flex items-baseline justify-between border-b border-linefaint px-5 py-3">
              <span className="text-[13px] font-semibold text-ink">
                <span className="font-mono text-[11px] text-faint">{policy.id}</span>{" "}
                {policy.name}
              </span>
              <span
                className={`text-xl font-semibold tabular-nums tracking-tight ${accent ? "text-good" : "text-ink"}`}
              >
                {formatRupees(totals.recoveredPaise)}
              </span>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-faint">
                  <span>recovered</span>
                  <span className="tabular-nums">
                    {((totals.recoveredPaise / data.atRiskPaise) * 100).toFixed(1)}% of{" "}
                    {formatRupees(data.atRiskPaise)} at risk
                  </span>
                </div>
                <div
                  className={`h-2 w-full rounded-[4px] ${accent ? "bg-goodsoft" : "bg-linefaint"}`}
                >
                  <div
                    className={`h-2 rounded-[4px] transition-all duration-150 ${accent ? "bg-good" : "bg-paperdim"}`}
                    style={{
                      width: `${(totals.recoveredPaise / data.atRiskPaise) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <dd className="text-lg font-semibold tabular-nums text-good">
                    {totals.recoveredRows}
                  </dd>
                  <dt className="text-[11px] text-faint">recovered</dt>
                </div>
                <div>
                  <dd className="text-lg font-semibold tabular-nums text-warn">
                    {totals.abandonedRows}
                  </dd>
                  <dt className="text-[11px] text-faint">abandoned</dt>
                </div>
                <div>
                  <dd className="text-lg font-semibold tabular-nums text-bad">
                    {totals.lostRows}
                  </dd>
                  <dt className="text-[11px] text-faint">lost</dt>
                </div>
              </dl>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 border border-line bg-card px-5 py-4">
        <span className="text-[13px] text-sub">
          Gap after day {day}: the ledger has recovered
        </span>
        <span
          className={`text-xl font-semibold tabular-nums tracking-tight ${gap >= 0 ? "text-good" : "text-bad"}`}
        >
          {gap >= 0 ? "+" : ""}
          {formatRupees(gap)}
        </span>
        <span className="text-[13px] text-sub">
          more than the fixed schedule, while abandoning {t3.abandonedRows} rows it
          knew it could not win
        </span>
      </div>

      <div className="border border-line bg-card">
        <h2 className="border-b border-linefaint px-5 py-3 text-[13px] font-semibold text-ink">
          Decision feed · {b3.name}
        </h2>
        <ul className="divide-y divide-linefaint">
          {events.length === 0 && (
            <li className="px-5 py-4 text-[13px] text-faint">
              Press play. Rows resolve as the days advance.
            </li>
          )}
          {events.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px]"
            >
              <span className="font-mono text-[11px] tabular-nums text-faint">
                d{String(r.resolvedDay).padStart(2, "0")}
              </span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  r.status === "RECOVERED"
                    ? "bg-good"
                    : r.status === "ABANDONED"
                      ? "bg-warn"
                      : "bg-bad"
                }`}
              />
              <span className="font-mono text-xs text-ink">{r.id}</span>
              <span className="font-medium tabular-nums">
                {formatRupees(r.amountPaise)}
              </span>
              <span className="font-mono text-xs text-faint">{r.causeKind}</span>
              <span className="font-mono text-xs text-sub">{r.actionKind}</span>
              <span
                className={`ml-auto text-xs font-medium ${
                  r.status === "RECOVERED"
                    ? "text-good"
                    : r.status === "ABANDONED"
                      ? "text-warn"
                      : "text-bad"
                }`}
              >
                {r.status.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
