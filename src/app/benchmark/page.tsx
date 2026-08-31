import { getReport } from "@/lib/data";
import { Card, formatRupees, Stat } from "@/components/ui";

export default function BenchmarkPage() {
  const report = getReport();
  const metrics = report.metrics;
  const b1 = metrics.find((m) => m.policyId === "B1")!;
  const b3 = metrics.find((m) => m.policyId === "B3")!;
  const b4 = metrics.find((m) => m.policyId === "B4")!;

  const lift = b3.recoveredPaise / b1.recoveredPaise - 1;
  const retrySaving = 1 - b3.retries / b1.retries;
  const wasteSaving = 1 - b3.wastedRetries / b1.wastedRetries;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Benchmark</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Every policy run over the same seeded population, with the same
          attempt budget and the same classifications. Reproduce with{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
            npm run bench
          </code>{" "}
          — no API key, no database, no network.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="vs fixed schedule"
          value={`+${(lift * 100).toFixed(1)}%`}
          hint="more money recovered than B1"
        />
        <Stat
          label="Of ceiling"
          value={`${((b3.ceilingCapture ?? 0) * 100).toFixed(1)}%`}
          hint="share of what the oracle managed"
        />
        <Stat
          label="Fewer retries"
          value={`${(retrySaving * 100).toFixed(1)}%`}
          hint="attempts saved vs B1"
        />
        <Stat
          label="Less waste"
          value={`${(wasteSaving * 100).toFixed(1)}%`}
          hint="fewer attempts on terminal rows"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Policy</th>
                <th className="px-4 py-3 text-right font-medium">Recovered</th>
                <th className="px-4 py-3 text-right font-medium">Rate</th>
                <th className="px-4 py-3 text-right font-medium">Of ceiling</th>
                <th className="px-4 py-3 text-right font-medium">Retries</th>
                <th className="px-4 py-3 text-right font-medium">Wasted</th>
                <th className="px-4 py-3 text-right font-medium">Per win</th>
                <th className="px-4 py-3 text-right font-medium">Nudges</th>
                <th className="px-4 py-3 text-right font-medium">Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {metrics.map((m) => (
                <tr
                  key={m.policyId}
                  className={m.policyId === "B3" ? "bg-indigo-50/60" : undefined}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-400">
                      {m.policyId}
                    </span>{" "}
                    <span
                      className={
                        m.policyId === "B3" ? "font-semibold text-indigo-900" : ""
                      }
                    >
                      {m.policyName}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatRupees(m.recoveredPaise)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {(m.recoveryRate * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {m.ceilingCapture === null
                      ? "—"
                      : `${(m.ceilingCapture * 100).toFixed(1)}%`}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {m.retries.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-rose-700">
                    {m.wastedRetries.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {Number.isFinite(m.retriesPerRecovery)
                      ? m.retriesPerRecovery.toFixed(2)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {m.nudges.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {m.meanDaysToRecovery.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Why the oracle is here">
          <p className="text-sm leading-relaxed text-slate-700">
            A bare recovery rate invites the question &ldquo;out of
            what?&rdquo;. {formatRupees(b3.unrecoverablePaise)} of this ledger —{" "}
            {((b3.unrecoverablePaise / b3.atRiskPaise) * 100).toFixed(0)}% — is
            structurally unrecoverable: expired mandates, debits above the
            authorised cap, revocations, risk blocks. For those rows the
            probability of success is identically zero at every offset, for
            every policy, forever.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            B4 sees every latent variable and takes the best action available.
            It is a <strong>greedy</strong> oracle, not a proven optimum — a
            very strong upper bound rather than a mathematical one. Calling it
            optimal would be an overclaim.
          </p>
        </Card>

        <Card title="Setup">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Population</dt>
              <dd className="tabular-nums">
                {report.customers.toLocaleString("en-IN")} customers
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Ledger</dt>
              <dd className="tabular-nums">
                {b3.rowsTotal.toLocaleString("en-IN")} rows,{" "}
                {formatRupees(b3.atRiskPaise)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Training seed</dt>
              <dd className="font-mono text-xs">{report.trainSeed}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Evaluation seed</dt>
              <dd className="font-mono text-xs">{report.testSeed}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Classifier accuracy</dt>
              <dd className="tabular-nums">
                {(report.classifierAccuracy * 100).toFixed(1)}%
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Elapsed</dt>
              <dd className="tabular-nums">{report.elapsedMs}ms</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
            The timing estimator is fitted on a population from a different
            seed than the one scored here, and the harness refuses to run if
            they ever match. Simulator parameters were frozen and committed
            before the policy engine was written.
          </p>
        </Card>
      </div>

      <Card title="Stated limitation">
        <p className="text-sm leading-relaxed text-slate-700">
          The simulator&rsquo;s response model is authored by me, so this
          benchmark measures policy quality against a stated model of the world,
          not against production reality. The parameters were frozen and
          committed before the policy engine existed — verify with{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
            git log --follow -- src/core/simulator/params.ts
          </code>
          . What is real: the Razorpay reason codes, the RBI e-mandate
          constraints, and the network dispute codes.
        </p>
      </Card>
    </div>
  );
}
