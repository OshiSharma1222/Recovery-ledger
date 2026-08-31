import { getReport } from "@/lib/data";
import {
  Card,
  Eyebrow,
  formatRupees,
  PageTitle,
  Stat,
  StatRow,
} from "@/components/ui";

export default function BenchmarkPage() {
  const report = getReport();
  const metrics = report.metrics;
  const b1 = metrics.find((m) => m.policyId === "B1")!;
  const b3 = metrics.find((m) => m.policyId === "B3")!;
  const b4 = metrics.find((m) => m.policyId === "B4")!;

  const lift = b3.recoveredPaise / b1.recoveredPaise - 1;
  const retrySaving = 1 - b3.retries / b1.retries;
  const wasteSaving = 1 - b3.wastedRetries / b1.wastedRetries;
  const maxRecovered = Math.max(...metrics.map((m) => m.recoveredPaise));

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Five policies, one seeded world</Eyebrow>
        <PageTitle>The proof</PageTitle>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-sub">
          Every policy runs over the same population with the same attempt
          budget and the same classifications. Reproduce it with{" "}
          <code className="bg-linefaint px-1.5 py-0.5 font-mono text-[13px] text-ink">
            npm run bench
          </code>{" "}
          — no API key, no database, no network.
        </p>
      </div>

      <div className="border border-line bg-card">
        <div className="flex flex-wrap items-end justify-between gap-6 px-6 py-6 sm:px-8">
          <div>
            <div className="text-[13px] text-sub">
              Recovered vs the fixed day-1/3/5 schedule
            </div>
            <div className="mt-2 text-[56px] font-semibold leading-none tracking-tight text-good">
              +{(lift * 100).toFixed(1)}%
            </div>
            <div className="mt-3 text-[13px] text-faint">
              {formatRupees(b3.recoveredPaise)} against{" "}
              {formatRupees(b1.recoveredPaise)}, on {formatRupees(b3.atRiskPaise)}{" "}
              at risk
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-line border border-line">
            <Stat
              label="Of ceiling"
              value={`${((b3.ceilingCapture ?? 0) * 100).toFixed(1)}%`}
              hint="share of the oracle"
            />
            <Stat
              label="Fewer retries"
              value={`−${(retrySaving * 100).toFixed(1)}%`}
              hint="vs fixed schedule"
            />
            <Stat
              label="Wasted attempts"
              value={`−${(wasteSaving * 100).toFixed(1)}%`}
              hint="on unrecoverable rows"
            />
          </div>
        </div>
      </div>

      <div className="border border-line bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-[0.08em] text-faint">
                <th className="px-5 py-3 font-medium">Policy</th>
                <th className="px-4 py-3 text-right font-medium">Recovered</th>
                <th className="w-40 px-4 py-3 font-medium max-md:hidden">
                  Share of at-risk
                </th>
                <th className="px-4 py-3 text-right font-medium">Rate</th>
                <th className="px-4 py-3 text-right font-medium">Of ceiling</th>
                <th className="px-4 py-3 text-right font-medium">Retries</th>
                <th className="px-4 py-3 text-right font-medium">Wasted</th>
                <th className="px-4 py-3 text-right font-medium">Per win</th>
                <th className="px-4 py-3 text-right font-medium">Nudges</th>
                <th className="px-5 py-3 text-right font-medium">Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linefaint">
              {metrics.map((m) => {
                const isB3 = m.policyId === "B3";
                return (
                  <tr
                    key={m.policyId}
                    className={
                      isB3
                        ? "border-l-2 border-l-good bg-goodsoft/40"
                        : "border-l-2 border-l-transparent"
                    }
                  >
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-[11px] text-faint">
                        {m.policyId}
                      </span>
                      <span
                        className={`ml-2.5 ${isB3 ? "font-semibold text-ink" : "text-sub"}`}
                      >
                        {m.policyName}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3.5 text-right tabular-nums ${isB3 ? "font-semibold" : "font-medium"}`}
                    >
                      {formatRupees(m.recoveredPaise)}
                    </td>
                    <td className="px-4 py-3.5 max-md:hidden">
                      <div className="h-[5px] w-full rounded-[2.5px] bg-linefaint">
                        <div
                          className={`h-[5px] rounded-[2.5px] ${isB3 ? "bg-good" : "bg-paperdim"}`}
                          style={{
                            width: `${maxRecovered === 0 ? 0 : (m.recoveredPaise / maxRecovered) * 100}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-sub">
                      {(m.recoveryRate * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-sub">
                      {m.ceilingCapture === null
                        ? "—"
                        : `${(m.ceilingCapture * 100).toFixed(1)}%`}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-sub">
                      {m.retries.toLocaleString("en-IN")}
                    </td>
                    <td
                      className={`px-4 py-3.5 text-right tabular-nums ${m.wastedRetries > 0 ? "text-bad" : "text-faint"}`}
                    >
                      {m.wastedRetries.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-sub">
                      {Number.isFinite(m.retriesPerRecovery)
                        ? m.retriesPerRecovery.toFixed(2)
                        : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-sub">
                      {m.nudges.toLocaleString("en-IN")}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-sub">
                      {m.meanDaysToRecovery.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Why the oracle is here">
          <p className="text-sm leading-relaxed text-sub">
            A bare recovery rate invites the question &ldquo;out of
            what?&rdquo;. {formatRupees(b3.unrecoverablePaise)} of this ledger —{" "}
            {((b3.unrecoverablePaise / b3.atRiskPaise) * 100).toFixed(0)}% — is
            structurally unrecoverable: expired mandates, debits above the
            authorised cap, revocations, risk blocks. For those rows the
            probability of success is identically zero at every offset, for
            every policy, forever.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-sub">
            B4 sees every latent variable and takes the best action available.
            It is a <strong className="text-ink">greedy</strong> oracle, not a
            proven optimum — a very strong upper bound rather than a
            mathematical one. Calling it optimal would be an overclaim.
          </p>
        </Card>

        <Card title="Setup">
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-sub">Population</dt>
              <dd className="tabular-nums">
                {report.customers.toLocaleString("en-IN")} customers
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-sub">Ledger</dt>
              <dd className="tabular-nums">
                {b3.rowsTotal.toLocaleString("en-IN")} rows,{" "}
                {formatRupees(b3.atRiskPaise)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-sub">Training seed</dt>
              <dd className="font-mono text-xs">{report.trainSeed}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-sub">Evaluation seed</dt>
              <dd className="font-mono text-xs">{report.testSeed}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-sub">Classifier accuracy</dt>
              <dd className="tabular-nums">
                {(report.classifierAccuracy * 100).toFixed(1)}%
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-sub">Elapsed</dt>
              <dd className="tabular-nums">{report.elapsedMs}ms</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-linefaint pt-3 text-xs leading-relaxed text-faint">
            The timing estimator is fitted on a population from a different
            seed than the one scored here, and the harness refuses to run if
            they ever match. Simulator parameters were frozen and committed
            before the policy engine was written.
          </p>
        </Card>
      </div>

      <Card title="Stated limitation">
        <p className="text-sm leading-relaxed text-sub">
          The simulator&rsquo;s response model is authored by me, so this
          benchmark measures policy quality against{" "}
          <strong className="text-ink">
            a stated model of the world, not production reality
          </strong>
          . The parameters were frozen and committed before the policy engine
          existed — verify with{" "}
          <code className="bg-linefaint px-1.5 py-0.5 font-mono text-xs text-ink">
            git log --follow -- src/core/simulator/params.ts
          </code>
          . What is real: the Razorpay reason codes, the RBI e-mandate
          constraints, and the network dispute codes.
        </p>
      </Card>
    </div>
  );
}
