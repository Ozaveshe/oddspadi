import { previewStoredHistoricalRuntimeReplay } from "../src/lib/sports/training/trainingRepository";
import { getSupabaseRuntimeStatus } from "../src/lib/supabase/server";

const supportedSports = ["football", "basketball", "tennis"] as const;
type SupportedSport = (typeof supportedSports)[number];

function requestedSports(): SupportedSport[] {
  const argument = process.argv.find((value) => value.startsWith("--sport="))?.split("=")[1]?.trim() ?? "all";
  if (argument === "all") return [...supportedSports];
  const sports = argument.split(",").map((value) => value.trim());
  if (!sports.length || sports.some((value) => !supportedSports.includes(value as SupportedSport))) {
    throw new Error("--sport must be football, basketball, tennis, a comma-separated subset, or all");
  }
  return sports as SupportedSport[];
}

function limit(): number {
  const argument = process.argv.find((value) => value.startsWith("--limit="))?.split("=")[1];
  const parsed = Number(argument ?? 50_000);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50_000) throw new Error("--limit must be an integer from 1 to 50000");
  return parsed;
}

async function main(): Promise<void> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    const credentialProject = runtime.serverKeyProfile.legacyJwtProjectRef;
    throw new Error(
      credentialProject && credentialProject !== runtime.expectedProjectRef
        ? `Refusing corpus access: configured server credential targets ${credentialProject}, expected OddsPadi ${runtime.expectedProjectRef}.`
        : `Protected corpus access is unavailable: ${runtime.missingServerEnv.join(", ")}.`
    );
  }
  for (const sport of requestedSports()) {
    const result = await previewStoredHistoricalRuntimeReplay({ sport, limit: limit() });
    if ("error" in result) {
      console.log(JSON.stringify({ sport, status: "failed", error: result.error }));
      process.exitCode = 1;
      continue;
    }

    console.log(JSON.stringify({
      sport,
      status: result.status,
      sampleSize: result.sampleSize,
      trainSize: result.trainSize,
      testSize: result.testSize,
      pickCount: result.pickCount,
      roiUnits: result.roiUnits,
      yield: result.yield,
      brierScore: result.brierScore,
      calibrationError: result.calibrationError,
      minimumEdge: result.learnedWeights.minimumEdge,
      selectionPolicy: "selectionPolicy" in result ? result.selectionPolicy : null,
      economicSelectionComparison: "economicSelectionComparison" in result ? result.economicSelectionComparison : null,
      probabilityCalibrationPolicy: "probabilityCalibrationPolicy" in result ? result.probabilityCalibrationPolicy : null,
      probabilityCalibrationComparison: "probabilityCalibrationComparison" in result ? result.probabilityCalibrationComparison : null,
      marketPriorEvidence: "marketPriorEvidence" in result ? result.marketPriorEvidence : null
    }));
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
