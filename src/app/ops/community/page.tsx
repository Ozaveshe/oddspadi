import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isStaffViewer } from "@/lib/ops/pageGate";
import { readCaseRows, readOpenCount } from "@/lib/ops/serverReads";
import { openCasesBySeverity } from "@/lib/ops/dashboardMetrics";
import { bucketCasesByQueue, COMMUNITY_QUEUES } from "@/lib/ops/queues";
import { classifyMetric } from "@/lib/observability/metrics";
import { OpsDashboard, type DashboardTile } from "@/components/ops/OpsDashboard";
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
  const open = openCasesBySeverity(rows);

  const tiles: DashboardTile[] = [
    { label: "Moderation backlog", value: moderationBacklog, status: classifyMetric("moderation_backlog", moderationBacklog) },
    { label: "Open community cases · critical", value: open.critical },
    { label: "Open community cases · warning", value: open.warning },
    { label: "Open community cases · info", value: open.info }
  ];

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
