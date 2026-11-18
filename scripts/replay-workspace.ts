import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { analyseWorkspace, type WorkspaceSnapshot } from "@/lib/workspace/analysis";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Supply a frozen OddsPadi Workspace JSON export.");
  const exported = JSON.parse(await readFile(file, "utf8"));
  const snapshot: WorkspaceSnapshot | undefined = exported.workspace?.snapshot;
  if (exported.format !== "oddspadi-workspace-export-v1" || !snapshot) throw new Error("Expected a frozen Workspace export.");
  if (snapshot.analysisVersion !== "workspace-analysis-v1") throw new Error("Unversioned or unsupported snapshot. Exact replay unavailable.");
  const at = Date.parse(snapshot.takenAt);
  if (!Number.isFinite(at) || !Array.isArray(snapshot.analysis?.legs)) throw new Error("Invalid frozen analysis.");
  const selections = snapshot.analysis.legs.map(leg => leg.selection);
  const replay = analyseWorkspace(selections, at);
  // Match the representation persisted by the JSON export, including absent optional fields.
  const matches = isDeepStrictEqual(JSON.parse(JSON.stringify(replay)), snapshot.analysis);
  console.log(JSON.stringify({ matches, selections: selections.length,
    withModelVersion: selections.filter(leg => leg.evidence?.modelVersion).length,
    withEvidenceHash: selections.filter(leg => leg.evidence?.evidenceHash).length }));
  if (!matches) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
