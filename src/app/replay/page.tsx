import { getReplay, normalizeSeed } from "@/lib/data";
import { Eyebrow, PageTitle } from "@/components/ui";
import { ReplayPlayer } from "@/components/replay";

export default async function ReplayPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string }>;
}) {
  const seed = normalizeSeed((await searchParams).seed);
  const data = getReplay(seed);

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>
          {data.horizon} days, replayed{seed ? ` · world "${seed}"` : ""}
        </Eyebrow>
        <PageTitle>Watch it work</PageTitle>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-sub">
          The same {data.policies[0]!.rows.length.toLocaleString("en-IN")} failed
          debits, resolved day by day under two policies. The fixed schedule
          retries everything blindly. The ledger classifies, times its retries,
          and walks away from rows it cannot win.
        </p>
      </div>
      <ReplayPlayer data={data} />
    </div>
  );
}
