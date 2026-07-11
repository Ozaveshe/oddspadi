import type { DecisionHistoricalDisciplineReceipt } from "@/lib/sports/prediction/decisionHistoricalDisciplineReceipt";
import type { DecisionProviderDryRunObservationLedger } from "@/lib/sports/prediction/decisionProviderDryRunObservationLedger";
import type { DecisionProviderSubscriptionPlanner } from "@/lib/sports/prediction/decisionProviderSubscriptionPlanner";
import type { Sport } from "@/lib/sports/types";

export type DecisionProviderEnrichedRetestReadinessStatus =
  | "ready-provider-retest-dry-run"
  | "paid-provider-propagating"
  | "odds-plan-blocked"
  | "football-plan-blocked"
  | "fixture-proof-waiting"
  | "provider-rate-limited"
  | "provider-proof-waiting"
  | "historical-proof-blocked";

export type DecisionProviderEnrichedRetestReadiness = {
  mode: "provider-enriched-retest-readiness";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionProviderEnrichedRetestReadinessStatus;
  readinessHash: string;
  summary: string;
  chain: {
    historicalDiscipline: {
      status: DecisionHistoricalDisciplineReceipt["status"];
      publicHistoryStatus: DecisionHistoricalDisciplineReceipt["chain"]["publicHistory"]["status"];
      fixtures: number;
      oddsRows: number;
      benchmarkVerdict: DecisionHistoricalDisciplineReceipt["chain"]["publicHistory"]["benchmarkVerdict"];
      marketPriorAction: DecisionHistoricalDisciplineReceipt["chain"]["marketPrior"]["action"];
    };
    providerDryRun: {
      status: DecisionProviderDryRunObservationLedger["status"];
      rows: Array<{
        id: DecisionProviderDryRunObservationLedger["rows"][number]["id"];
        status: DecisionProviderDryRunObservationLedger["rows"][number]["status"];
        normalizedRows: number;
        nextAction: string;
      }>;
    };
    subscriptions: {
      status: DecisionProviderSubscriptionPlanner["status"];
      apiFootballPlan: DecisionProviderSubscriptionPlanner["selectedPlans"]["apiFootball"];
      oddsApiPlan: DecisionProviderSubscriptionPlanner["selectedPlans"]["oddsApi"];
      nextOperation: DecisionProviderSubscriptionPlanner["nextOperation"];
    };
  };
  gates: Array<{
    id: "history" | "api-football-plan" | "odds-plan" | "fixture-proof" | "odds-proof" | "side-effects";
    status: "pass" | "watch" | "block";
    label: string;
    evidence: string;
    proofUrl: string;
  }>;
  nextAction: {
    label: string;
    proofUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderRetestDryRun: boolean;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canPersistBacktestRun: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
  locks: string[];
};

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function statusFor({
  historicalDiscipline,
  providerDryRunObservationLedger,
  providerSubscriptionPlanner
}: {
  historicalDiscipline: DecisionHistoricalDisciplineReceipt;
  providerDryRunObservationLedger: DecisionProviderDryRunObservationLedger;
  providerSubscriptionPlanner: DecisionProviderSubscriptionPlanner;
}): DecisionProviderEnrichedRetestReadinessStatus {
  const apiFootballReady =
    providerSubscriptionPlanner.selectedPlans.apiFootball.configured &&
    providerSubscriptionPlanner.selectedPlans.apiFootball.id !== "free";
  const oddsReady =
    providerSubscriptionPlanner.selectedPlans.oddsApi.configured &&
    providerSubscriptionPlanner.selectedPlans.oddsApi.id !== "free" &&
    providerSubscriptionPlanner.selectedPlans.oddsApi.id !== "20k";
  const paidPlanButProviderNotCaughtUp =
    (providerDryRunObservationLedger.status === "odds-plan-blocked" && oddsReady) ||
    (providerDryRunObservationLedger.status === "provider-rate-limited" && (apiFootballReady || oddsReady)) ||
    providerDryRunObservationLedger.rows.some((row) => row.status === "rate-limited");

  if (historicalDiscipline.status === "waiting-history" || historicalDiscipline.status === "unsafe") return "historical-proof-blocked";
  if (providerSubscriptionPlanner.status === "waiting-football-plan") return "football-plan-blocked";
  if (paidPlanButProviderNotCaughtUp) return "paid-provider-propagating";
  if (providerSubscriptionPlanner.status === "waiting-paid-odds" || providerDryRunObservationLedger.status === "odds-plan-blocked") return "odds-plan-blocked";
  if (providerDryRunObservationLedger.status === "provider-rate-limited") return "provider-rate-limited";
  if (providerDryRunObservationLedger.status === "fixtures-not-listed-yet") return "fixture-proof-waiting";
  if (providerDryRunObservationLedger.status !== "proof-ready") return "provider-proof-waiting";
  if (providerSubscriptionPlanner.status !== "ready-controlled-dry-runs") return "provider-proof-waiting";
  return "ready-provider-retest-dry-run";
}

function summaryFor(status: DecisionProviderEnrichedRetestReadinessStatus): string {
  if (status === "ready-provider-retest-dry-run") return "Provider-enriched retest is ready for a read-only dry-run; writes, training, publishing, and staking remain locked.";
  if (status === "paid-provider-propagating") return "Paid provider setup appears to be propagating or rate-limited; wait before rerunning dry-run proof.";
  if (status === "odds-plan-blocked") return "Provider-enriched retest is blocked by The Odds API plan/entitlement for historical odds and market-prior proof.";
  if (status === "football-plan-blocked") return "Provider-enriched retest is blocked by API-Football plan/key readiness for fixture and context proof.";
  if (status === "fixture-proof-waiting") return "Provider-enriched retest is waiting for API-Football to return normalized EPL 2026/27 fixture proof.";
  if (status === "provider-rate-limited") return "Provider-enriched retest is waiting on provider rate-limit or quota backoff before proof can advance.";
  if (status === "historical-proof-blocked") return "Provider-enriched retest is blocked until historical discipline proves how market prior should govern the model.";
  return "Provider-enriched retest is waiting for provider dry-run proof before any storage or training step can proceed.";
}

function nextActionFor(
  status: DecisionProviderEnrichedRetestReadinessStatus,
  providerDryRunObservationLedger: DecisionProviderDryRunObservationLedger,
  providerSubscriptionPlanner: DecisionProviderSubscriptionPlanner
): DecisionProviderEnrichedRetestReadiness["nextAction"] {
  if (status === "odds-plan-blocked") {
    return {
      label: "Upgrade The Odds API and rerun odds dry-run",
      proofUrl: "/api/sports/decision/provider-dry-run-observation-ledger?run=1",
      expectedEvidence: "The Odds API returns normalized historical EPL odds rows in dry-run mode, with no odds snapshot writes."
    };
  }
  if (status === "paid-provider-propagating") {
    return {
      label: "Wait for paid provider activation and rerun one dry-run",
      proofUrl: "/api/sports/decision/provider-dry-run-observation-ledger?run=1",
      expectedEvidence: "The same saved provider keys return verified fixture and odds rows after subscription propagation or quota reset, with write/train/publish controls still false."
    };
  }
  if (status === "football-plan-blocked") {
    return {
      label: "Upgrade API-Football and rerun fixture dry-run",
      proofUrl: "/api/sports/decision/provider-dry-run-observation-ledger?run=1",
      expectedEvidence: "API-Football returns normalized league 39 season 2026 fixture rows in dry-run mode."
    };
  }
  if (status === "fixture-proof-waiting") {
    return {
      label: "Retry EPL fixture provider proof",
      proofUrl: "/api/sports/decision/provider-dry-run-observation-ledger?run=1",
      expectedEvidence: providerDryRunObservationLedger.nextAction.expectedEvidence
    };
  }
  if (status === "provider-rate-limited") {
    return {
      label: "Wait for provider backoff and rerun proof",
      proofUrl: "/api/sports/decision/provider-dry-run-observation-ledger?run=1",
      expectedEvidence: "Provider dry-run returns verified normalized rows after quota/backoff reset."
    };
  }
  if (status === "historical-proof-blocked") {
    return {
      label: "Run public historical discipline proof",
      proofUrl: "/api/sports/decision/historical-discipline?historical=1&publicHistory=1",
      expectedEvidence: "Historical discipline receipt proves whether market prior caps or provider-enriched retest can proceed."
    };
  }
  if (status === "ready-provider-retest-dry-run") {
    return {
      label: "Run provider-enriched retest dry-run",
      proofUrl: providerSubscriptionPlanner.nextOperation?.verifyUrl ?? "/api/sports/decision/training/football-data-provider-retest-runner",
      expectedEvidence: "Provider-enriched retest reports fixture identity, odds snapshots, feature rows, benchmark comparison, and locked side effects."
    };
  }
  return {
    label: providerDryRunObservationLedger.nextAction.label,
    proofUrl: providerDryRunObservationLedger.nextAction.proofUrl,
    expectedEvidence: providerDryRunObservationLedger.nextAction.expectedEvidence
  };
}

function gate(
  input: DecisionProviderEnrichedRetestReadiness["gates"][number]
): DecisionProviderEnrichedRetestReadiness["gates"][number] {
  return input;
}

export function buildDecisionProviderEnrichedRetestReadiness({
  date,
  sport,
  historicalDiscipline,
  providerDryRunObservationLedger,
  providerSubscriptionPlanner,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  historicalDiscipline: DecisionHistoricalDisciplineReceipt;
  providerDryRunObservationLedger: DecisionProviderDryRunObservationLedger;
  providerSubscriptionPlanner: DecisionProviderSubscriptionPlanner;
  now?: Date;
}): DecisionProviderEnrichedRetestReadiness {
  const status = statusFor({ historicalDiscipline, providerDryRunObservationLedger, providerSubscriptionPlanner });
  const nextAction = nextActionFor(status, providerDryRunObservationLedger, providerSubscriptionPlanner);
  const fixtureRow = providerDryRunObservationLedger.rows.find((row) => row.id === "football-fixtures") ?? null;
  const oddsRow = providerDryRunObservationLedger.rows.find((row) => row.id === "odds-markets") ?? null;
  const apiFootballReady =
    providerSubscriptionPlanner.selectedPlans.apiFootball.configured &&
    providerSubscriptionPlanner.selectedPlans.apiFootball.id !== "free";
  const oddsReady =
    providerSubscriptionPlanner.selectedPlans.oddsApi.configured &&
    providerSubscriptionPlanner.selectedPlans.oddsApi.id !== "free" &&
    providerSubscriptionPlanner.selectedPlans.oddsApi.id !== "20k";
  const gates = [
    gate({
      id: "history",
      label: "Historical market discipline",
      status:
        historicalDiscipline.status === "market-prior-enforced" || historicalDiscipline.status === "provider-retest-ready" || historicalDiscipline.status === "history-diagnostic-only"
          ? "pass"
          : "block",
      evidence: `${historicalDiscipline.status}; ${historicalDiscipline.chain.publicHistory.fixtures} fixtures; benchmark ${historicalDiscipline.chain.publicHistory.benchmarkVerdict ?? "pending"}.`,
      proofUrl: "/api/sports/decision/historical-discipline?historical=1&publicHistory=1"
    }),
    gate({
      id: "api-football-plan",
      label: "API-Football plan and key",
      status: apiFootballReady ? "pass" : "block",
      evidence: `${providerSubscriptionPlanner.selectedPlans.apiFootball.label}; configured=${providerSubscriptionPlanner.selectedPlans.apiFootball.configured}.`,
      proofUrl: "/api/sports/decision/provider-subscription-planner"
    }),
    gate({
      id: "odds-plan",
      label: "The Odds API historical plan",
      status: oddsReady ? "pass" : "block",
      evidence: `${providerSubscriptionPlanner.selectedPlans.oddsApi.label}; configured=${providerSubscriptionPlanner.selectedPlans.oddsApi.configured}; status ${providerSubscriptionPlanner.status}.`,
      proofUrl: "/api/sports/decision/provider-subscription-planner"
    }),
    gate({
      id: "fixture-proof",
      label: "Provider fixture proof",
      status:
        fixtureRow?.status === "verified"
          ? "pass"
          : fixtureRow?.status === "observed-zero" || fixtureRow?.status === "waiting" || fixtureRow?.status === "not-run" || fixtureRow?.status === "rate-limited"
            ? "watch"
            : "block",
      evidence: fixtureRow ? `${fixtureRow.status}; normalized ${fixtureRow.normalizedRows}; ${fixtureRow.nextAction}` : "No fixture dry-run row attached.",
      proofUrl: "/api/sports/decision/epl-provider-dry-run-receipt"
    }),
    gate({
      id: "odds-proof",
      label: "Provider odds proof",
      status:
        oddsRow?.status === "verified"
          ? "pass"
          : oddsRow?.status === "plan-blocked" || oddsRow?.status === "waiting" || oddsRow?.status === "not-run" || oddsRow?.status === "rate-limited"
            ? "watch"
            : "block",
      evidence: oddsRow ? `${oddsRow.status}; normalized ${oddsRow.normalizedRows}; ${oddsRow.nextAction}` : "No odds dry-run row attached.",
      proofUrl: "/api/sports/decision/epl-odds-dry-run-receipt"
    }),
    gate({
      id: "side-effects",
      label: "Side effects locked",
      status:
        !providerDryRunObservationLedger.controls.canWriteProviderRows &&
        !providerSubscriptionPlanner.controls.canWriteProviderRows &&
        !providerSubscriptionPlanner.controls.canTrainModels &&
        !providerSubscriptionPlanner.controls.canPublishPicks &&
        !providerSubscriptionPlanner.controls.canStake
          ? "pass"
          : "block",
      evidence: `providerWrites=${providerSubscriptionPlanner.controls.canWriteProviderRows}; train=${providerSubscriptionPlanner.controls.canTrainModels}; publish=${providerSubscriptionPlanner.controls.canPublishPicks}; stake=${providerSubscriptionPlanner.controls.canStake}.`,
      proofUrl: "/api/sports/decision/engine-activation-contract"
    })
  ];
  const chain: DecisionProviderEnrichedRetestReadiness["chain"] = {
    historicalDiscipline: {
      status: historicalDiscipline.status,
      publicHistoryStatus: historicalDiscipline.chain.publicHistory.status,
      fixtures: historicalDiscipline.chain.publicHistory.fixtures,
      oddsRows: historicalDiscipline.chain.publicHistory.oddsRows,
      benchmarkVerdict: historicalDiscipline.chain.publicHistory.benchmarkVerdict,
      marketPriorAction: historicalDiscipline.chain.marketPrior.action
    },
    providerDryRun: {
      status: providerDryRunObservationLedger.status,
      rows: providerDryRunObservationLedger.rows.map((row) => ({
        id: row.id,
        status: row.status,
        normalizedRows: row.normalizedRows,
        nextAction: row.nextAction
      }))
    },
    subscriptions: {
      status: providerSubscriptionPlanner.status,
      apiFootballPlan: providerSubscriptionPlanner.selectedPlans.apiFootball,
      oddsApiPlan: providerSubscriptionPlanner.selectedPlans.oddsApi,
      nextOperation: providerSubscriptionPlanner.nextOperation
    }
  };

  return {
    mode: "provider-enriched-retest-readiness",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    readinessHash: stableHash({
      date,
      sport,
      status,
      chain,
      gates: gates.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status),
    chain,
    gates,
    nextAction,
    controls: {
      canInspectReadOnly: true,
      canRunProviderRetestDryRun: status === "ready-provider-retest-dry-run",
      canWriteProviderRows: false,
      canPersistTrainingRows: false,
      canPersistBacktestRun: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: unique([
      "/api/sports/decision/provider-enriched-retest-readiness",
      "/api/sports/decision/historical-discipline",
      "/api/sports/decision/provider-dry-run-observation-ledger",
      "/api/sports/decision/provider-subscription-planner",
      nextAction.proofUrl,
      ...historicalDiscipline.proofUrls,
      ...providerDryRunObservationLedger.proofUrls,
      ...providerSubscriptionPlanner.proofUrls
    ]),
    locks: unique([
      "Provider-enriched retest readiness is read-only and cannot write provider rows, persist training rows, persist backtests, train models, apply learned weights, publish picks, or stake.",
      "Public-history market-prior dominance can only request provider-enriched retest; it cannot promote raw model edge.",
      "Paid provider plans only unlock dry-run proof until storage, provider identity, odds snapshots, feature rows, and promotion gates pass.",
      ...historicalDiscipline.locks,
      ...providerDryRunObservationLedger.locks,
      ...providerSubscriptionPlanner.locks
    ])
  };
}
