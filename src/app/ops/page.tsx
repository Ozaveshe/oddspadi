import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isStaffViewer } from "@/lib/ops/pageGate";
import { readCaseRows, readOpenCount } from "@/lib/ops/serverReads";
import { buildHandover } from "@/lib/ops/handover";
import { isTrainingMode } from "@/lib/ops/trainingMode";
import { DailyHandover } from "@/components/ops/DailyHandover";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Operations",
  description: "OddsPadi staff operations workspace — daily handover, cases and service levels.",
  path: "/ops",
  noIndex: true
});

export default async function OpsHomePage() {
  const staff = await isStaffViewer();
  if (!staff) {
    return (
      <main id="main" className="container">
        <div className="page-heading">
          <span className="section-kicker">Operations</span>
          <h1>Staff workspace</h1>
        </div>
        <div className="notice">Staff access required.</div>
      </main>
    );
  }

  const client = getSupabaseServerClient();
  const { rows, couldNotRead } = await readCaseRows(client);
  const moderationBacklog = await readOpenCount(client, "op_content_reports", "status");
  const handover = buildHandover({ cases: rows, couldNotRead, signals: { moderationBacklog } }, new Date());
  const training = isTrainingMode(process.env);

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Operations</span>
        <h1>Staff workspace</h1>
        <p>Cases, service levels and the daily handover. Every action is audited; nothing here rewrites an immutable record.</p>
      </div>

      {training ? (
        <p className="notice" role="status">
          Training mode is on — actions preview only and never touch production.
        </p>
      ) : null}

      <DailyHandover handover={handover} />

      <nav className="panel" aria-label="Workspaces">
        <h2>Workspaces</h2>
        <ul>
          <li>
            <Link href="/ops/market">Market Ops Analyst</Link> — settlement, closing prices, reconciliation cases.
          </li>
          <li>
            <Link href="/ops/community">Social / Community Manager</Link> — moderation queue and community cases.
          </li>
        </ul>
      </nav>
    </main>
  );
}
