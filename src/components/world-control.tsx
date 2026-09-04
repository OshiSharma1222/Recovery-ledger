"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const WORDS = [
  "monsoon",
  "chai",
  "diwali",
  "auto",
  "mumbai",
  "kolkata",
  "sitar",
  "mango",
  "banyan",
  "kite",
  "tabla",
  "jaipur",
];

export function WorldControl({
  seed,
  elapsedMs,
  customers,
  rows,
}: {
  seed: string | undefined;
  elapsedMs: number;
  customers: number;
  rows: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(seed ?? "");
  const [pending, startTransition] = useTransition();

  const go = (next: string) => {
    setValue(next);
    startTransition(() => {
      router.push(next ? `${pathname}?seed=${encodeURIComponent(next)}` : pathname);
      router.refresh();
    });
  };

  const randomWord = () => {
    const pool = WORDS.filter((w) => w !== value);
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    go(pick);
  };

  return (
    <div className="border border-line bg-card">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span className="text-[13px] font-semibold text-ink">
          Build a different world:
        </span>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(value.trim());
          }}
          className="flex flex-1 flex-wrap items-center gap-2"
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="type any word"
            aria-label="Seed word for a new simulated world"
            className="min-w-44 flex-1 border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-ink"
          />
          <button
            type="submit"
            disabled={pending}
            className="border border-ink bg-ink px-5 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {pending ? "Running..." : "Run"}
          </button>
          <button
            type="button"
            onClick={randomWord}
            disabled={pending}
            className="border border-line px-4 py-2 text-[13px] font-medium text-sub transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
          >
            Surprise me
          </button>
          {seed && (
            <button
              type="button"
              onClick={() => go("")}
              disabled={pending}
              className="text-[13px] text-faint underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
            >
              reset
            </button>
          )}
        </form>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-linefaint px-5 py-2.5 text-xs text-faint">
        <span
          className={`h-1.5 w-1.5 rounded-full ${pending ? "animate-pulse bg-warn" : "bg-good"}`}
        />
        {pending ? (
          <span className="text-warn">
            Simulating {customers.toLocaleString("en-IN")} customers and running
            six strategies over them...
          </span>
        ) : (
          <span>
            Simulated {customers.toLocaleString("en-IN")} customers, found{" "}
            {rows.toLocaleString("en-IN")} failed payments and ran six strategies
            over them in <strong className="text-sub">{elapsedMs}ms</strong>
            {seed ? (
              <>
                {" "}
                for the world called{" "}
                <strong className="font-mono text-sub">{seed}</strong>
              </>
            ) : null}
            . Nothing on this page is stored; it is all computed on request.
          </span>
        )}
      </div>
    </div>
  );
}
