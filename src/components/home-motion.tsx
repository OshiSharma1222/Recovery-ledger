"use client";

import { useEffect, useRef, useState } from "react";

import { formatRupees } from "@/components/ui";

export function CountUp({
  value,
  kind,
  durationMs = 1400,
  className = "",
}: {
  value: number;
  kind: "rupees" | "pct";
  durationMs?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(value);
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  const text =
    kind === "rupees"
      ? formatRupees(shown)
      : `+${(shown * 100).toFixed(1)}%`;

  return <span className={`tabular-nums ${className}`}>{text}</span>;
}

export interface TickerItem {
  readonly id: string;
  readonly rawCode: string;
  readonly cause: string;
  readonly action: string;
  readonly amountPaise: number;
  readonly rationale: string;
  readonly recovered: boolean;
  readonly abandoned: boolean;
}

export function DecisionTicker({ items }: { items: readonly TickerItem[] }) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = reduced ? 6000 : 4200;
    const t = setInterval(() => {
      if (reduced) {
        setIdx((i) => (i + 1) % items.length);
        return;
      }
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % items.length);
        setVisible(true);
      }, 260);
    }, hold);
    return () => clearInterval(t);
  }, [items.length]);

  const item = items[idx]!;
  const tone = item.recovered
    ? "text-good"
    : item.abandoned
      ? "text-warn"
      : "text-info";
  const dot = item.recovered ? "bg-good" : item.abandoned ? "bg-warn" : "bg-info";

  return (
    <div
      className={`transition-all duration-300 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1.5"}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="font-mono text-xs text-faint">{item.id}</span>
        <code className="bg-linefaint px-1.5 py-0.5 font-mono text-xs text-ink">
          {item.rawCode}
        </code>
        <span className="text-[13px] text-faint">reads as</span>
        <span className="font-mono text-xs text-sub">{item.cause}</span>
        <span className="text-[13px] text-faint">so</span>
        <span className={`font-mono text-xs font-medium ${tone}`}>{item.action}</span>
        <span className="ml-auto text-sm font-semibold tabular-nums">
          {formatRupees(item.amountPaise)}
        </span>
      </div>
      <p className="mt-2.5 border-l-2 border-line pl-3.5 text-[13px] leading-relaxed text-sub">
        {item.rationale}
      </p>
    </div>
  );
}
