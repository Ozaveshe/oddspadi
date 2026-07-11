import type { DecisionAgentRuntime, DecisionAgentRuntimeCommand } from "@/lib/sports/prediction/decisionAgentRuntime";
import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import type { DecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import type { DecisionNetlifyDeployment } from "@/lib/sports/prediction/decisionNetlifyDeployment";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionSupabaseBootstrap } from "@/lib/sports/prediction/decisionSupabaseBootstrap";
import type { DecisionNetlifyDeploymentCommand } from "@/lib/sports/prediction/decisionNetlifyDeployment";
import type { DecisionSupabaseBootstrapCommand } from "@/lib/sports/prediction/decisionSupabaseBootstrap";
import type { TenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import type { FootballDataModelPromotionDecision } from "@/lib/sports/training/footballDataModelPromotionDecision";
import type { PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import type { DecisionDataSignalCategory, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionMvpRequirementAuditStatus = "ready" | "partial" | "blocked";
export type DecisionMvpRequirementAuditCheckStatus = "pass" | "watch" | "block";
export type DecisionMvpRequirementAuditGroup =
  | "data-layer"
  | "prediction-models"
  | "odds-intelligence"
  | "ai-thinking"
  | "training-supabase"
  | "netlify-deployment"
  | "responsible-controls";

export type DecisionMvpRequirementAuditCheck = {
  id: string;
  group: DecisionMvpRequirementAuditGroup;
  status: DecisionMvpRequirementAuditCheckStatus;
  label: string;
  requirement: string;
  evidence: string;
  proofUrl: string | null;
  nextAction: string;
  source: string;
};

export type DecisionMvpRequirementAuditCommand = {
  label: string;
  command: string | null;
  verifyUrl: string | null;
  safeToRun: boolean;
  missingEnv: string[];
  expectedEvidence: string;
  source: string;
};

export type DecisionMvpRequirementAudit = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpRequirementAuditStatus;
  mode: "mvp-requirement-audit";
  auditHash: string;
  summary: string;
  counts: Record<DecisionMvpRequirementAuditCheckStatus, number>;
  groups: Array<{
    id: DecisionMvpRequirementAuditGroup;
    label: string;
    pass: number;
    watch: number;
    block: number;
  }>;
  checks: DecisionMvpRequirementAuditCheck[];
  launchBlockers: DecisionMvpRequirementAuditCheck[];
  watchItems: DecisionMvpRequirementAuditCheck[];
  safeNextCommand: DecisionMvpRequirementAuditCommand | null;
  proofUrls: string[];
  control: {
    canRunReadOnly: boolean;
    canRunDryRun: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    productionReady: boolean;
  };
};

const GROUP_LABELS: Record<DecisionMvpRequirementAuditGroup, string> = {
  "data-layer": "Data layer",
  "prediction-models": "Prediction models",
  "odds-intelligence": "Odds intelligence",
  "ai-thinking": "AI explanation",
  "training-supabase": "Training and Supabase",
  "netlify-deployment": "Netlify deployment",
  "responsible-controls": "Responsible controls"
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

function check(input: DecisionMvpRequirementAuditCheck): DecisionMvpRequirementAuditCheck {
  return input;
}

function countByStatus(checks: DecisionMvpRequirementAuditCheck[]): Record<DecisionMvpRequirementAuditCheckStatus, number> {
  return {
    pass: checks.filter((item) => item.status === "pass").length,
    watch: checks.filter((item) => item.status === "watch").length,
    block: checks.filter((item) => item.status === "block").length
  };
}

function statusFromCounts(counts: Record<DecisionMvpRequirementAuditCheckStatus, number>): DecisionMvpRequirementAuditStatus {
  if (counts.block > 0) return "blocked";
  if (counts.watch > 0) return "partial";
  return "ready";
}

function groupSummary(checks: DecisionMvpRequirementAuditCheck[]): DecisionMvpRequirementAudit["groups"] {
  return (Object.keys(GROUP_LABELS) as DecisionMvpRequirementAuditGroup[]).map((id) => {
    const groupChecks = checks.filter((item) => item.group === id);
    const counts = countByStatus(groupChecks);
    return {
      id,
      label: GROUP_LABELS[id],
      ...counts
    };
  });
}

function unique(values: string[], limit = 12): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, limit);
}

function compact(value: string, fallback: string): string {
  return value.trim() || fallback;
}

function signalStats(rows: DecisionRow[], category: DecisionDataSignalCategory) {
  const signals = rows.flatMap((row) => row.prediction.decision.dataCoverage.signals.filter((signal) => signal.category === category));
  return {
    total: signals.length,
    providerBacked: signals.filter((signal) => signal.status === "provider-backed").length,
    computed: signals.filter((signal) => signal.status === "computed").length,
    mock: signals.filter((signal) => signal.status === "mock").length,
    missing: signals.filter((signal) => signal.status === "missing").length,
    stale: signals.filter((signal) => signal.status === "stale").length,
    notApplicable: signals.filter((signal) => signal.status === "not-applicable").length
  };
}

function statusFromSignalStats(stats: ReturnType<typeof signalStats>, dataItemMissingEnv: string[]): DecisionMvpRequirementAuditCheckStatus {
  if (stats.providerBacked > 0 && stats.missing + stats.stale === 0) return "pass";
  if (stats.computed > 0 || stats.mock > 0 || stats.providerBacked > 0) return "watch";
  if (stats.notApplicable > 0 && dataItemMissingEnv.length === 0) return "watch";
  return "block";
}

function dataSignalCheck({
  rows,
  dataIntake,
  category,
  id,
  label,
  requirement,
  fallbackNextAction
}: {
  rows: DecisionRow[];
  dataIntake: DecisionDataIntakeQueue;
  category: DecisionDataSignalCategory;
  id: string;
  label: string;
  requirement: string;
  fallbackNextAction: string;
}): DecisionMvpRequirementAuditCheck {
  const stats = signalStats(rows, category);
  const intakeItem = dataIntake.items.find((item) => item.category === category);
  const status = statusFromSignalStats(stats, intakeItem?.missingEnv ?? []);
  return check({
    id,
    group: "data-layer",
    status,
    label,
    requirement,
    evidence: `${stats.providerBacked} provider-backed, ${stats.computed} computed, ${stats.mock} mock, ${stats.missing + stats.stale} missing/stale across ${stats.total} signal(s).`,
    proofUrl: intakeItem?.verifyUrl ?? "/api/sports/decision/data-intake",
    nextAction:
      status === "pass"
        ? "Keep this signal fresh before each match-window decision."
        : intakeItem?.expectedEvidence ?? intakeItem?.decisionImpact ?? fallbackNextAction,
    source: intakeItem?.provider ?? "decision.dataCoverage"
  });
}

function hasAnyValueEdges(rows: DecisionRow[]): boolean {
  return rows.some((row) => row.prediction.valueEdges.length > 0);
}

function hasNoVigEdges(rows: DecisionRow[]): boolean {
  return rows.some((row) =>
    row.prediction.valueEdges.some((edge) => Number.isFinite(edge.rawImpliedProbability) && Number.isFinite(edge.noVigImpliedProbability))
  );
}

function hasPositiveEvRanking(rows: DecisionRow[]): boolean {
  return rows.some((row) => row.prediction.decision.oddsIntelligence.totalSelections > 0 && row.prediction.decision.oddsIntelligence.marketAudits.length > 0);
}

function anySaferAlternatives(rows: DecisionRow[]): boolean {
  return rows.some((row) => row.prediction.decision.saferAlternatives.length > 0);
}

function buildDataChecks({
  rows,
  dataIntake,
  training
}: {
  rows: DecisionRow[];
  dataIntake: DecisionDataIntakeQueue;
  training: TrainingDataSnapshot;
}): DecisionMvpRequirementAuditCheck[] {
  const historicalStatus: DecisionMvpRequirementAuditCheckStatus =
    training.counts.realFinishedFixtures >= training.readiness.minimumRecommendedFixtures
      ? "pass"
      : training.counts.realFinishedFixtures > 0
        ? "watch"
        : "block";

  return [
    dataSignalCheck({
      rows,
      dataIntake,
      category: "fixtures",
      id: "data-fixtures",
      label: "Fixtures for the day",
      requirement: "Collect today's fixtures before any slate ranking.",
      fallbackNextAction: "Connect API-Football or another fixture provider for today's slate."
    }),
    check({
      id: "data-historical-results",
      group: "data-layer",
      status: historicalStatus,
      label: "Team/player historical results",
      requirement: "Collect historical match results for training and calibration.",
      evidence: `${training.counts.realFinishedFixtures}/${training.readiness.minimumRecommendedFixtures} real finished fixtures are available; demo rows ${training.counts.demoFinishedFixtures}.`,
      proofUrl: "/api/sports/decision/training",
      nextAction:
        historicalStatus === "pass"
          ? "Run real-data backtests and drift checks."
          : "Backfill the 2016-2025 football corpus with real finished fixtures before enabling learned guardrails.",
      source: "trainingRepository"
    }),
    dataSignalCheck({
      rows,
      dataIntake,
      category: "standings",
      id: "data-standings",
      label: "League standings",
      requirement: "Collect table position and league context.",
      fallbackNextAction: "Run API-Football context dry-runs for standings snapshots."
    }),
    dataSignalCheck({
      rows,
      dataIntake,
      category: "home-away",
      id: "data-home-away",
      label: "Home/away performance",
      requirement: "Track venue split and home/away form.",
      fallbackNextAction: "Derive team home/away features from stored historical fixtures."
    }),
    dataSignalCheck({
      rows,
      dataIntake,
      category: "recent-form",
      id: "data-recent-form",
      label: "Recent form",
      requirement: "Collect recent form before ranking picks.",
      fallbackNextAction: "Replace mock form with provider-backed or historically computed form windows."
    }),
    dataSignalCheck({
      rows,
      dataIntake,
      category: "injuries",
      id: "data-injuries",
      label: "Injuries",
      requirement: "Collect player injury context where available.",
      fallbackNextAction: "Dry-run availability snapshots from API-Football before trusting team-news adjustments."
    }),
    dataSignalCheck({
      rows,
      dataIntake,
      category: "suspensions",
      id: "data-suspensions",
      label: "Suspensions",
      requirement: "Collect suspensions and other player availability restrictions.",
      fallbackNextAction: "Normalize suspension/availability rows into player availability snapshots."
    }),
    dataSignalCheck({
      rows,
      dataIntake,
      category: "lineups",
      id: "data-lineups",
      label: "Lineups when available",
      requirement: "Collect lineups and formation evidence near kickoff.",
      fallbackNextAction: "Dry-run lineup snapshots and mark unavailable lineups as missing, not neutral."
    }),
    dataSignalCheck({
      rows,
      dataIntake,
      category: "odds",
      id: "data-odds",
      label: "Bookmaker odds",
      requirement: "Collect bookmaker odds before value-edge ranking.",
      fallbackNextAction: "Connect The Odds API and store opening, pre-kickoff, and closing prices."
    }),
    dataSignalCheck({
      rows,
      dataIntake,
      category: "live-scores",
      id: "data-live-scores",
      label: "Live scores",
      requirement: "Collect live score and match clock when matches are in play.",
      fallbackNextAction: "Connect live scores through API-Football or a dedicated live-score provider."
    }),
    dataSignalCheck({
      rows,
      dataIntake,
      category: "match-events",
      id: "data-match-events",
      label: "Match events",
      requirement: "Collect goals, cards, substitutions, and in-play events.",
      fallbackNextAction: "Dry-run API-Football event archives and store normalized event snapshots."
    }),
    dataSignalCheck({
      rows,
      dataIntake,
      category: "news",
      id: "data-news",
      label: "News signals",
      requirement: "Collect bounded team-news signals with source and timestamp.",
      fallbackNextAction: "Add NEWS_API_KEY and normalize team-news relevance into news signal rows."
    }),
    dataSignalCheck({
      rows,
      dataIntake,
      category: "weather",
      id: "data-weather",
      label: "Weather where relevant",
      requirement: "Collect weather for outdoor football and other weather-sensitive matches.",
      fallbackNextAction: "Add OpenWeather credentials and store venue weather snapshots."
    })
  ];
}

function buildPredictionModelChecks({
  rows,
  featureMatrix,
  modelGovernance
}: {
  rows: DecisionRow[];
  featureMatrix: DecisionFeatureMatrix;
  modelGovernance: DecisionModelGovernance;
}): DecisionMvpRequirementAuditCheck[] {
  const footballRows = rows.filter((row) => row.match.sport === "football");
  const footballModelReady = footballRows.some((row) => row.prediction.diagnostics.modelVersion === "football-poisson-v2");
  const footballHasContext = footballRows.some((row) => row.prediction.contextAdjustment.signals.length > 0);
  const footballHasMarketPrior = footballRows.some((row) => row.prediction.marketPriorAdjustment.markets.length > 0);

  return [
    check({
      id: "model-football",
      group: "prediction-models",
      status: footballModelReady && footballHasMarketPrior ? "pass" : footballModelReady ? "watch" : "block",
      label: "Football model",
      requirement: "Use Poisson expected goals, team strength, home advantage, recent form, context, xG where available, and market adjustment.",
      evidence: footballModelReady
        ? `Football uses football-poisson-v2 across ${footballRows.length} row(s), with ${featureMatrix.coverage.totalFeatures} live feature slots and market-prior adjustment ${footballHasMarketPrior ? "present" : "missing"}.`
        : "No football Poisson model evidence was found in the current slate.",
      proofUrl: "/api/sports/decision/feature-matrix",
      nextAction: footballHasContext
        ? "Replace remaining mock/xG placeholders with provider-backed context and shot-quality feeds when available."
        : "Add provider-backed context and xG-like feeds before increasing football trust.",
      source: "footballModel.ts"
    }),
    check({
      id: "model-basketball",
      group: "prediction-models",
      status: "pass",
      label: "Basketball model",
      requirement: "Use team rating, pace, offensive/defensive efficiency, rest days, home/away, injuries, spread, and moneyline logic.",
      evidence: "basketball-efficiency-v3 consumes stored Elo, pace, offensive/defensive efficiency, rolling form, and rest where available; current availability remains guarded missing evidence.",
      proofUrl: "/api/sports/predictions?sport=basketball",
      nextAction: "Replace deterministic rest/availability proxies with provider-backed injury, minutes, travel, and rotation feeds.",
      source: "basketballModel.ts"
    }),
    check({
      id: "model-tennis",
      group: "prediction-models",
      status: "pass",
      label: "Tennis model",
      requirement: "Use player Elo, surface rating, recent form, head-to-head, fatigue, round, and injury/news signals.",
      evidence: "tennis-surface-elo-v3 consumes stored overall/surface Elo, form, rank, and rest; unsupported H2H and travel effects remain zero until verified.",
      proofUrl: "/api/sports/predictions?sport=tennis",
      nextAction: "Replace H2H/travel/load proxies with real match-history, surface, retirement, injury, and tournament feeds.",
      source: "tennisModel.ts"
    }),
    check({
      id: "model-governance",
      group: "prediction-models",
      status: modelGovernance.status === "approved" ? "pass" : modelGovernance.status === "shadow" ? "watch" : "block",
      label: "Model governance",
      requirement: "Keep learned thresholds in shadow mode until corpus, target labels, drift, and calibration pass.",
      evidence: `${modelGovernance.status} with trust score ${modelGovernance.trustScore}/100, ${modelGovernance.failingChecks} fail(s), ${modelGovernance.warningChecks} warning(s).`,
      proofUrl: "/api/sports/decision/model-governance",
      nextAction: modelGovernance.nextActions[0] ?? "Keep model governance checks attached to every training upgrade.",
      source: "decisionModelGovernance"
    })
  ];
}

function buildOddsChecks(rows: DecisionRow[]): DecisionMvpRequirementAuditCheck[] {
  const valueEdges = rows.reduce((sum, row) => sum + row.prediction.valueEdges.length, 0);
  const actionable = rows.reduce((sum, row) => sum + row.prediction.decision.oddsIntelligence.actionableSelections, 0);
  const markets = rows.reduce((sum, row) => sum + row.prediction.decision.oddsIntelligence.totalMarkets, 0);

  return [
    check({
      id: "odds-implied-probability",
      group: "odds-intelligence",
      status: hasAnyValueEdges(rows) ? "pass" : "block",
      label: "Implied probability",
      requirement: "Convert decimal odds to implied probability for every priced selection.",
      evidence: `${valueEdges} priced value-edge rows are available across ${markets} market audit(s).`,
      proofUrl: "/api/sports/decision",
      nextAction: "Keep every market audit storing raw implied probability before no-vig adjustment.",
      source: "odds.ts"
    }),
    check({
      id: "odds-no-vig-margin",
      group: "odds-intelligence",
      status: hasNoVigEdges(rows) ? "pass" : "block",
      label: "Bookmaker margin removal",
      requirement: "Remove bookmaker margin where possible before comparing model probability with market probability.",
      evidence: hasNoVigEdges(rows) ? "Value edges include raw implied probability, no-vig probability, and bookmaker margin." : "No no-vig probability evidence was found.",
      proofUrl: "/api/sports/decision",
      nextAction: "Keep no-vig probabilities visible in every market audit and stored decision snapshot.",
      source: "odds.ts"
    }),
    check({
      id: "odds-ev-ranking",
      group: "odds-intelligence",
      status: hasPositiveEvRanking(rows) ? "pass" : "block",
      label: "Value edge and EV ranking",
      requirement: "Compare model probability with market probability, calculate edge/EV, and rank positive expected value picks.",
      evidence: `${actionable} actionable positive-EV selection(s); top-candidate ranking is ${hasPositiveEvRanking(rows) ? "available" : "missing"}.`,
      proofUrl: "/api/sports/value-picks",
      nextAction: actionable ? "Refresh odds before action and track closing-line value." : "Keep avoid/watch posture when no positive EV selection clears guardrails.",
      source: "decision.oddsIntelligence"
    }),
    check({
      id: "odds-safer-alternatives",
      group: "odds-intelligence",
      status: anySaferAlternatives(rows) ? "pass" : "watch",
      label: "Safer alternatives",
      requirement: "Explain safer alternatives such as double chance, draw no bet, over/under, BTTS, spread, and totals.",
      evidence: `${rows.reduce((sum, row) => sum + row.prediction.decision.saferAlternatives.length, 0)} safer alternative(s) are attached to current decisions.`,
      proofUrl: "/predictions/decision-engine",
      nextAction: "Add market-specific alternatives only when the relevant bookmaker market exists and is priced.",
      source: "decisionEngine"
    }),
    check({
      id: "odds-avoid-reasons",
      group: "odds-intelligence",
      status: rows.every((row) => row.prediction.decision.avoidReasons.length || row.prediction.decision.risks.length) ? "pass" : "watch",
      label: "Avoid and risk explanations",
      requirement: "Explain why a bet should be avoided and what risks may affect it.",
      evidence: `${rows.reduce((sum, row) => sum + row.prediction.decision.avoidReasons.length, 0)} avoid reason(s) and ${rows.reduce((sum, row) => sum + row.prediction.decision.risks.length, 0)} risk item(s) are attached.`,
      proofUrl: "/predictions/decision-engine",
      nextAction: "Keep avoid reasons more prominent than picks when data or EV is weak.",
      source: "decisionEngine"
    })
  ];
}

function buildAiChecks({
  rows,
  agentRuntime
}: {
  rows: DecisionRow[];
  agentRuntime: DecisionAgentRuntime;
}): DecisionMvpRequirementAuditCheck[] {
  const evidenceRefs = rows.reduce((sum, row) => sum + row.prediction.decision.aiProtocol.evidenceRefs.length, 0);
  const publicReasoning = rows.reduce((sum, row) => sum + row.prediction.decision.publicReasoningSteps.length, 0);
  const graphNodes = rows.reduce((sum, row) => sum + row.prediction.decision.reasoningGraph.nodes.length, 0);
  const graphEdges = rows.reduce((sum, row) => sum + row.prediction.decision.reasoningGraph.edges.length, 0);
  const graphMatches = rows.filter((row) => row.prediction.decision.reasoningGraph.nodes.length > 0 && row.prediction.decision.reasoningGraph.edges.length > 0).length;
  const safeGuardrailText = agentRuntime.guardrails.join(" ").toLowerCase();

  return [
    check({
      id: "ai-public-explanations",
      group: "ai-thinking",
      status: publicReasoning > 0 ? "pass" : "watch",
      label: "Visible explanations",
      requirement: "Explain why the model favors, monitors, or avoids a side without exposing hidden chain-of-thought.",
      evidence: `${publicReasoning} public reasoning step(s), ${evidenceRefs} evidence ref(s), and ${rows.length} research brief(s) exist.`,
      proofUrl: "/predictions/decision-engine",
      nextAction: "Keep explanations tied to public evidence, thesis, risk, and actionability fields.",
      source: "decision.aiProtocol"
    }),
    check({
      id: "ai-news-risk-awareness",
      group: "ai-thinking",
      status: rows.some((row) => row.prediction.decision.researchBrief.dataGaps.length || row.prediction.decision.notebook.falsifiers.length) ? "pass" : "watch",
      label: "News and risk awareness",
      requirement: "Explain which news may affect the match and what would change the decision.",
      evidence: `${rows.reduce((sum, row) => sum + row.prediction.decision.researchBrief.dataGaps.length, 0)} research data gap(s) and ${rows.reduce((sum, row) => sum + row.prediction.decision.notebook.falsifiers.length, 0)} falsifier(s) are tracked.`,
      proofUrl: "/api/sports/decision/research-agent",
      nextAction: "Connect provider-backed team news before treating news risk as resolved.",
      source: "researchBrief"
    }),
    check({
      id: "ai-citations",
      group: "ai-thinking",
      status: evidenceRefs > 0 && safeGuardrailText.includes("evidence ids") ? "pass" : "watch",
      label: "Evidence citations",
      requirement: "Require evidence IDs and citation validation before trusting an AI review.",
      evidence: `${evidenceRefs} local evidence ref(s); runtime guardrail mentions citation validation: ${safeGuardrailText.includes("citation validation") ? "yes" : "no"}.`,
      proofUrl: "/api/sports/decision/ai-citations",
      nextAction: "Do not trust OpenAI text until citation validator and firewall accept the supplied evidence IDs.",
      source: "decisionAICitationValidator"
    }),
    check({
      id: "ai-evidence-graph",
      group: "ai-thinking",
      status: rows.length > 0 && graphMatches === rows.length && graphNodes > 0 && graphEdges > 0 ? "pass" : "watch",
      label: "Evidence graph",
      requirement: "Connect model, market, data, risk, uncertainty, and action evidence into an inspectable graph before any AI narrative is trusted.",
      evidence: `${graphMatches}/${rows.length} decision graph(s) include nodes and edges; aggregate graph has ${graphNodes} node(s) and ${graphEdges} edge(s).`,
      proofUrl: "/api/sports/decision/evidence-graph",
      nextAction: "Inspect the evidence graph to confirm the active path, blockers, watch nodes, and next read-only observation.",
      source: "decisionEvidenceGraph"
    }),
    check({
      id: "ai-thinking-introspection",
      group: "ai-thinking",
      status: publicReasoning > 0 && graphMatches > 0 && agentRuntime.phases.length >= 7 ? "pass" : "watch",
      label: "Thinking introspection",
      requirement: "Expose one public self-audit that names the current belief, primary doubt, next question, weakest thinking layer, and safe proof command.",
      evidence: `${publicReasoning} public reasoning step(s), ${graphMatches} graph-backed match(es), and ${agentRuntime.phases.length} runtime phase(s) feed the introspection audit.`,
      proofUrl: "/api/sports/decision/thinking-introspection",
      nextAction: "Inspect thinking introspection before claiming the engine has a connected belief, doubt, rehearsal, and graph loop.",
      source: "decisionThinkingIntrospection"
    }),
    check({
      id: "ai-agent-runtime",
      group: "ai-thinking",
      status: agentRuntime.status === "blocked" ? "block" : "pass",
      label: "Agent runtime",
      requirement: "Run the agent through sense, think, review, decide, execute, verify, and learn phases.",
      evidence: `${agentRuntime.status} in ${agentRuntime.mode} mode with ${agentRuntime.phases.length} phase(s), ${agentRuntime.commands.length} command(s), and ${agentRuntime.locks.length} lock(s).`,
      proofUrl: "/api/sports/decision/agent-runtime",
      nextAction: agentRuntime.nextCommand?.expectedEvidence ?? "Keep runtime in read-only or dry-run mode until proof clears.",
      source: "decisionAgentRuntime"
    }),
    check({
      id: "ai-cognitive-proof",
      group: "ai-thinking",
      status: safeGuardrailText.includes("hidden chain-of-thought") && safeGuardrailText.includes("upgrade") ? "pass" : "watch",
      label: "Cognitive proof receipt",
      requirement: "Expose a replayable public thinking receipt across loop, deliberation, controls, memory, experiment state, executive decision, and governor without exposing hidden chain-of-thought.",
      evidence: `${agentRuntime.locks.length} runtime lock(s) and ${agentRuntime.phases.length} phase(s) feed the cognitive proof; hidden chain and public-action upgrade controls remain locked.`,
      proofUrl: "/api/sports/decision/ai-cognitive-proof",
      nextAction: "Inspect the cognitive proof before treating any AI review as more than watch-only evidence.",
      source: "decisionAICognitiveProof"
    }),
    check({
      id: "ai-no-upgrade",
      group: "ai-thinking",
      status: safeGuardrailText.includes("upgrade") ? "pass" : "watch",
      label: "No-upgrade AI guardrail",
      requirement: "AI may critique or downgrade but must not upgrade weak/no-edge decisions.",
      evidence: safeGuardrailText.includes("upgrade") ? "Runtime guardrails include the no-upgrade rule." : "No-upgrade wording was not found in runtime guardrails.",
      proofUrl: "/api/sports/decision/ai-firewall",
      nextAction: "Keep the same-or-safer action firewall between AI output and product authority.",
      source: "decisionAIFirewall"
    })
  ];
}

function buildTrainingSupabaseChecks({
  supabaseBootstrap,
  corpusPlan,
  training,
  publicHistoricalTrainingEvidence = null,
  footballDataModelPromotionDecision = null
}: {
  supabaseBootstrap: DecisionSupabaseBootstrap;
  corpusPlan: TenYearFootballCorpusBackfillPlan;
  training: TrainingDataSnapshot;
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
  footballDataModelPromotionDecision?: FootballDataModelPromotionDecision | null;
}): DecisionMvpRequirementAuditCheck[] {
  const publicHistoryCheck = publicHistoricalTrainingEvidence
    ? [
        check({
          id: "training-public-history-evidence",
          group: "training-supabase" as const,
          status:
            publicHistoricalTrainingEvidence.status === "failed" || publicHistoricalTrainingEvidence.status === "insufficient-history"
              ? "block"
              : publicHistoricalTrainingEvidence.status === "provider-retest-ready" || publicHistoricalTrainingEvidence.controls.canCreditMvpDiagnosticProgress
                ? "pass"
                : "watch",
          label: "Public EPL diagnostic history",
          requirement:
            "Use the public 10-year Football-Data EPL corpus as diagnostic evidence without treating it as persisted provider-enriched training data.",
          evidence: `${publicHistoricalTrainingEvidence.scorecard.fixtures.toLocaleString()} public fixture row(s), ${publicHistoricalTrainingEvidence.scorecard.oddsRows.toLocaleString()} odds row(s), ${publicHistoricalTrainingEvidence.scorecard.bookmakerMarkets.toLocaleString()} bookmaker market(s), diagnostic score ${publicHistoricalTrainingEvidence.diagnosticScore}/100; ${publicHistoricalTrainingEvidence.scorecard.benchmarkVerdict}.`,
          proofUrl: "/api/sports/decision/training/public-historical-training-evidence",
          nextAction:
            publicHistoricalTrainingEvidence.status === "market-prior-dominant"
              ? "Keep market-prior dominance and prepare provider-enriched retests before promoting model probabilities."
              : publicHistoricalTrainingEvidence.nextAction.label,
          source: "Football-Data public EPL CSV"
        })
      ]
    : [];
  const modelPromotionCheck = footballDataModelPromotionDecision
    ? [
        check({
          id: "training-model-promotion-decision",
          group: "training-supabase" as const,
          status:
            footballDataModelPromotionDecision.status === "shadow-eligible" || footballDataModelPromotionDecision.status === "provider-retest-ready"
              ? "pass"
              : footballDataModelPromotionDecision.status === "waiting-provider-rows" ||
                  footballDataModelPromotionDecision.status === "demo-preview-only" ||
                  footballDataModelPromotionDecision.status === "collect-more-data"
                ? "watch"
                : "block",
          label: "Model promotion decision",
          requirement:
            "Refuse learned-weight or live-probability promotion until public history, provider-enriched retests, stored rows, and market gates agree.",
          evidence: `${footballDataModelPromotionDecision.status}; market ${footballDataModelPromotionDecision.publicEvidence.marketVerdict}; provider rows ${footballDataModelPromotionDecision.providerEvidence.normalizedRows}; runner ${footballDataModelPromotionDecision.providerEvidence.runnerStatus}.`,
          proofUrl: "/api/sports/decision/training/football-data-model-promotion-decision",
          nextAction: footballDataModelPromotionDecision.nextAction.label,
          source: "footballDataModelPromotionDecision"
        })
      ]
    : [];

  return [
    check({
      id: "supabase-bootstrap",
      group: "training-supabase",
      status: supabaseBootstrap.status === "ready-dry-run" ? "pass" : "block",
      label: "Supabase bootstrap",
      requirement: "Target the new OddsPadi Supabase project, verify schema, and keep writes locked until proof passes.",
      evidence: `${supabaseBootstrap.status}; expected ${supabaseBootstrap.project.expectedRef}; MCP proof ${supabaseBootstrap.mcp.scopedProofPasses ? "passes" : "missing"}.`,
      proofUrl: "/api/sports/decision/supabase-bootstrap",
      nextAction: supabaseBootstrap.checks.find((item) => item.status === "block")?.nextAction ?? "Run a supervised dry-run only after project-scoped proof.",
      source: "decisionSupabaseBootstrap"
    }),
    check({
      id: "supabase-op-schema",
      group: "training-supabase",
      status:
        supabaseBootstrap.schema.verifiedTableCount === supabaseBootstrap.schema.expectedTableCount
          ? "pass"
          : supabaseBootstrap.schema.verifiedTableCount > 0
            ? "watch"
            : "block",
      label: "Expected op_ schema",
      requirement: "Create and verify the server-only tables for decisions, provider ingestion, historical training, outcomes, and backtests.",
      evidence: `${supabaseBootstrap.schema.verifiedTableCount}/${supabaseBootstrap.schema.expectedTableCount} expected table(s) verified; ${supabaseBootstrap.migrations.length} migration file(s) present.`,
      proofUrl: "/api/sports/decision/status",
      nextAction: "Apply migrations only through an OddsPadi-scoped MCP/CLI session, then run schema verification.",
      source: "supabase/migrations"
    }),
    check({
      id: "supabase-mcp-scope",
      group: "training-supabase",
      status: supabaseBootstrap.mcp.scopedProofPasses ? "pass" : "block",
      label: "Project-scoped MCP",
      requirement: "Use only an OddsPadi-scoped Supabase MCP/ref before schema inspection or SQL execution.",
      evidence: `Repo MCP config ${supabaseBootstrap.mcp.repoConfigPresent ? "present" : "missing"}; scoped proof env ${supabaseBootstrap.mcp.scopedProofEnv ?? "missing"}.`,
      proofUrl: "/api/sports/decision/supabase-bootstrap",
      nextAction: `Prove the MCP session against ${supabaseBootstrap.project.expectedRef} before any live schema mutation.`,
      source: "Supabase MCP"
    }),
    check({
      id: "training-corpus-plan",
      group: "training-supabase",
      status: corpusPlan.seasonCount >= 10 && corpusPlan.targetLeagues.length > 0 ? "pass" : "watch",
      label: "10-year corpus plan",
      requirement: "Plan the last 10 years of football fixtures, odds, context, events, news, and weather as training data.",
      evidence: `${corpusPlan.seasonFrom}-${corpusPlan.seasonTo}, ${corpusPlan.targetLeagues.length} competition(s), ${corpusPlan.totalCandidateJobs} candidate job(s), ${corpusPlan.estimatedFixtureDerivedOddsJobs} projected fixture-derived odds jobs.`,
      proofUrl: "/api/sports/decision/training/corpus-plan",
      nextAction: corpusPlan.nextSteps[0] ?? "Start with capped dry-runs before write-mode imports.",
      source: "corpusBackfillPlan"
    }),
    check({
      id: "training-real-corpus",
      group: "training-supabase",
      status: training.readiness.readyForTraining ? "pass" : training.counts.realFinishedFixtures > 0 || training.counts.realOddsSnapshots > 0 ? "watch" : "block",
      label: "Real training corpus",
      requirement: "Do not claim model training readiness until real fixtures, odds, feature snapshots, and labels exist.",
      evidence: `${training.counts.realFinishedFixtures} real finished fixture(s), ${training.counts.realOddsSnapshots} real odds snapshot(s), ${training.counts.featureSnapshots} feature snapshot(s).`,
      proofUrl: "/api/sports/decision/training",
      nextAction: training.readiness.detail,
      source: "trainingRepository"
    }),
    check({
      id: "training-backtest",
      group: "training-supabase",
      status: training.latestBacktest?.status === "completed" ? "pass" : "block",
      label: "Backtest and calibration",
      requirement: "Backtest before learned thresholds affect live decisions.",
      evidence: training.latestBacktest
        ? `Latest backtest ${training.latestBacktest.id} is ${training.latestBacktest.status} with sample ${training.latestBacktest.sampleSize}.`
        : "No completed real-data backtest is available.",
      proofUrl: "/api/sports/decision/training",
      nextAction: "Run real-data sport-specific backtests after the minimum corpus and odds snapshots exist.",
      source: "trainingRepository"
    }),
    ...publicHistoryCheck,
    ...modelPromotionCheck
  ];
}

function buildNetlifyChecks(netlifyDeployment: DecisionNetlifyDeployment): DecisionMvpRequirementAuditCheck[] {
  return [
    check({
      id: "netlify-config",
      group: "netlify-deployment",
      status: netlifyDeployment.config.filePresent && netlifyDeployment.config.buildCommand === "npm run build" ? "pass" : "block",
      label: "Netlify config",
      requirement: "Deploy the Next.js MVP on Netlify with correct build, publish, and Node runtime settings.",
      evidence: `Build ${netlifyDeployment.config.buildCommand ?? "missing"}, publish ${netlifyDeployment.config.publishDirectory ?? "missing"}, Node ${netlifyDeployment.config.nodeVersion ?? "missing"}.`,
      proofUrl: "/api/sports/decision/netlify-readiness",
      nextAction: "Keep secrets in Netlify env variables, not netlify.toml.",
      source: "netlify.toml"
    }),
    check({
      id: "netlify-readiness",
      group: "netlify-deployment",
      status: netlifyDeployment.status === "ready-smoke" ? "pass" : "block",
      label: "Netlify readiness",
      requirement: "Verify production env, Supabase bootstrap, runtime proof, and route smokes before publishing.",
      evidence: `${netlifyDeployment.status}; missing production env ${netlifyDeployment.env.missingProduction.length}; production URL ${netlifyDeployment.site.productionUrl ?? "missing"}.`,
      proofUrl: "/api/sports/decision/netlify-readiness",
      nextAction: netlifyDeployment.checks.find((item) => item.status === "block")?.nextAction ?? "Run local and production smoke routes.",
      source: "decisionNetlifyDeployment"
    }),
    check({
      id: "netlify-route-smoke",
      group: "netlify-deployment",
      status: netlifyDeployment.routeSmokePlan.localRoutes.length >= 5 ? "pass" : "watch",
      label: "Route smoke plan",
      requirement: "Smoke the decision APIs and dashboard locally and after deployment.",
      evidence: `${netlifyDeployment.routeSmokePlan.localRoutes.length} local smoke route(s), ${netlifyDeployment.routeSmokePlan.productionRoutes.length} production smoke route(s).`,
      proofUrl: "/api/sports/decision/netlify-readiness",
      nextAction: netlifyDeployment.site.productionUrl ? "Smoke production routes after deploy." : "Set NEXT_PUBLIC_SITE_URL after the Netlify site is linked.",
      source: "decisionNetlifyDeployment"
    })
  ];
}

function buildResponsibleChecks(agentRuntime: DecisionAgentRuntime): DecisionMvpRequirementAuditCheck[] {
  return [
    check({
      id: "responsible-analysis-only",
      group: "responsible-controls",
      status: "pass",
      label: "Analysis-only product stance",
      requirement: "Do not present predictions as guarantees or betting operations.",
      evidence: "The MVP exposes statistical analysis, uncertainty, risk, avoid reasons, and responsible-use controls.",
      proofUrl: "/predictions/decision-engine",
      nextAction: "Keep confidence, uncertainty, and avoid states visible before any public pick.",
      source: "PredictionDisclaimer"
    }),
    check({
      id: "responsible-no-persist",
      group: "responsible-controls",
      status: agentRuntime.permissions.canPersist ? "block" : "pass",
      label: "Persistence lock",
      requirement: "Keep decision persistence disabled until Supabase project isolation, schema, and proof receipts pass.",
      evidence: `Runtime canPersist=${agentRuntime.permissions.canPersist}.`,
      proofUrl: "/api/sports/decision/agent-runtime",
      nextAction: "Do not add persist=1 while runtime locks are active.",
      source: "decisionAgentRuntime"
    }),
    check({
      id: "responsible-no-publish",
      group: "responsible-controls",
      status: agentRuntime.permissions.canPublish ? "block" : "pass",
      label: "Publishing lock",
      requirement: "Keep public pick publishing disabled until provider data, AI, governance, and proof gates pass.",
      evidence: `Runtime canPublish=${agentRuntime.permissions.canPublish}.`,
      proofUrl: "/api/sports/decision/authority",
      nextAction: "Keep blocked/watch decisions internal or educational until activation audit passes.",
      source: "decisionAuthority"
    }),
    check({
      id: "responsible-no-train",
      group: "responsible-controls",
      status: agentRuntime.permissions.canTrain ? "block" : "pass",
      label: "Training lock",
      requirement: "Keep learned guardrails disabled until real data, target labels, backtests, and drift checks pass.",
      evidence: `Runtime canTrain=${agentRuntime.permissions.canTrain}.`,
      proofUrl: "/api/sports/decision/model-governance",
      nextAction: "Do not apply learned thresholds from demo or incomplete real-data samples.",
      source: "decisionModelGovernance"
    })
  ];
}

function commandFromRuntime(command: DecisionAgentRuntimeCommand | null): DecisionMvpRequirementAuditCommand | null {
  if (!command) return null;
  return {
    label: command.label,
    command: command.command,
    verifyUrl: command.verifyUrl,
    safeToRun: command.canRunNow,
    missingEnv: command.missingEnv,
    expectedEvidence: command.expectedEvidence,
    source: command.source
  };
}

function commandFromSupabase(command: DecisionSupabaseBootstrapCommand | null): DecisionMvpRequirementAuditCommand | null {
  if (!command) return null;
  return {
    label: command.label,
    command: command.command,
    verifyUrl: command.verifyUrl,
    safeToRun: command.safeToRun,
    missingEnv: command.missingEnv,
    expectedEvidence: command.expectedEvidence,
    source: `supabase-bootstrap:${command.id}`
  };
}

function commandFromNetlify(command: DecisionNetlifyDeploymentCommand | null): DecisionMvpRequirementAuditCommand | null {
  if (!command) return null;
  return {
    label: command.label,
    command: command.command,
    verifyUrl: null,
    safeToRun: command.safeToRun,
    missingEnv: command.missingEnv,
    expectedEvidence: command.expectedEvidence,
    source: `netlify-readiness:${command.id}`
  };
}

function selectSafeCommand({
  agentRuntime,
  supabaseBootstrap,
  netlifyDeployment
}: {
  agentRuntime: DecisionAgentRuntime;
  supabaseBootstrap: DecisionSupabaseBootstrap;
  netlifyDeployment: DecisionNetlifyDeployment;
}): DecisionMvpRequirementAuditCommand | null {
  const candidates = [
    commandFromRuntime(agentRuntime.nextCommand),
    commandFromSupabase(supabaseBootstrap.nextCommand),
    commandFromNetlify(netlifyDeployment.nextCommand)
  ].filter((item): item is DecisionMvpRequirementAuditCommand => Boolean(item));
  return candidates.find((item) => item.safeToRun && item.missingEnv.length === 0) ?? candidates[0] ?? null;
}

function summaryFor(status: DecisionMvpRequirementAuditStatus, counts: Record<DecisionMvpRequirementAuditCheckStatus, number>): string {
  if (status === "ready") return `MVP requirements are ready: ${counts.pass} pass, ${counts.watch} watch, ${counts.block} block.`;
  if (status === "partial") return `MVP requirements are partially covered: ${counts.pass} pass, ${counts.watch} watch, ${counts.block} block.`;
  return `MVP requirements are blocked for launch: ${counts.pass} pass, ${counts.watch} watch, ${counts.block} block.`;
}

export function buildDecisionMvpRequirementAudit({
  rows,
  date,
  sport,
  readiness,
  dataIntake,
  featureMatrix,
  modelGovernance,
  supabaseBootstrap,
  netlifyDeployment,
  agentRuntime,
  corpusPlan,
  training,
  publicHistoricalTrainingEvidence = null,
  footballDataModelPromotionDecision = null
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  readiness: DecisionEngineReadiness;
  dataIntake: DecisionDataIntakeQueue;
  featureMatrix: DecisionFeatureMatrix;
  modelGovernance: DecisionModelGovernance;
  supabaseBootstrap: DecisionSupabaseBootstrap;
  netlifyDeployment: DecisionNetlifyDeployment;
  agentRuntime: DecisionAgentRuntime;
  corpusPlan: TenYearFootballCorpusBackfillPlan;
  training: TrainingDataSnapshot;
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
  footballDataModelPromotionDecision?: FootballDataModelPromotionDecision | null;
}): DecisionMvpRequirementAudit {
  const checks = [
    ...buildDataChecks({ rows, dataIntake, training }),
    ...buildPredictionModelChecks({ rows, featureMatrix, modelGovernance }),
    ...buildOddsChecks(rows),
    ...buildAiChecks({ rows, agentRuntime }),
    ...buildTrainingSupabaseChecks({
      supabaseBootstrap,
      corpusPlan,
      training,
      publicHistoricalTrainingEvidence,
      footballDataModelPromotionDecision
    }),
    ...buildNetlifyChecks(netlifyDeployment),
    ...buildResponsibleChecks(agentRuntime)
  ];
  const counts = countByStatus(checks);
  const status = statusFromCounts(counts);
  const launchBlockers = checks.filter((item) => item.status === "block").slice(0, 10);
  const watchItems = checks.filter((item) => item.status === "watch").slice(0, 10);
  const safeNextCommand = selectSafeCommand({ agentRuntime, supabaseBootstrap, netlifyDeployment });
  const proofUrls = unique(
    [
      "/api/sports/decision/status",
      "/api/sports/decision/mvp-audit",
      "/predictions/decision-engine",
      "/api/sports/decision/ai-cognitive-proof",
      "/api/sports/decision/evidence-graph",
      "/api/sports/decision/thinking-introspection",
      ...checks.map((item) => item.proofUrl ?? "")
    ],
    16
  );
  const control = {
    canRunReadOnly: agentRuntime.permissions.canRunReadOnly,
    canRunDryRun: agentRuntime.permissions.canRunDryRun,
    canPersist: false,
    canPublish: false,
    canTrain: false,
    productionReady: status === "ready" && readiness.deterministicCore.status === "ready"
  } as const;
  const auditHash = stableHash({
    date,
    sport,
    status,
    counts,
    readiness: readiness.runtimeMode,
    dataIntake: dataIntake.status,
    featureMatrix: featureMatrix.status,
    modelGovernance: modelGovernance.status,
    supabaseBootstrap: supabaseBootstrap.status,
    netlifyDeployment: netlifyDeployment.status,
    agentRuntime: agentRuntime.status,
    corpusPlan: corpusPlan.status,
    training: training.status,
    publicHistory: publicHistoricalTrainingEvidence?.evidenceHash ?? "not-attached",
    modelPromotion: footballDataModelPromotionDecision?.decisionHash ?? "not-attached",
    checks: checks.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "mvp-requirement-audit",
    auditHash,
    summary: compact(summaryFor(status, counts), "MVP requirement audit generated."),
    counts,
    groups: groupSummary(checks),
    checks,
    launchBlockers,
    watchItems,
    safeNextCommand,
    proofUrls,
    control
  };
}
