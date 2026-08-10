import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isStaffViewer } from "@/lib/ops/pageGate";
import { readCaseRows, readOpenCount, readCorrectionRatePercent } from "@/lib/ops/serverReads";
import { buildCommunityTiles } from "@/lib/ops/dashboardTiles";
import { bucketCasesByQueue, COMMUNITY_QUEUES } from "@/lib/ops/queues";
import { OpsDashboard } from "@/components/ops/OpsDashboard";
import { QueueSummary } from "@/components/ops/QueueSummary";
import { CaseBoard } from "@/components/ops/CaseBoard";
import { ModerationQueue } from "@/components/community/ModerationQueue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Social / Community Manager",
  description: "Community moderation queue and community cases with their service levels.",
  path: "/ops/community",
  noIndex: true
});

export default async function CommunityOpsPage() {
  const staff = await isStaffViewer();
  if (!staff) {
    return (
      <main id="main" className="container">
        <div className="page-heading">
          <span className="section-kicker">Operations</span>
          <h1>Social / Community Manager</h1>
        </div>
        <div className="notice">Staff access required.</div>
      </main>
    );
  }

  const client = getSupabaseServerClient();
  const { rows } = await readCaseRows(client, "community");
  const moderationBacklog = await readOpenCount(client, "op_content_reports", "status");
  const correctionRate = await readCorrectionRatePercent(client);

  // The full named community metric set. Backlog and correction rate are
  // computed; the rest are named with their target and render "—" until wired.
  const tiles = buildCommunityTiles({
    moderationBacklog,
    correctionRatePercent: correctionRate,
    unsupportedClaimRatePercent: null,
    organicGrowthPercent: null
  });

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Operations</span>
        <h1>Social / Community Manager</h1>
        <p>Moderation and community cases. Community growth is measured on organic accounts only — demo and staff never count.</p>
      </div>
      <OpsDashboard title="Community operations" tiles={tiles} />
      <QueueSummary title="Queues" queues={bucketCasesByQueue(rows, COMMUNITY_QUEUES)} />

      <section className="panel" aria-label="Moderation queue">
        <h2>Moderation queue</h2>
        <ModerationQueue />
      </section>

      <section className="panel" aria-label="Community cases">
        <h2>Community cases</h2>
        <CaseBoard workspace="community" />
      </section>
    </main>
  );
}
