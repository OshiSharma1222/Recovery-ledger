import { getReplay, getReport, normalizeSeed } from "@/lib/data";
import { WorldControl } from "@/components/world-control";
import { Eyebrow, PageTitle } from "@/components/ui";
import { ReplayPlayer } from "@/components/replay";

export default async function ReplayPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string }>;
}) {
  const seed = normalizeSeed((await searchParams).seed);
  const data = getReplay(seed);
  const report = getReport(seed);

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>
          {data.horizon} days, replayed{seed ? ` · world "${seed}"` : ""}
        </Eyebrow>
        <PageTitle>Watch it work</PageTitle>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-sub">
          A race. The same{" "}
          {data.policies[0]!.rows.length.toLocaleString("en-IN")} failed
          payments are given to two systems. Grey is the usual way: retry
          everything on a schedule. Green is this project: understand each
          failure, act once and well, and give up on the hopeless ones. Press
          play and watch the money come back.
        </p>
      </div>
      <WorldControl
        seed={seed}
        elapsedMs={report.elapsedMs}
        customers={report.customers}
        rows={data.policies[0]!.rows.length}
      />
      <ReplayPlayer data={data} />
    </div>
  );
}
