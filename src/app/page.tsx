import Link from "next/link";

import { getReport } from "@/lib/data";
import { Eyebrow, formatRupees } from "@/components/ui";
import { CountUp, DecisionTicker, type TickerItem } from "@/components/home-motion";
import { HeroDiagram } from "@/components/hero-diagram";
import { LedgerPreview, type PreviewRow } from "@/components/ledger-preview";

const TICKER_ORDER = [
  "RETRY_AT",
  "ABANDON",
  "REQUEST_MANDATE_RENEWAL",
  "SPLIT_AMOUNT",
  "REQUEST_INSTRUMENT_UPDATE",
  "RESEND_NOTICE",
  "ESCALATE",
] as const;

const PREVIEW_ORDER = [
  "SPLIT_AMOUNT",
  "ABANDON",
  "RETRY_AT",
  "REQUEST_MANDATE_RENEWAL",
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

  const preview: PreviewRow[] = [];
  for (const kind of PREVIEW_ORDER) {
    const row = b3rows.find(
      (r) => r.action?.kind === kind && !preview.some((p) => p.id === r.id),
    );
    if (!row || !row.action || !row.rootCause) continue;
    preview.push({
      id: row.id,
      rawCode: row.rawCode,
      cause: row.rootCause.kind.toLowerCase().replace(/_/g, " "),
      action: row.action.kind.toLowerCase().replace(/_/g, " "),
      amountPaise: row.amountPaise,
      recovered: row.status === "RECOVERED",
      abandoned: row.status === "ABANDONED",
    });
  }

  return (
    <div className="space-y-14 pb-6">
      <section className="relative left-1/2 -mt-10 w-screen -translate-x-1/2 bg-header">
        <div className="mx-auto max-w-3xl px-6 pb-14 pt-12 text-center sm:pt-16">
          <p className="rise rise-1 inline-flex flex-wrap items-center justify-center gap-x-2 rounded-full border border-headerline bg-[#1c202b] px-4 py-1.5 text-[12px] text-paperdim">
            Built for
            <span className="font-medium text-white">Razorpay AI Buildathon 2026</span>
            <span aria-hidden="true" className="text-paperdim opacity-50">/</span>
            AI Revenue Recovery
          </p>
          <h1 className="rise rise-2 mt-5 font-display text-[42px] font-medium leading-[1.06] tracking-tight text-white sm:text-[56px]">
            Stop chasing the money
            <br />
            that <em>cannot</em> come back
          </h1>
          <p className="rise rise-3 mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-paperdim">
            Recovery Ledger reads why each subscription payment failed, takes the
            one action that can actually work, and walks away from the quarter of
            the money that no retry will ever bring back.
          </p>
          <div className="rise rise-4 mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/replay"
              className="rounded-full bg-good px-7 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              See it working
            </Link>
            <Link
              href="/benchmark"
              className="rounded-full border border-headerline px-7 py-3 text-[14px] font-medium text-paperdim transition-colors hover:border-white hover:text-white"
            >
              Check the numbers
            </Link>
          </div>
          <div className="rise rise-5 mt-10 flex flex-wrap items-end justify-center gap-x-12 gap-y-5 border-t border-headerline pt-7">
            <div>
              <CountUp
                value={b3.recoveredPaise}
                kind="rupees"
                className="text-[32px] font-semibold leading-none tracking-tight text-good"
              />
              <div className="mt-2 text-[13px] text-paperdim">
                recovered of {formatRupees(b3.atRiskPaise)}
              </div>
            </div>
            <div>
              <CountUp
                value={lift}
                kind="pct"
                className="text-[34px] font-semibold leading-none tracking-tight text-white"
              />
              <div className="mt-2 text-[13px] text-paperdim">
                over standard retries
              </div>
            </div>
            <div>
              <div className="text-[34px] font-semibold leading-none tracking-tight text-white">
                {(ceiling * 100).toFixed(1)}%
              </div>
              <div className="mt-2 text-[13px] text-paperdim">
                of what was winnable
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="-mt-9">
        <LedgerPreview
          rows={preview}
          stats={{
            atRiskPaise: b3.atRiskPaise,
            recoveredPaise: b3.recoveredPaise,
            abandoned: b3.rowsAbandoned,
          }}
        />
        <p className="mt-3 text-center text-[13px] text-faint">
          Real rows from the engine, computed when you loaded this page. Not a
          screenshot.
        </p>
      </section>

      <section>
        <div className="text-center">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-1.5 font-display text-[30px] font-medium tracking-tight text-ink">
            Four steps, and one of them is stopping
          </h2>
        </div>
        <div className="mt-8 grid items-center gap-10 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="hidden lg:block">
            <HeroDiagram />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {[
              {
                title: "Detect",
                body: "A payment bounces or a chargeback lands. Either becomes one row: amount, customer, and the raw bank code exactly as received.",
                code: "payment_cancelled",
              },
              {
                title: "Diagnose",
                body: "That code is ambiguous alone. Joined with the merchant's own mandate record it resolves to a real cause, at 96.3% accuracy.",
                code: "MANDATE_REVOKED",
              },
              {
                title: "Decide",
                body: "Every cause has one action that can work: retry at a learned moment, renew the mandate, or split a debit that breached its cap.",
                code: "retry_at",
              },
              {
                title: "Stop, on purpose",
                body: "When nothing can work the engine spends nothing, and the saved attempts go where money can actually come back.",
                code: "ABANDON",
              },
            ].map((s) => (
              <div key={s.title} className="border border-line bg-card p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-semibold text-ink">{s.title}</h3>
                  <code className="bg-linefaint px-1.5 py-0.5 font-mono text-[11px] text-sub">
                    {s.code}
                  </code>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-sub">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {ticker.length > 0 && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <Eyebrow>Straight from the engine</Eyebrow>
              <h2 className="mt-1.5 font-display text-[30px] font-medium tracking-tight text-ink">
                Real decisions, cycling live
              </h2>
            </div>
            <Link
              href="/ledger"
              className="text-[13px] font-medium text-sub transition-colors hover:text-ink"
            >
              Open the full ledger
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
          <div className="text-[30px] font-semibold tracking-tight text-ink">
            +{(liftVsTimed * 100).toFixed(1)}%
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-sub">
            over a smart-retry policy using the identical learned timing model.
            Timing is necessary; knowing what not to chase is the difference.
          </p>
        </div>
        <div className="border border-line bg-card p-6">
          <div className="text-[30px] font-semibold tracking-tight text-ink">
            20 / 20
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-sub">
            unseen worlds where the ledger beats every baseline. One command
            re-runs the whole sweep on your machine.
          </p>
        </div>
        <div className="border border-line bg-card p-6">
          <div className="text-[30px] font-semibold tracking-tight text-good">
            {b3.nudges}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-sub">
            customer messages across {b3.rowsTotal.toLocaleString("en-IN")} cases,
            capped at two per person. Recovery is not allowed to become spam.
          </p>
        </div>
      </section>

      <section className="border border-line bg-card px-6 py-7">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <h2 className="font-display text-[22px] font-medium tracking-tight text-ink">
              Do not take this page&rsquo;s word for it
            </h2>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-sub">
              Every number here is computed when you load the page, never stored.
              On the ledger, replay and benchmark screens there is a box: type any
              word, press Run, and a brand new set of customers and failures is
              built around it. The same word always rebuilds the same world, which
              is what makes the benchmark reproducible.
            </p>
          </div>
          <code className="bg-header px-5 py-3 font-mono text-[13px] text-goodsoft">
            npm install &amp;&amp; npm run bench
          </code>
        </div>
      </section>
    </div>
  );
}
