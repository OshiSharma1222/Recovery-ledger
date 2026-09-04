import Link from "next/link";

import { getReport } from "@/lib/data";
import { Eyebrow, formatRupees } from "@/components/ui";
import { CountUp, DecisionTicker, type TickerItem } from "@/components/home-motion";

const TICKER_ORDER = [
  "RETRY_AT",
  "ABANDON",
  "REQUEST_MANDATE_RENEWAL",
  "SPLIT_AMOUNT",
  "REQUEST_INSTRUMENT_UPDATE",
  "RESEND_NOTICE",
  "ESCALATE",
] as const;

export default function HomePage() {
  const report = getReport();
  const get = (id: string) => report.metrics.find((m) => m.policyId === id)!;
  const b1 = get("B1");
  const b2t = get("B2T");
  const b3 = get("B3");

  const lift = b3.recoveredPaise / b1.recoveredPaise - 1;
  const liftVsTimed = b3.recoveredPaise / b2t.recoveredPaise - 1;
  const ceiling = b3.ceilingCapture ?? 0;

  const b3rows = report.results.find((r) => r.policyId === "B3")!.rows;
  const seen = new Set<string>();
  const ticker: TickerItem[] = [];
  for (const kind of TICKER_ORDER) {
    const row = b3rows.find(
      (r) =>
        r.action?.kind === kind &&
        !seen.has(kind) &&
        r.rationale.length > 40 &&
        r.rationale.length < 260,
    );
    if (!row || !row.action || !row.rootCause) continue;
    seen.add(kind);
    ticker.push({
      id: row.id,
      rawCode: row.rawCode,
      cause: row.rootCause.kind.toLowerCase(),
      action: row.action.kind.toLowerCase(),
      amountPaise: row.amountPaise,
      rationale: row.rationale,
      recovered: row.status === "RECOVERED",
      abandoned: row.status === "ABANDONED",
    });
  }

  return (
    <div className="space-y-16 pb-6">
      <section className="relative left-1/2 -mt-10 w-screen -translate-x-1/2 bg-header">
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-16 sm:pt-20">
          <p className="rise rise-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-paperdim">
            AI revenue recovery, bounded by design
          </p>
          <h1 className="rise rise-2 mt-4 max-w-3xl font-display text-[44px] font-medium leading-[1.08] tracking-tight text-white sm:text-[56px]">
            Every unrecovered rupee.
            <br />
            One ledger. One decision.
          </h1>
          <p className="rise rise-3 mt-5 max-w-xl text-[15px] leading-relaxed text-paperdim">
            Failed recurring debits and disputes are the same problem: money the
            merchant is owed and has not got. Recovery Ledger classifies why
            each rupee is stuck, chooses the one action that can work, and
            walks away from the rupees nothing can bring back.
          </p>
          <div className="rise rise-4 mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/replay"
              className="bg-white px-6 py-3 text-[14px] font-semibold text-ink transition-opacity hover:opacity-85"
            >
              Watch it work
            </Link>
            <Link
              href="/benchmark"
              className="border border-headerline px-6 py-3 text-[14px] font-medium text-paperdim transition-colors hover:border-white hover:text-white"
            >
              See the proof
            </Link>
          </div>
          <div className="rise rise-5 mt-12 flex flex-wrap items-end gap-x-12 gap-y-6 border-t border-headerline pt-8">
            <div>
              <CountUp
                value={b3.recoveredPaise}
                kind="rupees"
                className="text-[40px] font-semibold leading-none tracking-tight text-good"
              />
              <div className="mt-2 text-[13px] text-paperdim">
                recovered of {formatRupees(b3.atRiskPaise)} at risk
              </div>
            </div>
            <div>
              <CountUp
                value={lift}
                kind="pct"
                className="text-[40px] font-semibold leading-none tracking-tight text-white"
              />
              <div className="mt-2 text-[13px] text-paperdim">
                vs the day-1/3/5 dunning schedule
              </div>
            </div>
            <div className="hidden sm:block">
              <div className="text-[40px] font-semibold leading-none tracking-tight text-white">
                {(ceiling * 100).toFixed(1)}%
              </div>
              <div className="mt-2 text-[13px] text-paperdim">
                of a perfect-information ceiling
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rise rise-6">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-1.5 font-display text-[28px] font-medium tracking-tight text-ink">
          Four steps, one of them is stopping
        </h2>
        <div className="flow-track mt-8 hidden h-px bg-line lg:block">
          <span className="flow-dot" />
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:mt-6 lg:grid-cols-4">
          {[
            {
              n: "01",
              title: "Detect",
              body: "A debit bounces or a chargeback lands. Either way it becomes a row: amount, customer, and the raw gateway code, exactly as received.",
              code: "mandate_not_active",
            },
            {
              n: "02",
              title: "Diagnose",
              body: "That code is ambiguous. Joined with the merchant's own mandate record, it resolves: the mandate expired. This is not a balance problem.",
              code: "MANDATE_EXPIRED",
            },
            {
              n: "03",
              title: "Decide",
              body: "Retrying an expired mandate fails 100% of the time, so the engine asks for renewal instead, timed by a learned model, capped at two asks.",
              code: "request_mandate_renewal",
            },
            {
              n: "04",
              title: "Stop, on purpose",
              body: "A quarter of the ledger is unrecoverable. The engine abandons those rows and spends the saved attempts where money can actually come back.",
              code: "ABANDON",
            },
          ].map((s) => (
            <div key={s.n} className="border border-line bg-card p-5">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px] text-faint">{s.n}</span>
                <code className="bg-linefaint px-1.5 py-0.5 font-mono text-[11px] text-sub">
                  {s.code}
                </code>
              </div>
              <h3 className="mt-3 text-[15px] font-semibold text-ink">{s.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-sub">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {ticker.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between">
            <div>
              <Eyebrow>Straight from the engine</Eyebrow>
              <h2 className="mt-1.5 font-display text-[28px] font-medium tracking-tight text-ink">
                Real decisions, cycling live
              </h2>
            </div>
            <Link
              href="/ledger"
              className="text-[13px] font-medium text-sub transition-colors hover:text-ink"
            >
              Open the full ledger →
            </Link>
          </div>
          <div className="mt-6 border border-line bg-card px-6 py-6">
            <DecisionTicker items={ticker} />
          </div>
          <p className="mt-3 text-[13px] text-faint">
            Nothing above is written for this page. Each rationale is the policy
            engine&rsquo;s own output for a row in the current world.
          </p>
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="border border-line bg-card p-6">
          <div className="text-[32px] font-semibold tracking-tight text-ink">
            +{(liftVsTimed * 100).toFixed(1)}%
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-sub">
            over a smart-retry policy using the identical learned timing model.
            Timing is necessary; knowing what not to chase is the difference.
          </p>
        </div>
        <div className="border border-line bg-card p-6">
          <div className="text-[32px] font-semibold tracking-tight text-ink">
            20 / 20
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-sub">
            unseen seeds where the ledger beats every baseline. One command
            re-runs the sweep on your machine.
          </p>
        </div>
        <div className="border border-line bg-card p-6">
          <div className="text-[32px] font-semibold tracking-tight text-good">
            {b3.nudges}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-sub">
            customer messages across {b3.rowsTotal.toLocaleString("en-IN")} cases,
            capped at two per customer. Recovery is not allowed to become spam.
          </p>
        </div>
      </section>

      <section className="border border-line bg-card px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">
              Do not take this page&rsquo;s word for it
            </h2>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-sub">
              Every number here is computed when you load the page, never stored. On
              the ledger, replay and benchmark screens there is a box: type any
              word, press Run, and a brand new set of customers and failures is
              built around it. The same word always rebuilds the same world,
              which is what makes the benchmark reproducible.
            </p>
          </div>
          <code className="bg-header px-5 py-3 font-mono text-[13px] text-goodsoft">
            npm install && npm run bench
          </code>
        </div>
      </section>
    </div>
  );
}
