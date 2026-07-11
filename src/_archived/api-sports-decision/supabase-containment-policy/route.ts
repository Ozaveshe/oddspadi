import { apiSuccess } from "@/app/api/sports/_utils";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSupabaseContainmentPolicy } from "@/lib/sports/prediction/decisionSupabaseContainmentPolicy";
import { readDecisionSupabaseLiveMcpProofArtifact } from "@/lib/sports/prediction/decisionSupabaseLiveMcpProofArtifact";
import { buildDecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import { buildDecisionSupabaseProjectIsolation, parseObservedMcpTableList } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { buildDecisionSupabaseSchemaManifest } from "@/lib/sports/prediction/decisionSupabaseSchemaManifest";

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
  const manifest = buildDecisionSupabaseSchemaManifest({ readiness, isolation, binder });

  return apiSuccess(buildDecisionSupabaseContainmentPolicy({ isolation, binder, manifest }));
}
