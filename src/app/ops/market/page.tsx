import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isStaffViewer } from "@/lib/ops/pageGate";
import { readCaseRows, readOpenCount } from "@/lib/ops/serverReads";
import { openCasesBySeverity, slaCompliancePercent } from "@/lib/ops/dashboardMetrics";
import { classifyMetric } from "@/lib/observability/metrics";
import { OpsDashboard, type DashboardTile } from "@/components/ops/OpsDashboard";
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
  const compliance = slaCompliancePercent(rows, new Date());

  const tiles: DashboardTile[] = [
    { label: "Open · critical", value: open.critical },
    { label: "Open · warning", value: open.warning },
    { label: "Open · info", value: open.info },
    { label: "Resolved in SLA", value: compliance === null ? null : Math.round(compliance), unit: "%" },
    {
      label: "Open reconciliation errors",
      value: reconciliationErrors,
      status: classifyMetric("reconciliation_errors", reconciliationErrors),
      target: 0
    },
    // No cheap source for out-of-band edits; shown as unknown, target zero.
    { label: "Direct database edits", value: null, status: "unknown", target: 0 }
  ];

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
      <CaseBoard workspace="market_ops" />
    </main>
  );
}
