import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isStaffViewer } from "@/lib/ops/pageGate";
import { readCaseRows, readOpenCount } from "@/lib/ops/serverReads";
import { openCasesBySeverity } from "@/lib/ops/dashboardMetrics";
import { buildMarketTiles } from "@/lib/ops/dashboardTiles";
import { bucketCasesByQueue, MARKET_QUEUES } from "@/lib/ops/queues";
import { OpsDashboard } from "@/components/ops/OpsDashboard";
import { QueueSummary } from "@/components/ops/QueueSummary";
import { CaseBoard } from "@/components/ops/CaseBoard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Market Ops Analyst",
  description: "Settlement, closing-price and reconciliation cases with their service levels.",
  path: "/ops/market",
  noIndex: true
});

export default async function MarketOpsPage() {
  const staff = await isStaffViewer();
  if (!staff) {
    return (
      <main id="main" className="container">
        <div className="page-heading">
          <span className="section-kicker">Operations</span>
          <h1>Market Ops Analyst</h1>
        </div>
        <div className="notice">Staff access required.</div>
      </main>
    );
  }

  const client = getSupabaseServerClient();
  const { rows } = await readCaseRows(client, "market_ops");
  const reconciliationErrors = await readOpenCount(client, "op_settlement_exceptions", "state", "reconciler_");
  const open = openCasesBySeverity(rows);

  // The full named operations metric set. Cases + reconciliation errors are
  // computed; the rest are named with their target and render "—" until wired.
  const tiles = buildMarketTiles({
    openCritical: open.critical,
    reconciliationErrorsOpen: reconciliationErrors,
    reconciliationComplete: reconciliationErrors === null ? null : reconciliationErrors === 0,
    directDatabaseEdits: null
  });

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Operations</span>
        <h1>Market Ops Analyst</h1>
        <p>
          Settlement, closing-price and reconciliation cases. Win rate is not a metric on this page —{" "}
          <Link href="/track-record">the model track record</Link> is separate and never an operations KPI.
        </p>
      </div>
      <OpsDashboard title="Market operations" tiles={tiles} />
      <QueueSummary title="Queues" queues={bucketCasesByQueue(rows, MARKET_QUEUES)} />
      <CaseBoard workspace="market_ops" />
    </main>
  );
}
