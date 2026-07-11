import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";

export type DecisionSupabaseLiveMcpProofArtifact = {
  projectRef: string;
  projectUrl: string;
  source: string;
  verifiedAt: string;
  opTableCount: number;
  rlsEnabledCount: number;
  allRlsEnabled: boolean;
  publicClientGrants: string;
  serverGrant: string;
  tables: string[];
};

export type DecisionSupabaseLiveMcpProofArtifactRead = {
  path: string;
  exists: boolean;
  valid: boolean;
  artifact: DecisionSupabaseLiveMcpProofArtifact | null;
  error: string | null;
};

export const DECISION_SUPABASE_LIVE_MCP_PROOF_ARTIFACT = join("artifacts", "supabase", "odds-padi-live-op-schema-proof.json");

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseArtifact(value: unknown): DecisionSupabaseLiveMcpProofArtifact | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.projectRef !== ODDSPADI_SUPABASE_PROJECT_REF) return null;
  if (typeof record.projectUrl !== "string") return null;
  if (typeof record.source !== "string") return null;
  if (typeof record.verifiedAt !== "string") return null;
  if (typeof record.opTableCount !== "number") return null;
  if (typeof record.rlsEnabledCount !== "number") return null;
  if (typeof record.allRlsEnabled !== "boolean") return null;
  if (typeof record.publicClientGrants !== "string") return null;
  if (typeof record.serverGrant !== "string") return null;
  if (!isStringArray(record.tables)) return null;

  return {
    projectRef: record.projectRef,
    projectUrl: record.projectUrl,
    source: record.source,
    verifiedAt: record.verifiedAt,
    opTableCount: record.opTableCount,
    rlsEnabledCount: record.rlsEnabledCount,
    allRlsEnabled: record.allRlsEnabled,
    publicClientGrants: record.publicClientGrants,
    serverGrant: record.serverGrant,
    tables: record.tables
  };
}

export function readDecisionSupabaseLiveMcpProofArtifact(workspaceRoot = process.cwd()): DecisionSupabaseLiveMcpProofArtifactRead {
  const path = join(workspaceRoot, DECISION_SUPABASE_LIVE_MCP_PROOF_ARTIFACT);
  if (!existsSync(path)) {
    return { path, exists: false, valid: false, artifact: null, error: null };
  }

  try {
    const artifact = parseArtifact(JSON.parse(readFileSync(path, "utf8")));
    return {
      path,
      exists: true,
      valid: Boolean(artifact),
      artifact,
      error: artifact ? null : "Proof artifact did not match the expected OddsPadi MCP schema receipt shape."
    };
  } catch (error) {
    return {
      path,
      exists: true,
      valid: false,
      artifact: null,
      error: error instanceof Error ? error.message : "Failed to read proof artifact."
    };
  }
}
