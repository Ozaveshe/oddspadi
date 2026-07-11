import type { DecisionDataBackbone } from "@/lib/sports/prediction/decisionDataBackbone";
import type { DecisionDataSourceCoverage, DecisionDataSourceCoverageCell } from "@/lib/sports/prediction/decisionDataSourceCoverage";
import type { DecisionEplFixtureIntake } from "@/lib/sports/prediction/decisionEplFixtureIntake";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionDataSignalCategory } from "@/lib/sports/types";

export type DecisionEplPreKickoffRehearsalStatus = "ready-read-only" | "needs-provider" | "needs-context" | "blocked-storage";
export type DecisionEplPreKickoffGateStatus = "pass" | "watch" | "block";

export type DecisionEplPreKickoffSignal = {
  category: DecisionDataSignalCategory;
  label: string;
  status: DecisionEplPreKickoffGateStatus;
  provider: string;
  storageTables: string[];
  nextAction: string;
};

export type DecisionEplPreKickoffGate = {
  id: string;
  label: string;
  status: DecisionEplPreKickoffGateStatus;
  detail: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionEplPreKickoffFixture = {
  id: string;
  date: string;
  kickoff: string | null;
  match: string;
  home: string;
  away: string;
  broadcaster: string | null;
  readinessScore: number;
  status: DecisionEplPreKickoffRehearsalStatus;
  gates: DecisionEplPreKickoffGate[];
  requiredSignals: DecisionEplPreKickoffSignal[];
  rehearsalQuestion: string;
  modelInstructions: string[];
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
};

export type DecisionEplPreKickoffRehearsal = {
  mode: "epl-pre-kickoff-rehearsal";
  generatedAt: string;
  date: string;
  status: DecisionEplPreKickoffRehearsalStatus;
  rehearsalHash: string;
  summary: string;
  season: DecisionEplFixtureIntake["season"];
  totals: {
    openingFixtures: number;
    daysUntilStart: number;
    readyReadOnly: number;
    needsProvider: number;
    needsContext: number;
    blockedStorage: number;
    requiredSignals: number;
    blockedSignals: number;
  };
  fixtures: DecisionEplPreKickoffFixture[];
  controls: {
    canInspectReadOnly: true;
    canRunFixtureDryRun: boolean;
    canRunOddsDryRun: boolean;
    canWriteFixtures: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canUpgradePublicAction: false;
  };
  locks: string[];
  proofUrls: string[];
};

const SIGNAL_ORDER: DecisionDataSignalCategory[] = [
  "fixtures",
  "odds",
  "standings",
  "home-away",
  "recent-form",
  "injuries",
  "suspensions",
  "lineups",
  "news",
  "weather",
  "live-scores",
  "match-events",
  "training"
];

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function scoreFor(status: DecisionEplPreKickoffGateStatus): number {
  if (status === "pass") return 100;
  if (status === "watch") return 55;
  return 0;
}

function signalStatus(cell: DecisionDataSourceCoverageCell | undefined): DecisionEplPreKickoffGateStatus {
  if (!cell || cell.status === "missing" || cell.status === "mock") return "block";
  if (cell.status === "computed") return "watch";
  return "pass";
}

function footballCells(coverage: DecisionDataSourceCoverage): DecisionDataSourceCoverageCell[] {
  return coverage.cells.filter((cell) => cell.sport === "football" && cell.requiredForLive);
}

function signalRows(coverage: DecisionDataSourceCoverage): DecisionEplPreKickoffSignal[] {
  const cells = footballCells(coverage);
  return SIGNAL_ORDER.map((category) => cells.find((cell) => cell.category === category))
    .filter((cell): cell is DecisionDataSourceCoverageCell => Boolean(cell))
    .map((cell) => ({
      category: cell.category,
      label: cell.label,
      status: signalStatus(cell),
      provider: cell.provider,
      storageTables: cell.storageTables,
      nextAction: cell.nextAction
    }));
}

function statusFor({
  dataBackbone,
  eplFixtureIntake,
  requiredSignals
}: {
  dataBackbone: DecisionDataBackbone;
  eplFixtureIntake: DecisionEplFixtureIntake;
  requiredSignals: DecisionEplPreKickoffSignal[];
}): DecisionEplPreKickoffRehearsalStatus {
  if (dataBackbone.status === "blocked-credentials" || dataBackbone.status === "blocked-cross-project" || dataBackbone.status === "needs-storage-proof") {
    return "blocked-storage";
  }
  if (eplFixtureIntake.status === "needs-provider") return "needs-provider";
  if (requiredSignals.some((signal) => signal.status === "block")) return "needs-context";
  return "ready-read-only";
}

function statusSummary(status: DecisionEplPreKickoffRehearsalStatus): string {
  if (status === "ready-read-only") return "EPL opening fixtures are ready for read-only rehearsal; writes, training, and public picks remain locked.";
  if (status === "needs-provider") return "EPL opening fixture rehearsal needs provider keys before fixture and odds dry-runs can run.";
  if (status === "needs-context") return "EPL opening fixture rehearsal needs context feeds before model trust can rise.";
  return "EPL opening fixture rehearsal is blocked until OddsPadi storage proof and credentials are fixed.";
}

function gate(input: DecisionEplPreKickoffGate): DecisionEplPreKickoffGate {
  return input;
}

function fixtureGates({
  eplFixtureIntake,
  dataBackbone,
  requiredSignals
}: {
  eplFixtureIntake: DecisionEplFixtureIntake;
  dataBackbone: DecisionDataBackbone;
  requiredSignals: DecisionEplPreKickoffSignal[];
}): DecisionEplPreKickoffGate[] {
  const providerGate = eplFixtureIntake.checks.find((check) => check.id === "provider-key");
  const oddsGate = eplFixtureIntake.checks.find((check) => check.id === "odds-linkage");
  const contextBlocks = requiredSignals.filter((signal) => signal.status === "block");
  const contextWatch = requiredSignals.filter((signal) => signal.status === "watch");
  const storageStatus: DecisionEplPreKickoffGateStatus = dataBackbone.totals.storageTablesLiveVerified >= dataBackbone.totals.storageTablesExpected ? "pass" : "block";
  const providerStatus: DecisionEplPreKickoffGateStatus = providerGate?.status === "pass" ? "pass" : "block";
  const oddsStatus: DecisionEplPreKickoffGateStatus = oddsGate?.status === "pass" ? "watch" : "block";
  const contextStatus: DecisionEplPreKickoffGateStatus = contextBlocks.length ? "block" : contextWatch.length ? "watch" : "pass";
  return [
    gate({
      id: "official-fixture",
      label: "Official fixture",
      status: "pass",
      detail: `${eplFixtureIntake.season.competition} ${eplFixtureIntake.season.season} fixture seed is released with ${eplFixtureIntake.season.totalFixtures} fixtures.`,
      nextAction: "Keep provider fixture IDs mapped to the official fixture seed.",
      proofUrl: "/api/sports/decision/epl-fixture-intake"
    }),
    gate({
      id: "provider-map",
      label: "Provider fixture map",
      status: providerStatus,
      detail: providerGate?.evidence.join("; ") ?? "Provider key evidence is missing.",
      nextAction: providerGate?.nextAction ?? "Configure and dry-run the football fixture provider.",
      proofUrl: "/api/sports/decision/epl-provider-dry-run-receipt"
    }),
    gate({
      id: "odds-map",
      label: "Bookmaker odds map",
      status: oddsStatus,
      detail: oddsGate?.evidence.join("; ") ?? "Odds provider evidence is missing.",
      nextAction: oddsGate?.nextAction ?? "Map fixture IDs to bookmaker event IDs before EV ranking.",
      proofUrl: "/api/sports/decision/odds-board"
    }),
    gate({
      id: "context-pack",
      label: "Context pack",
      status: contextStatus,
      detail: `${contextBlocks.length} required football signals blocked; ${contextWatch.length} are computed/proxy-backed.`,
      nextAction: contextBlocks[0]?.nextAction ?? contextWatch[0]?.nextAction ?? "Refresh lineups, availability, news, standings, weather, and training evidence before kickoff.",
      proofUrl: "/api/sports/decision/data-source-coverage"
    }),
    gate({
      id: "storage-lock",
      label: "Storage lock",
      status: storageStatus,
      detail: `${dataBackbone.totals.storageTablesLiveVerified}/${dataBackbone.totals.storageTablesExpected} storage tables live-verified.`,
      nextAction: dataBackbone.nextAction.expectedEvidence,
      proofUrl: "/api/sports/decision/data-backbone"
    })
  ];
}

function fixtureNextAction(gates: DecisionEplPreKickoffGate[]): DecisionEplPreKickoffFixture["nextAction"] {
  const next = gates.find((item) => item.status === "block") ?? gates.find((item) => item.status === "watch") ?? gates[0];
  const verifyUrl = next?.proofUrl ?? "/api/sports/decision/epl-pre-kickoff-rehearsal";
  return {
    label: next?.label ?? "Inspect EPL rehearsal",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    safeToRun: true,
    expectedEvidence: next?.nextAction ?? "EPL pre-kickoff rehearsal returns opening fixture readiness."
  };
}

function fixtureId(home: string, away: string, date: string): string {
  return `${date}-${home}-${away}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function buildDecisionEplPreKickoffRehearsal({
  date,
  eplFixtureIntake,
  dataBackbone,
  dataSourceCoverage,
  now = new Date()
}: {
  date: string;
  eplFixtureIntake: DecisionEplFixtureIntake;
  dataBackbone: DecisionDataBackbone;
  dataSourceCoverage: DecisionDataSourceCoverage;
  now?: Date;
}): DecisionEplPreKickoffRehearsal {
  const requiredSignals = signalRows(dataSourceCoverage);
  const fixtures = eplFixtureIntake.openingWindow.map((fixture) => {
    const gates = fixtureGates({ eplFixtureIntake, dataBackbone, requiredSignals });
    const status = statusFor({ dataBackbone, eplFixtureIntake, requiredSignals });
    const readinessScore = Math.round(gates.reduce((sum, item) => sum + scoreFor(item.status), 0) / Math.max(1, gates.length));
    return {
      id: fixtureId(fixture.home, fixture.away, fixture.date),
      date: fixture.date,
      kickoff: fixture.kickoff,
      match: `${fixture.home} vs ${fixture.away}`,
      home: fixture.home,
      away: fixture.away,
      broadcaster: fixture.broadcaster,
      readinessScore,
      status,
      gates,
      requiredSignals,
      rehearsalQuestion: `Can the engine explain ${fixture.home} vs ${fixture.away} without using any unproven feed, fake lineup, stale odds, or unverified storage row?`,
      modelInstructions: [
        "Start from official fixture identity, then require provider fixture ID proof before model execution.",
        "Use odds only after no-vig margin removal and fixture-to-market ID linkage.",
        "Treat injuries, suspensions, lineups, news, weather, standings, and recent form as evidence gates, not decoration.",
        "Keep public action no stronger than monitor/avoid until storage, provider, context, and shadow backtest gates pass."
      ],
      nextAction: fixtureNextAction(gates)
    };
  });
  const status = fixtures[0]?.status ?? "blocked-storage";
  const counts = {
    readyReadOnly: fixtures.filter((item) => item.status === "ready-read-only").length,
    needsProvider: fixtures.filter((item) => item.status === "needs-provider").length,
    needsContext: fixtures.filter((item) => item.status === "needs-context").length,
    blockedStorage: fixtures.filter((item) => item.status === "blocked-storage").length
  };
  const rehearsalHash = stableHash({
    date,
    status,
    epl: eplFixtureIntake.intakeHash,
    backbone: dataBackbone.backboneHash,
    fixtures: fixtures.map((item) => [item.id, item.status, item.readinessScore])
  });

  return {
    mode: "epl-pre-kickoff-rehearsal",
    generatedAt: now.toISOString(),
    date,
    status,
    rehearsalHash,
    summary: statusSummary(status),
    season: eplFixtureIntake.season,
    totals: {
      openingFixtures: fixtures.length,
      daysUntilStart: eplFixtureIntake.season.daysUntilStart,
      readyReadOnly: counts.readyReadOnly,
      needsProvider: counts.needsProvider,
      needsContext: counts.needsContext,
      blockedStorage: counts.blockedStorage,
      requiredSignals: requiredSignals.length,
      blockedSignals: requiredSignals.filter((signal) => signal.status === "block").length
    },
    fixtures,
    controls: {
      canInspectReadOnly: true,
      canRunFixtureDryRun: eplFixtureIntake.controls.canRunFixtureDryRun && dataBackbone.controls.canRunProviderDryRun,
      canRunOddsDryRun: dataBackbone.controls.canRunProviderDryRun && requiredSignals.some((signal) => signal.category === "odds" && signal.status !== "block"),
      canWriteFixtures: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    locks: unique([
      "EPL pre-kickoff rehearsal is read-only and cannot write fixture/provider rows.",
      "Opening fixtures cannot become public picks without live odds, context, storage, and backtest proof.",
      ...fixtures.flatMap((fixture) => fixture.gates.filter((gate) => gate.status !== "pass").map((gate) => `${fixture.match}: ${compact(gate.nextAction, 180)}`)),
      ...dataBackbone.locks
    ]),
    proofUrls: unique([
      "/api/sports/decision/epl-pre-kickoff-rehearsal",
      "/api/sports/decision/epl-fixture-intake",
      "/api/sports/decision/data-backbone",
      "/api/sports/decision/data-source-coverage",
      "/api/sports/decision/odds-board"
    ])
  };
}
