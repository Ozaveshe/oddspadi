import { apiSuccess } from "@/app/api/sports/_utils";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSupabaseMcpObservationReceipt } from "@/lib/sports/prediction/decisionSupabaseMcpObservationReceipt";
import { readDecisionSupabaseLiveMcpProofArtifact } from "@/lib/sports/prediction/decisionSupabaseLiveMcpProofArtifact";
import { buildDecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import { buildDecisionSupabaseProjectIsolation, parseObservedMcpTableList } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const readiness = await verifyDecisionEngineReadiness();
  const url = new URL(request.url);
  const artifact = readDecisionSupabaseLiveMcpProofArtifact();
  const observedMcpTables = parseObservedMcpTableList(url.searchParams.get("observedMcpTables"));
  const isolation = buildDecisionSupabaseProjectIsolation({
    readiness,
    observedMcpProjectUrl: url.searchParams.get("observedMcpProjectUrl") ?? artifact.artifact?.projectUrl ?? null,
    observedMcpTables: observedMcpTables.length ? observedMcpTables : artifact.artifact?.tables
  });
  const binder = buildDecisionSupabaseProofBinder({ readiness, isolation });

  return apiSuccess(buildDecisionSupabaseMcpObservationReceipt({ isolation, binder }));
}

export async function POST(request: Request) {
  const readiness = await verifyDecisionEngineReadiness();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const isolation = buildDecisionSupabaseProjectIsolation({
    readiness,
    observedMcpProjectUrl: typeof body.observedMcpProjectUrl === "string" ? body.observedMcpProjectUrl : null,
    observedMcpTables: parseObservedMcpTableList(body.observedMcpTables ?? body.tables ?? body)
  });
  const binder = buildDecisionSupabaseProofBinder({ readiness, isolation });

  return apiSuccess(buildDecisionSupabaseMcpObservationReceipt({ isolation, binder }));
}
