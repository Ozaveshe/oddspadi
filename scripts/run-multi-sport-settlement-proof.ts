import { runDecisionAutonomousCycle } from "../src/lib/sports/prediction/decisionAutonomousCycle";
import { runDecisionAutonomousSettlement } from "../src/lib/sports/prediction/decisionAutonomousSettlement";
import { getPredictions } from "../src/lib/sports/service";
import { buildMultiSportLiveFeatureMaterializer, type LiveTrainingSport } from "../src/lib/sports/training/multiSportLiveFeatureMaterializer";
import { observeMultiSportLiveFeatureStorageReceipt } from "../src/lib/sports/training/multiSportLiveFeatureStorageReceipt";
import { buildMultiSportLiveSettlementLabelReceipt } from "../src/lib/sports/training/multiSportLiveSettlementLabelReceipt";

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function bounded(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(8, parsed)) : fallback;
}

function sportOption(): LiveTrainingSport {
  const sport = option("--sport") ?? "basketball";
  if (sport !== "basketball" && sport !== "tennis") throw new Error("--sport must be basketball or tennis");
  return sport;
}

async function main() {
  const sport = sportOption();
  const date = option("--date") ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const limit = bounded(option("--limit"), 2);
  const runRequested = process.argv.includes("--run");
  const adminAuthorized = runRequested && Boolean(process.env.ODDSPADI_ADMIN_TOKEN?.trim());
  if (runRequested && !adminAuthorized) throw new Error("--run requires ODDSPADI_ADMIN_TOKEN in the process environment");

  const rows = (await getPredictions({ date, sport })).slice(0, limit);
  const provider = rows.find((row) => row.match.dataSource?.kind === "provider")?.match.dataSource?.fixtureProvider ?? "provider";
  const materializer = buildMultiSportLiveFeatureMaterializer({ provider, sport, rows, targetDate: date });
  const featureStorage = await observeMultiSportLiveFeatureStorageReceipt({
    materializer,
    runRequested,
    adminAuthorized,
    env: process.env,
    origin: "http://127.0.0.1:3025"
  });
  const cycle = await runDecisionAutonomousCycle({
    date,
    sport,
    runRequested,
    adminAuthorized,
    runAi: false,
    persist: runRequested,
    fixtureLimit: limit,
    aiReviewLimit: 0
  });
  const outcomes = await runDecisionAutonomousSettlement({
    sport,
    runRequested,
    adminAuthorized,
    limit: 100,
    env: process.env
  });
  const featureLabels = await buildMultiSportLiveSettlementLabelReceipt({
    sport,
    runRequested,
    adminAuthorized,
    limit: 100,
    env: process.env
  });

  console.log(
    JSON.stringify(
      {
        mode: "multi-sport-settlement-proof",
        sport,
        date,
        runRequested,
        providerFixtures: rows.length,
        finishedFixtures: rows.filter((row) => row.match.status === "finished").length,
        fixturesWithOdds: rows.filter((row) => row.match.oddsMarkets.length > 0).length,
        featureStorage: {
          status: featureStorage.status,
          eligible: featureStorage.materializer.providerBackedRows,
          skipped: featureStorage.materializer.ineligiblePendingRows,
          rowsInserted: featureStorage.storage.rowsInserted
        },
        decisionCycle: { status: cycle.status, counts: cycle.counts },
        outcomes: { status: outcomes.status, totals: outcomes.totals, calibration: outcomes.calibration },
        featureLabels: { status: featureLabels.status, totals: featureLabels.totals },
        locks: { canTrainModels: false, canApplyLearnedWeights: false, canPublishPicks: false, canStake: false }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
