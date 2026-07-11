import { apiSuccess } from "@/app/api/sports/_utils";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSupabaseLiveSchemaActivationPacket } from "@/lib/sports/prediction/decisionSupabaseLiveSchemaActivationPacket";
import { readDecisionSupabaseLiveMcpProofArtifact } from "@/lib/sports/prediction/decisionSupabaseLiveMcpProofArtifact";
import { buildDecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import { buildDecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { buildDecisionSupabaseSchemaManifest } from "@/lib/sports/prediction/decisionSupabaseSchemaManifest";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await verifyDecisionEngineReadiness();
  const artifact = readDecisionSupabaseLiveMcpProofArtifact();
  const isolation = buildDecisionSupabaseProjectIsolation({
    readiness,
    observedMcpProjectUrl: artifact.artifact?.projectUrl ?? null,
    observedMcpTables: artifact.artifact?.tables
  });
  const binder = buildDecisionSupabaseProofBinder({ readiness, isolation });
  const manifest = buildDecisionSupabaseSchemaManifest({ readiness, isolation, binder });

  return apiSuccess(buildDecisionSupabaseLiveSchemaActivationPacket({ readiness, isolation, binder, manifest }));
}
