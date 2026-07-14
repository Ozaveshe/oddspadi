export type Sport = "football" | "basketball" | "tennis" | "cricket" | "rugby" | "handball";

export type MatchStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled" | "suspended";
export type ConfidenceLevel = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high";
export type PredictionResult = "pending" | "won" | "lost" | "push" | "void";
export type AgentVerdict = "value-found" | "watchlist" | "no-clear-value";
export type DecisionVerdict = "strong-value" | "lean-value" | "watchlist" | "avoid" | "insufficient-data";
export type DecisionAction = "consider" | "monitor" | "avoid";
export type DecisionEnhancementStatus = "not-requested" | "not-configured" | "enhanced" | "provider-error" | "invalid-response";
export type DecisionAiAgentStatus = "not-requested" | "not-configured" | "reviewed" | "provider-error" | "invalid-response";
export type DecisionAiAgentVerdict = "agree" | "downgrade" | "abstain" | "needs-data";
export type DecisionAiAgentAdjustment = "keep" | "lower" | "raise";
export type DecisionLearningProfileStatus = "active" | "shadow-only" | "demo-only" | "untrained" | "not-configured" | "failed";
export type EvidenceQuality = "strong" | "acceptable" | "thin" | "missing";
export type DecisionHealth = "stable" | "review" | "fragile";
export type AgentStageStatus = "passed" | "warning" | "failed";
export type ContradictionStatus = "clear" | "watch" | "conflict";
export type CalibrationAction = "trust" | "discount" | "abstain";
export type DecisionEvidenceCategory =
  | "model"
  | "market"
  | "form"
  | "team-news"
  | "lineups"
  | "live-state"
  | "weather"
  | "data-quality";
export type ContextSignalCategory = "injury" | "suspension" | "lineup" | "player-form" | "standings" | "weather" | "news" | "live-event" | "rest" | "surface";
export type ContextSignalImpact =
  | "home-positive"
  | "home-negative"
  | "away-positive"
  | "away-negative"
  | "tempo-up"
  | "tempo-down"
  | "neutral"
  | "unknown";

export interface Team {
  id: string;
  name: string;
  rating: number;
  /** Team crest URL from the fixture provider (API-Football), when available. */
  logo?: string | null;
  ratingEvidence?: {
    source: string;
    rawRating?: number | null;
    sampleSize?: number;
    asOf?: string | null;
    pace?: number | null;
    offensiveEfficiency?: number | null;
    defensiveEfficiency?: number | null;
    restDays?: number | null;
    recentFormPoints?: number | null;
    surface?: string | null;
    attackStrength?: number | null;
    defenseStrength?: number | null;
    rank?: number | null;
    rankingPoints?: number | null;
  };
}

export interface League {
  id: string;
  name: string;
  country: string;
  strength: number;
  /** League badge + country flag URLs from the fixture provider, when available. */
  logo?: string | null;
  flag?: string | null;
}

export interface Score {
  home: number;
  away: number;
  minute?: number;
}

export interface TeamForm {
  teamId: string;
  recentResults: Array<"W" | "D" | "L">;
  goalsFor: number;
  goalsAgainst: number;
  xgFor?: number | null;
  xgAgainst?: number | null;
  attackStrength: number;
  defenseStrength: number;
}

export interface OddsSelection {
  id: string;
  label: string;
  decimalOdds: number;
}

export interface OddsMarket {
  id:
    | "match_winner"
    | "over_under_15"
    | "over_under_25"
    | "both_teams_to_score"
    | "double_chance"
    | "draw_no_bet"
    | "spread"
    | "total_points"
    | "set_handicap"
    | "total_games";
  name: string;
  selections: OddsSelection[];
  bookmaker?: {
    id: string;
    name: string;
  };
}

export interface Match {
  id: string;
  sport: Sport;
  league: League;
  kickoffTime: string;
  homeTeam: Team;
  awayTeam: Team;
  venue?: {
    name?: string | null;
    city?: string | null;
    country?: string | null;
  };
  status: MatchStatus;
  score?: Score;
  oddsMarkets: OddsMarket[];
  homeForm: TeamForm;
  awayForm: TeamForm;
  dataQualityScore: number;
  providerContextSignals?: MatchContextSignal[];
  headToHead?: HeadToHeadSummary;
  leagueTable?: import("./leagueStandings").LeagueTable;
  dataSource?: {
    kind: "mock" | "provider";
    fixtureProvider?: string;
    fixtureProviderId?: string;
    season?: string;
    round?: string;
    oddsProvider?: string;
    oddsProviderEventId?: string;
    oddsCapturedAt?: string;
    formProvider?: string;
    strengthProvider?: string;
    fetchedAt?: string;
    /** Provider-native lifecycle status used by settlement policy (for example retired or walkover). */
    statusDetail?: string;
    notes?: string[];
  };
}

export interface HeadToHeadMeeting {
  id: string;
  kickoffTime: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

export interface HeadToHeadSummary {
  source: "api-football-headtohead";
  meetings: HeadToHeadMeeting[];
  homeWins: number;
  draws: number;
  awayWins: number;
  fetchedAt: string;
}

export interface PredictionMarket {
  marketId: OddsMarket["id"];
  probabilities: Record<string, number>;
}

export interface ExpectedGoals {
  home: number;
  away: number;
  total: number;
}

export interface ScorelineProbability {
  homeGoals: number;
  awayGoals: number;
  probability: number;
}

export interface FootballModelDiagnostics {
  modelVersion: string;
  scoreUnit?: "goals" | "points" | "sets" | "games";
  expectedScoreLabel?: string;
  topOutcomeLabel?: string;
  expectedGoals: ExpectedGoals;
  topCorrectScores: ScorelineProbability[];
  homeDrawAwayTotal: number;
  dataQualityScore: number;
  uncertainty: RiskLevel;
  signalScores: Array<{
    label: string;
    value: number;
    note: string;
  }>;
  calibrationNotes: string[];
}

export interface MatchContextSignal {
  id: string;
  category: ContextSignalCategory;
  label: string;
  detail: string;
  quality: EvidenceQuality;
  impact: ContextSignalImpact;
  confidence: number;
  weight: number;
  source: string;
  publishedAt?: string;
  items?: Array<{ team: string; player?: string; reason?: string; status: string }>;
}

export interface MatchContextAdjustment {
  summary: string;
  signals: MatchContextSignal[];
  probabilityShift: {
    home: number;
    draw?: number;
    away: number;
  };
  totalShift: number;
  dataQualityDelta: number;
  riskFlags: string[];
  missingSignals: string[];
  applied: boolean;
}

export interface MarketPriorAdjustment {
  applied: boolean;
  adjustedMarkets: number;
  adjustedSelections: number;
  averageWeight: number;
  averageBookmakerMargin: number | null;
  markets: Array<{
    marketId: OddsMarket["id"];
    selectionCount: number;
    bookmakerMargin: number;
    weight: number;
  }>;
  notes: string[];
}

export interface ValueEdge {
  marketId: OddsMarket["id"];
  selectionId: string;
  label: string;
  modelProbability: number;
  rawImpliedProbability: number;
  noVigImpliedProbability: number;
  impliedProbability: number;
  bookmakerMargin: number;
  edge: number;
  expectedValue: number;
  expectedRoi: number;
  odds: number;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  uncertaintyAdjustedScore?: number;
  scoreComponents?: {
    expectedValue: number;
    edge: number;
    probabilityStability: number;
    confidenceMultiplier: number;
    bookmakerMarginPenalty: number;
    oddsVolatilityPenalty: number;
    priceShorteningTolerance?: number | null;
    priceFragilityPenalty?: number;
    riskPenalty: number;
    caseMemoryPenalty?: number;
    caseMemorySimilarity?: number | null;
    caseMemoryAvoidShare?: number | null;
    caseMemoryReliability?: number | null;
    learnedMinimumEdge?: number | null;
    learnedValueEdgeWeight?: number | null;
    learnedDataQualityWeight?: number | null;
    learnedMarketAdjustmentWeight?: number | null;
  };
}

export interface BestPick extends ValueEdge {
  hasValue: true;
}

export interface NoValuePick {
  hasValue: false;
  label: "No clear value found";
}

export type BestPickResult = BestPick | NoValuePick;

export type DecisionSummaryPublicStatus =
  | "value_pick"
  | "lean"
  | "watchlist"
  | "no_clear_value"
  | "needs_data"
  | "stale"
  | "suspended";

export type DecisionSummaryEngineStatus =
  | "published"
  | "lean"
  | "watch"
  | "no-pick"
  | "needs-data"
  | "stale"
  | "suspended";

export type DecisionMarketAnalysisStatus =
  | "published_value_pick"
  | "lean"
  | "watchlist"
  | "no_clear_value"
  | "needs_data"
  | "stale"
  | "suspended";

export interface DecisionThresholdConfig {
  minimumValueEdge: number;
  minimumExpectedValue: number;
  minimumConfidenceForValuePick: ConfidenceLevel;
  minimumDataQuality: number;
  maximumOddsAgeMinutes: number;
  minimumOdds: number;
  maximumOdds: number;
  minimumKickoffLeadMinutes: number;
  maxMarketsPerFixture: number;
}

export interface DecisionMarketAnalysis extends ValueEdge {
  analysisStatus: DecisionMarketAnalysisStatus;
  oddsSnapshotId: string | null;
  oddsCapturedAt: string | null;
  expiresAt: string | null;
  dataQuality: number;
  evidenceQuality: EvidenceQuality;
  publicationEligible: boolean;
  blockers: string[];
}

export interface DecisionAuditSummary {
  /** Provenance is optional only for legacy rows created before atomic match-detail snapshots. */
  evidenceHash?: string;
  summaryHash?: string;
  modelVersion?: string;
  engineVersion?: string;
  thresholdProfile: Sport;
  thresholds: DecisionThresholdConfig;
  marketsAnalysed: number;
  publishedCandidates: number;
  leanCandidates: number;
  watchlistCandidates: number;
  staleCandidates: number;
  enginePublicationAllowed: boolean;
  providerBacked: boolean;
  contextSignalsSeen: number;
  blockers: string[];
  publicInvariantPassed: boolean;
}

export interface DecisionSummary {
  fixtureId: string;
  bestPublishedPick: DecisionMarketAnalysis | null;
  bestLean: DecisionMarketAnalysis | null;
  bestWatchlistCandidate: DecisionMarketAnalysis | null;
  noPickReason: string | null;
  allMarketAnalyses: DecisionMarketAnalysis[];
  publicStatus: DecisionSummaryPublicStatus;
  engineStatus: DecisionSummaryEngineStatus;
  dataQuality: number;
  evidenceQuality: EvidenceQuality;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  generatedAt: string;
  expiresAt: string | null;
  auditSummary: DecisionAuditSummary;
}

export interface LearnedProbabilityCalibrationAdjustment {
  status: "applied" | "inactive" | "insufficient-evidence";
  source: string | null;
  modelKey: string | null;
  bucketCount: number;
  totalBucketSample: number;
  calibratedMarkets: string[];
  meanAbsoluteShift: number;
  summary: string;
}

export interface Prediction {
  matchId: string;
  sport: Sport;
  generatedAt: string;
  evidenceHash: string;
  markets: PredictionMarket[];
  diagnostics: FootballModelDiagnostics;
  calibrationAdjustment?: LearnedProbabilityCalibrationAdjustment;
  contextAdjustment: MatchContextAdjustment;
  marketPriorAdjustment: MarketPriorAdjustment;
  valueEdges: ValueEdge[];
  canonicalDecision: DecisionSummary;
  bestPick: BestPickResult;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  explanation: MatchPredictionExplanation;
  agentReport: PredictionAgentReport;
  decision: DecisionEngineReport;
}

export interface MatchPredictionExplanation {
  summary: string;
  drivers: string[];
  disclaimer: string;
}

export interface PredictionAgentReport {
  verdict: AgentVerdict;
  summary: string;
  reasons: string[];
  cautions: string[];
  mathNotes: string[];
}

export interface DecisionEvidence {
  category: DecisionEvidenceCategory;
  label: string;
  quality: EvidenceQuality;
  impact: "positive" | "negative" | "neutral" | "unknown";
  detail: string;
}

export interface SaferAlternative {
  market: string;
  selection: string;
  modelProbability: number;
  fairOdds: number | null;
  rationale: string;
  risk: RiskLevel;
  availableInMvp: boolean;
}

export interface DecisionFactor {
  key: string;
  label: string;
  score: number;
  weight: number;
  weightedScore: number;
  explanation: string;
}

export interface DecisionSensitivityCheck {
  label: string;
  effect: "keeps-verdict" | "downgrades-verdict" | "upgrades-verdict" | "requires-review";
  detail: string;
}

export interface DecisionAgentStage {
  id: string;
  label: string;
  status: AgentStageStatus;
  score: number;
  detail: string;
}

export interface DecisionContradictionCheck {
  id: string;
  label: string;
  status: ContradictionStatus;
  detail: string;
}

export interface DecisionScenario {
  id: string;
  label: string;
  scoreImpact: number;
  projectedScore: number;
  projectedAction: DecisionAction;
  detail: string;
}

export type DecisionHypothesisStatus = "supported" | "contested" | "rejected" | "needs-data";
export type DecisionWatchPriority = "high" | "medium" | "low";
export type DecisionCommitteeRole =
  | "model-advocate"
  | "market-skeptic"
  | "context-scout"
  | "risk-manager"
  | "memory-analyst"
  | "final-arbiter";
export type DecisionCommitteeStance = "support" | "challenge" | "neutral" | "abstain";
export type DecisionCommitteeConsensus = "unanimous" | "leaning" | "split" | "blocked";
export type DecisionBeliefDirection = "supports" | "opposes" | "uncertain";
export type DecisionBeliefGrade = "strong" | "moderate" | "fragile";
export type DecisionConfidenceIntervalMethod = "wilson-calibration-bucket" | "unavailable";
export type DecisionMonitoringStatus = "active" | "watching" | "blocked" | "expired";
export type DecisionMonitoringPriority = "critical" | "high" | "medium" | "low";
export type DecisionActionabilityStatus = "actionable" | "watch-only" | "blocked";
export type DecisionActionabilityPosture = "show-value-candidate" | "keep-on-watchlist" | "avoid-recommendation";
export type DecisionActionabilityGateStatus = "pass" | "warn" | "fail";
export type DecisionReviewLoopStatus = "cleared" | "repaired" | "downgraded" | "blocked";
export type DecisionReviewLoopRole = "thesis-builder" | "red-team" | "data-gap-checker" | "repair-planner" | "final-reviewer";
export type DecisionReviewLoopVerdict = "support" | "challenge" | "repair" | "block";
export type DecisionResearchBriefStatus = "ready" | "watchlist" | "blocked";
export type DecisionNotebookStatus = "ready" | "needs-review" | "blocked";
export type DecisionNotebookItemStatus = "open" | "satisfied" | "blocked";
export type DecisionProbabilityTraceStatus = "ready" | "watchlist" | "blocked";
export type DecisionProbabilityTraceStepKind =
  | "market-prior"
  | "model-evidence"
  | "context"
  | "market-calibration"
  | "data-quality"
  | "case-memory"
  | "calibration"
  | "abstention"
  | "posterior";
export type DecisionProbabilityTraceStepStatus = "applied" | "skipped" | "clamped";
export type DecisionAttributionStatus = "supportive" | "mixed" | "blocked";
export type DecisionAttributionCategory = "model" | "market" | "context" | "data" | "memory" | "risk" | "calibration" | "price" | "operator";
export type DecisionAttributionDirection = "positive" | "negative" | "neutral";
export type DecisionUncertaintyStatus = "controlled" | "watchlist" | "high-risk";
export type DecisionUncertaintyLevel = "low" | "medium" | "high";
export type DecisionUncertaintyCategory = "model" | "market" | "data" | "context" | "price" | "timing" | "memory" | "robustness";
export type DecisionBoundaryStatus = "comfortable" | "near-flip" | "at-risk" | "blocked";
export type DecisionBoundaryMetricStatus = "safe" | "near" | "breached";
export type DecisionBoundaryMetricKind =
  | "probability-floor"
  | "odds-floor"
  | "edge-floor"
  | "ev-floor"
  | "score-floor"
  | "data-quality-floor"
  | "uncertainty-ceiling"
  | "context-shock"
  | "price-shortening";
export type DecisionAiProtocolStatus = "ready" | "needs-data" | "blocked" | "reviewed";
export type DecisionAiProtocolMode = "deterministic-public-audit" | "openai-review-ready" | "openai-reviewed";
export type DecisionAiProtocolQuestionStatus = "answered" | "needs-data" | "blocked";
export type DecisionAiProtocolCheckStatus = "pass" | "watch" | "fail";
export type DecisionAiProtocolToolStatus = "ready" | "missing" | "blocked";
export type DecisionReasoningGraphStatus = "coherent" | "contested" | "blocked";
export type DecisionReasoningNodeType =
  | "objective"
  | "model"
  | "market"
  | "data"
  | "context"
  | "risk"
  | "uncertainty"
  | "boundary"
  | "tool"
  | "review"
  | "action";
export type DecisionReasoningNodeStatus = "supporting" | "watch" | "blocking" | "neutral";
export type DecisionReasoningEdgeRelation = "supports" | "challenges" | "requires" | "blocks" | "updates";
export type DecisionOddsIntelligenceStatus = "positive-ev" | "watchlist" | "no-value";
export type DecisionOddsSelectionAction = "value" | "watch" | "avoid";
export type DecisionOddsMarketStatus = "value-found" | "efficient" | "overround-heavy" | "thin-model";
export type DecisionMarketMovementStatus = "resilient" | "sensitive" | "fragile" | "no-market";
export type DecisionDataCoverageStatus = "provider-backed" | "mock-backed" | "partial" | "insufficient";
export type DecisionDataSignalStatus = "provider-backed" | "computed" | "mock" | "missing" | "stale" | "not-applicable";
export type DecisionDataSignalCategory =
  | "fixtures"
  | "historical-results"
  | "standings"
  | "home-away"
  | "recent-form"
  | "injuries"
  | "suspensions"
  | "lineups"
  | "odds"
  | "live-scores"
  | "match-events"
  | "news"
  | "weather"
  | "training";
export type DecisionToolOrchestrationStatus = "ready" | "needs-tools" | "blocked";
export type DecisionToolTaskStatus = "ready" | "missing-config" | "waiting" | "blocked" | "complete";
export type DecisionToolTaskCategory = DecisionDataSignalCategory | "ai-review" | "memory";
export type DecisionToolExecutionStatus = "complete" | "partial" | "blocked";
export type DecisionToolExecutionAttemptStatus = "executed" | "blocked" | "waiting" | "skipped";
export type DecisionControlStatus = "publishable" | "monitor-only" | "needs-rerun" | "blocked";
export type DecisionControlVisibility = "public-candidate" | "watchlist-only" | "internal-only";
export type DecisionControlAutomationMode = "auto-monitor" | "operator-review" | "blocked";
export type DecisionControlGateStatus = "pass" | "watch" | "block";
export type DecisionControlGateSource = "model" | "market" | "data" | "tools" | "ai-review" | "risk" | "operator";
export type DecisionSupervisorQueueStatus = "clear" | "active" | "blocked";
export type DecisionSupervisorQueueItemType = "publish-candidate" | "control-gate" | "tool-task" | "ai-review" | "monitoring";
export type DecisionSupervisorQueueItemStatus = "ready" | "needs-rerun" | "blocked" | "waiting";
export type DecisionSupervisorRunbookStatus = "ready" | "waiting" | "blocked";
export type DecisionSupervisorRunbookMode = "read-only" | "dry-run" | "write-gated";
export type DecisionSupervisorRunbookStepStatus = "ready" | "requires-config" | "manual-review";
export type DecisionSupervisorRunbookPreflightStatus = "ready" | "warning" | "blocked";
export type DecisionSupervisorRunbookPreflightCheckStatus = "pass" | "warn" | "fail";
export type DecisionRobustnessStatus = "robust" | "sensitive" | "fragile";
export type DecisionRobustnessCaseStatus = "survives" | "downgrades" | "breaks";
export type DecisionEvaluationStatus = "track-value" | "watch-only" | "no-action";
export type DecisionEvaluationSignalStatus = "pending" | "required" | "optional";
export type DecisionAiEvidenceCheckStatus = "supports" | "opposes" | "uncertain" | "missing";
export type DecisionAiSafetyGateStatus = "pass" | "warn" | "block";

export interface DecisionBeliefSignal {
  id: string;
  label: string;
  direction: DecisionBeliefDirection;
  probabilityImpact: number;
  confidence: ConfidenceLevel;
  source: string;
  detail: string;
}

export interface DecisionBeliefState {
  status: "ready";
  grade: DecisionBeliefGrade;
  generatedAt: string;
  expiresAt: string;
  ttlMinutes: number;
  baseModelProbability: number | null;
  marketImpliedProbability: number | null;
  believedProbability: number | null;
  probabilityEdge: number | null;
  expectedValue: number | null;
  confidenceInterval: {
    low: number | null;
    high: number | null;
    method: DecisionConfidenceIntervalMethod;
    confidenceLevel: number | null;
    sampleSize: number | null;
    source: string | null;
    detail: string;
  };
  uncertaintyScore: number;
  evidenceBalance: {
    supports: number;
    opposes: number;
    uncertain: number;
  };
  signals: DecisionBeliefSignal[];
  invalidationTriggers: string[];
  summary: string;
}

export interface DecisionHypothesis {
  id: string;
  label: string;
  status: DecisionHypothesisStatus;
  confidence: ConfidenceLevel;
  detail: string;
  support: string[];
  challenge: string[];
  decisionImpact: string;
}

export interface DecisionWatchItem {
  id: string;
  label: string;
  priority: DecisionWatchPriority;
  signalType: DecisionEvidenceCategory | ContextSignalCategory | "odds" | "training";
  whyItMatters: string;
  actionIfConfirmed: string;
}

export type DecisionMonitoringSource = DecisionWatchItem["signalType"] | "market" | "memory" | "calibration" | "provider";

export interface DecisionMonitoringTask {
  id: string;
  label: string;
  priority: DecisionMonitoringPriority;
  dueAt: string;
  trigger: string;
  action: string;
  source: DecisionMonitoringSource;
}

export interface DecisionMonitoringPlan {
  status: DecisionMonitoringStatus;
  priority: DecisionMonitoringPriority;
  nextReviewAt: string;
  reviewCadenceMinutes: number;
  summary: string;
  tasks: DecisionMonitoringTask[];
  stopConditions: string[];
  escalationRules: string[];
}

export interface DecisionActionabilityGate {
  id: string;
  label: string;
  status: DecisionActionabilityGateStatus;
  score: number;
  weight: number;
  detail: string;
  requiredAction: string | null;
}

export interface DecisionActionabilityAudit {
  status: DecisionActionabilityStatus;
  posture: DecisionActionabilityPosture;
  score: number;
  summary: string;
  gates: DecisionActionabilityGate[];
  blockers: string[];
  warnings: string[];
  requiredBeforeAction: string[];
  responsibleUse: string[];
}

export interface DecisionReviewLoopStep {
  id: string;
  role: DecisionReviewLoopRole;
  verdict: DecisionReviewLoopVerdict;
  confidence: ConfidenceLevel;
  summary: string;
  evidence: string[];
  requiredChange: string | null;
}

export interface DecisionReviewLoop {
  status: DecisionReviewLoopStatus;
  initialAction: DecisionAction;
  recommendedAction: DecisionAction;
  confidenceShift: "keep" | "lower";
  riskShift: "keep" | "raise";
  scoreDelta: number;
  summary: string;
  steps: DecisionReviewLoopStep[];
  repairsApplied: string[];
  unresolvedIssues: string[];
  releaseCriteria: string[];
}

export interface DecisionOddsSelectionAudit {
  marketId: OddsMarket["id"];
  selectionId: string;
  label: string;
  action: DecisionOddsSelectionAction;
  odds: number;
  fairOdds: number | null;
  modelProbability: number;
  rawImpliedProbability: number;
  noVigImpliedProbability: number;
  bookmakerMargin: number;
  edge: number;
  expectedValue: number;
  uncertaintyAdjustedScore?: number | null;
  priceShorteningTolerance?: number | null;
  priceFragilityPenalty?: number | null;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  reason: string;
}

export interface DecisionOddsMarketAudit {
  marketId: OddsMarket["id"];
  marketName: string;
  status: DecisionOddsMarketStatus;
  bookmakerMargin: number;
  selectionCount: number;
  positiveEdgeCount: number;
  positiveExpectedValueCount: number;
  bestSelection: DecisionOddsSelectionAudit | null;
  summary: string;
  selections: DecisionOddsSelectionAudit[];
}

export interface DecisionOddsIntelligence {
  status: DecisionOddsIntelligenceStatus;
  totalMarkets: number;
  totalSelections: number;
  positiveEdgeSelections: number;
  positiveExpectedValueSelections: number;
  actionableSelections: number;
  averageBookmakerMargin: number | null;
  bestSelection: DecisionOddsSelectionAudit | null;
  bestActionableSelection: DecisionOddsSelectionAudit | null;
  bestWatchlistSelection: DecisionOddsSelectionAudit | null;
  topCandidates: DecisionOddsSelectionAudit[];
  marketAudits: DecisionOddsMarketAudit[];
  avoidReasons: string[];
  watchlistReasons: string[];
  summary: string;
}

export interface DecisionMarketMovementScenario {
  id: string;
  label: string;
  odds: number | null;
  modelProbability: number | null;
  noVigImpliedProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  actionAfterMove: DecisionAction;
  detail: string;
}

export interface DecisionMarketMovement {
  status: DecisionMarketMovementStatus;
  summary: string;
  selection: string | null;
  marketId: OddsMarket["id"] | null;
  currentOdds: number | null;
  fairOdds: number | null;
  breakEvenProbability: number | null;
  noVigImpliedProbability: number | null;
  currentEdge: number | null;
  currentExpectedValue: number | null;
  oddsBuffer: number | null;
  maxShorteningBeforeNoValue: number | null;
  targetClosingLineValue: number | null;
  scenarios: DecisionMarketMovementScenario[];
  alerts: string[];
  nextAction: string;
}

export interface DecisionDataCoverageSignal {
  id: string;
  category: DecisionDataSignalCategory;
  label: string;
  status: DecisionDataSignalStatus;
  source: string;
  freshness: "current" | "pre-match" | "historical" | "stale" | "mock" | "missing" | "not-applicable";
  weight: number;
  detail: string;
  requiredForProduction: boolean;
}

export interface DecisionDataCoverageAudit {
  status: DecisionDataCoverageStatus;
  score: number;
  providerBackedSignals: number;
  computedSignals: number;
  mockSignals: number;
  missingSignals: number;
  staleSignals: number;
  totalSignals: number;
  summary: string;
  signals: DecisionDataCoverageSignal[];
  requiredBeforeTrust: string[];
}

export type DecisionHistoricalDisciplineStatus =
  | "not-attached"
  | "not-applicable"
  | "diagnostic-only"
  | "market-prior-dominant"
  | "provider-retest-ready"
  | "blocked";

export interface DecisionHistoricalDiscipline {
  status: DecisionHistoricalDisciplineStatus;
  attached: boolean;
  source: string | null;
  seasons: string | null;
  fixtures: number;
  oddsRows: number;
  bookmakerMarkets: number;
  diagnosticScore: number;
  benchmarkVerdict: string | null;
  trustEffect: "none" | "diagnostic-context" | "cap-raw-edge" | "queue-provider-retest" | "block";
  cappedByMarketPrior: boolean;
  summary: string;
  instruction: string;
  requiredBeforePromotion: string[];
  proofUrls: string[];
}

export interface DecisionRobustnessCase {
  id: string;
  label: string;
  status: DecisionRobustnessCaseStatus;
  probabilityShift: number;
  edgeAfterShock: number | null;
  expectedValueAfterShock: number | null;
  actionAfterShock: DecisionAction;
  detail: string;
  repair: string;
}

export interface DecisionRobustnessAudit {
  status: DecisionRobustnessStatus;
  score: number;
  survivalRate: number;
  worstCase: DecisionRobustnessCase;
  summary: string;
  cases: DecisionRobustnessCase[];
  hedgeSuggestions: string[];
  requiredRechecks: string[];
}

export interface DecisionEvaluationSignal {
  id: string;
  label: string;
  status: DecisionEvaluationSignalStatus;
  source: "result" | "closing-odds" | "market" | "context" | "calibration" | "operator";
  detail: string;
}

export interface DecisionEvaluationPlan {
  status: DecisionEvaluationStatus;
  settlementMarket: string | null;
  settlementSelection: string | null;
  modelProbability: number | null;
  noVigMarketProbability: number | null;
  breakEvenProbability: number | null;
  quotedOdds: number | null;
  valueEdge: number | null;
  expectedValue: number | null;
  targetClosingLineValue: number | null;
  summary: string;
  successCriteria: string[];
  failureCriteria: string[];
  learningQuestions: string[];
  requiredOutcomeSignals: DecisionEvaluationSignal[];
  postMatchActions: string[];
}

export interface DecisionResearchBrief {
  status: DecisionResearchBriefStatus;
  headline: string;
  executiveSummary: string;
  modelThesis: string;
  marketThesis: string;
  riskThesis: string;
  dataGaps: string[];
  requiredChecks: string[];
  evidenceTrail: string[];
  analystPosture: string;
  decisionClock: string;
}

export interface DecisionNotebookItem {
  id: string;
  label: string;
  priority: DecisionMonitoringPriority;
  status: DecisionNotebookItemStatus;
  source: "model" | "market" | "context" | "risk" | "memory" | "operator" | "training" | "settlement";
  detail: string;
  action: string;
  dueAt: string | null;
}

export interface DecisionNotebook {
  status: DecisionNotebookStatus;
  summary: string;
  assumptions: DecisionNotebookItem[];
  falsifiers: DecisionNotebookItem[];
  refreshTriggers: DecisionNotebookItem[];
  operatorChecklist: DecisionNotebookItem[];
  auditTrail: string[];
  nextReviewAt: string;
}

export interface DecisionProbabilityTraceStep {
  id: string;
  kind: DecisionProbabilityTraceStepKind;
  label: string;
  status: DecisionProbabilityTraceStepStatus;
  priorProbability: number | null;
  posteriorProbability: number | null;
  probabilityDelta: number | null;
  logOddsDelta: number;
  weight: number;
  confidence: ConfidenceLevel;
  detail: string;
}

export interface DecisionProbabilityTrace {
  status: DecisionProbabilityTraceStatus;
  summary: string;
  selection: string | null;
  marketId: OddsMarket["id"] | null;
  basePriorProbability: number | null;
  modelProbability: number | null;
  posteriorProbability: number | null;
  posteriorEdge: number | null;
  posteriorExpectedValue: number | null;
  disagreement: number | null;
  confidenceBand: {
    low: number | null;
    high: number | null;
  };
  clampRange: {
    min: number;
    max: number;
  };
  steps: DecisionProbabilityTraceStep[];
  conflicts: string[];
  safeguards: string[];
}

export interface DecisionAttributionDriver {
  id: string;
  category: DecisionAttributionCategory;
  label: string;
  direction: DecisionAttributionDirection;
  impactScore: number;
  probabilityImpact: number | null;
  detail: string;
}

export interface DecisionAttribution {
  status: DecisionAttributionStatus;
  summary: string;
  decisiveFactor: string;
  netProbabilityMovement: number | null;
  modelMarketGap: number | null;
  valueScore: number;
  riskScore: number;
  positiveDrivers: DecisionAttributionDriver[];
  negativeDrivers: DecisionAttributionDriver[];
  neutralDrivers: DecisionAttributionDriver[];
  missingDataDrag: DecisionAttributionDriver[];
  explanation: string;
}

export interface DecisionUncertaintyComponent {
  id: string;
  category: DecisionUncertaintyCategory;
  label: string;
  level: DecisionUncertaintyLevel;
  score: number;
  weight: number;
  contribution: number;
  detail: string;
  mitigation: string;
}

export interface DecisionUncertaintyDecomposition {
  status: DecisionUncertaintyStatus;
  score: number;
  method: "weighted-evidence-risk-index-v1";
  statistical: false;
  summary: string;
  primaryUncertainty: string;
  confidencePenalty: number;
  components: DecisionUncertaintyComponent[];
  mitigations: string[];
  decisionImpact: string;
}

export interface DecisionBoundaryMetric {
  id: string;
  kind: DecisionBoundaryMetricKind;
  label: string;
  current: number | null;
  threshold: number | null;
  margin: number | null;
  status: DecisionBoundaryMetricStatus;
  detail: string;
}

export interface DecisionBoundary {
  status: DecisionBoundaryStatus;
  summary: string;
  nearestFlip: string;
  flipMargin: number | null;
  metrics: DecisionBoundaryMetric[];
  requiredToStayConsider: string[];
  flipTriggers: string[];
  nextAction: string;
}

export interface DecisionAiProtocolQuestion {
  id: string;
  prompt: string;
  status: DecisionAiProtocolQuestionStatus;
  answer: string;
  evidenceIds: string[];
  followUp: string | null;
}

export interface DecisionAiProtocolCheck {
  id: string;
  label: string;
  status: DecisionAiProtocolCheckStatus;
  detail: string;
  evidenceIds: string[];
}

export interface DecisionAiProtocolEvidenceRef {
  id: string;
  label: string;
  source: string;
  claim: string;
}

export interface DecisionAiProtocolToolRequest {
  id: string;
  label: string;
  priority: DecisionMonitoringPriority;
  status: DecisionAiProtocolToolStatus;
  provider: string;
  reason: string;
  unlocks: string;
}

export interface DecisionAiProtocol {
  status: DecisionAiProtocolStatus;
  mode: DecisionAiProtocolMode;
  summary: string;
  objective: string;
  questions: DecisionAiProtocolQuestion[];
  checks: DecisionAiProtocolCheck[];
  evidenceRefs: DecisionAiProtocolEvidenceRef[];
  toolRequests: DecisionAiProtocolToolRequest[];
  guardrails: string[];
  reviewerInstructions: string;
}

export interface DecisionReasoningNode {
  id: string;
  type: DecisionReasoningNodeType;
  label: string;
  status: DecisionReasoningNodeStatus;
  strength: number;
  detail: string;
  evidenceIds: string[];
}

export interface DecisionReasoningEdge {
  id: string;
  from: string;
  to: string;
  relation: DecisionReasoningEdgeRelation;
  weight: number;
  detail: string;
}

export interface DecisionReasoningGraph {
  status: DecisionReasoningGraphStatus;
  summary: string;
  entryNodeId: string;
  decisionNodeId: string;
  nodes: DecisionReasoningNode[];
  edges: DecisionReasoningEdge[];
  strongestPath: string[];
  blockingPath: string[];
  unresolvedNodes: string[];
}

export interface DecisionToolTask {
  id: string;
  category: DecisionToolTaskCategory;
  label: string;
  priority: DecisionMonitoringPriority;
  status: DecisionToolTaskStatus;
  provider: string;
  dependsOn: string[];
  freshnessMinutes: number | null;
  reason: string;
  unlocks: string;
  decisionImpact: string;
}

export interface DecisionToolOrchestrationPlan {
  status: DecisionToolOrchestrationStatus;
  summary: string;
  readinessScore: number;
  nextTaskId: string | null;
  tasks: DecisionToolTask[];
  executionOrder: string[];
  blockingTasks: string[];
  readyTasks: string[];
  staleAfterMinutes: number | null;
}

export interface DecisionToolExecutionAttempt {
  id: string;
  taskId: string;
  label: string;
  category: DecisionToolTaskCategory;
  status: DecisionToolExecutionAttemptStatus;
  provider: string;
  priority: DecisionMonitoringPriority;
  observedRecords: number | null;
  outputSignals: string[];
  startedAt: string;
  completedAt: string | null;
  detail: string;
  decisionDelta: string;
  nextAction: string;
}

export interface DecisionToolExecutionAudit {
  status: DecisionToolExecutionStatus;
  mode: "deterministic-local-audit" | "openai-reviewed";
  generatedAt: string;
  summary: string;
  totalTasks: number;
  executedTasks: number;
  blockedTasks: number;
  waitingTasks: number;
  skippedTasks: number;
  attempts: DecisionToolExecutionAttempt[];
  nextRun: string;
  publicLog: string[];
}

export interface DecisionControlGate {
  id: string;
  label: string;
  source: DecisionControlGateSource;
  status: DecisionControlGateStatus;
  detail: string;
  requiredAction: string | null;
}

export interface DecisionControlPolicy {
  status: DecisionControlStatus;
  visibility: DecisionControlVisibility;
  automationMode: DecisionControlAutomationMode;
  publishAllowed: boolean;
  persistAllowed: boolean;
  aiReviewRequired: boolean;
  rerunRequired: boolean;
  safeToDisplay: boolean;
  primaryBlockerId: string | null;
  summary: string;
  primaryDirective: string;
  nextBestAction: string;
  gates: DecisionControlGate[];
  allowedActions: string[];
  forbiddenActions: string[];
  releaseCriteria: string[];
}

export interface DecisionSupervisorQueueItem {
  id: string;
  matchId: string;
  match: string;
  sport: Sport;
  league: string;
  country: string;
  kickoffTime: string;
  type: DecisionSupervisorQueueItemType;
  priority: DecisionMonitoringPriority;
  status: DecisionSupervisorQueueItemStatus;
  source: string;
  label: string;
  action: string;
  detail: string;
  controlStatus: DecisionControlStatus;
  visibility: DecisionControlVisibility;
  publishAllowed: boolean;
  readinessScore: number;
  blockedTasks: number;
  evidencePath: string;
}

export interface DecisionSupervisorRunbookStep {
  id: string;
  label: string;
  status: DecisionSupervisorRunbookStepStatus;
  method: "GET" | "POST";
  url: string;
  command: string;
  requiresAdminToken: boolean;
  requiredEnv: string[];
  detail: string;
  expectedResult: string;
}

export interface DecisionSupervisorRunbookPreflightCheck {
  id: string;
  label: string;
  status: DecisionSupervisorRunbookPreflightCheckStatus;
  detail: string;
  requiredAction: string | null;
}

export interface DecisionSupervisorRunbookPreflight {
  status: DecisionSupervisorRunbookPreflightStatus;
  canRunPrimaryCommand: boolean;
  missingEnv: string[];
  warnings: string[];
  checks: DecisionSupervisorRunbookPreflightCheck[];
  summary: string;
}

export interface DecisionSupervisorRunbook {
  generatedAt: string;
  status: DecisionSupervisorRunbookStatus;
  mode: DecisionSupervisorRunbookMode;
  targetItemId: string | null;
  title: string;
  summary: string;
  primaryCommand: string | null;
  preflight: DecisionSupervisorRunbookPreflight;
  steps: DecisionSupervisorRunbookStep[];
  safetyChecks: string[];
  expectedStateChange: string;
  abortConditions: string[];
}

export interface DecisionSupervisorQueue {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionSupervisorQueueStatus;
  summary: string;
  totalMatches: number;
  publishable: number;
  monitorOnly: number;
  needsRerun: number;
  blocked: number;
  aiReviewRequired: number;
  toolBlocked: number;
  nextItem: DecisionSupervisorQueueItem | null;
  runbook: DecisionSupervisorRunbook;
  items: DecisionSupervisorQueueItem[];
}

export interface DecisionAiEvidenceCheck {
  id: string;
  label: string;
  status: DecisionAiEvidenceCheckStatus;
  citedEvidenceIds: string[];
  finding: string;
  requiredFollowUp: string | null;
}

export interface DecisionAiSafetyGate {
  id: string;
  label: string;
  status: DecisionAiSafetyGateStatus;
  reason: string;
}

export interface DecisionAiAgentAudit {
  auditSummary: string;
  evidenceChecks: DecisionAiEvidenceCheck[];
  safetyGates: DecisionAiSafetyGate[];
  citedEvidenceIds: string[];
  unsupportedClaims: string[];
}

export interface DecisionDeliberation {
  primaryThesis: string;
  dissentingThesis: string;
  synthesis: string;
  hypotheses: DecisionHypothesis[];
  watchItems: DecisionWatchItem[];
  decisionIfMissingDataTurnsBad: string;
  decisionIfMarketMoves: string;
}

export interface DecisionCommitteeMember {
  id: string;
  role: DecisionCommitteeRole;
  label: string;
  stance: DecisionCommitteeStance;
  vote: DecisionAction;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  thesis: string;
  evidence: string[];
  objections: string[];
  requiredChecks: string[];
}

export interface DecisionCommittee {
  status: "ready";
  consensus: DecisionCommitteeConsensus;
  recommendedAction: DecisionAction;
  voteCounts: {
    consider: number;
    monitor: number;
    avoid: number;
  };
  members: DecisionCommitteeMember[];
  finalRationale: string;
  unresolvedDisagreements: string[];
  guardrailNotes: string[];
}

export interface DecisionAbstentionRule {
  id: string;
  label: string;
  triggered: boolean;
  detail: string;
}

export interface DecisionCalibration {
  reliabilityScore: number;
  health: DecisionHealth;
  action: CalibrationAction;
  detail: string;
}

export interface DecisionLearningProfile {
  status: DecisionLearningProfileStatus;
  source: string | null;
  active: boolean;
  modelKey?: string | null;
  engineVersion?: string | null;
  calibrationPromotion?: {
    id: string;
    candidateId: string;
    approvedAt: string;
    expiresAt: string | null;
  } | null;
  sampleSize: number;
  realFinishedFixtures: number;
  minimumRecommendedFixtures: number;
  minimumEdge: number | null;
  valueEdgeWeight: number | null;
  dataQualityWeight: number | null;
  marketAdjustmentWeight: number | null;
  homeAdvantageElo: number | null;
  brierScore: number | null;
  yield: number | null;
  closingLineValue: number | null;
  calibrationBuckets?: Array<{
    minProbability: number;
    maxProbability: number;
    sampleSize: number;
    averageProbability: number;
    observedRate: number;
    calibrationError: number;
  }>;
  generatedAt: string;
  reason: string;
  notes: string[];
}

export type DecisionCaseMemoryStatus = "ready" | "not-configured" | "no-memory" | "failed";
export type DecisionCaseMemoryAdjustment = "none" | "discount" | "abstain";

export interface DecisionSimilarCase {
  id: string;
  fixtureExternalId: string;
  similarity: number;
  verdict: DecisionVerdict;
  action: DecisionAction;
  health: DecisionHealth;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  decisionScore: number;
  reliabilityScore: number | null;
  recommendedSelection: string | null;
  expectedValue: number | null;
  edge: number | null;
  createdAt: string;
  rationale: string;
}

export interface DecisionCaseMemory {
  status: DecisionCaseMemoryStatus;
  configured: boolean;
  sampleSize: number;
  similarCases: DecisionSimilarCase[];
  actionMix: {
    consider: number;
    monitor: number;
    avoid: number;
  };
  averageSimilarity: number | null;
  averageReliabilityScore: number | null;
  averageDecisionScore: number | null;
  adjustment: DecisionCaseMemoryAdjustment;
  summary: string;
  notes: string[];
}

export interface DecisionCaseMemoryRun {
  id: string;
  fixtureExternalId: string;
  sport: Sport;
  verdict: DecisionVerdict;
  action: DecisionAction;
  health: DecisionHealth;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  decisionScore: number;
  reliabilityScore: number | null;
  recommendedSelection: string | null;
  bestPick: BestPickResult;
  modelKey: string | null;
  createdAt: string;
}

export interface DecisionCaseMemoryBank {
  generatedAt: string;
  status: DecisionCaseMemoryStatus;
  configured: boolean;
  projectRef: string | null;
  runs: DecisionCaseMemoryRun[];
  reason?: string;
}

export interface DecisionEngineReport {
  engineVersion: string;
  verdict: DecisionVerdict;
  action: DecisionAction;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  decisionScore: number;
  recommendedSelection: string | null;
  summary: string;
  health: DecisionHealth;
  calibration: DecisionCalibration;
  probabilityCalibration?: LearnedProbabilityCalibrationAdjustment;
  learningProfile?: DecisionLearningProfile;
  caseMemory: DecisionCaseMemory;
  contextAdjustment?: MatchContextAdjustment;
  marketPriorAdjustment?: MarketPriorAdjustment;
  agentStages: DecisionAgentStage[];
  contradictionChecks: DecisionContradictionCheck[];
  scenarioMatrix: DecisionScenario[];
  beliefState: DecisionBeliefState;
  deliberation: DecisionDeliberation;
  committee: DecisionCommittee;
  monitoringPlan: DecisionMonitoringPlan;
  actionability: DecisionActionabilityAudit;
  reviewLoop: DecisionReviewLoop;
  researchBrief: DecisionResearchBrief;
  notebook: DecisionNotebook;
  probabilityTrace: DecisionProbabilityTrace;
  attribution: DecisionAttribution;
  uncertainty: DecisionUncertaintyDecomposition;
  decisionBoundary: DecisionBoundary;
  aiProtocol: DecisionAiProtocol;
  reasoningGraph: DecisionReasoningGraph;
  toolOrchestration: DecisionToolOrchestrationPlan;
  toolExecution: DecisionToolExecutionAudit;
  controlPolicy: DecisionControlPolicy;
  oddsIntelligence: DecisionOddsIntelligence;
  marketMovement: DecisionMarketMovement;
  dataCoverage: DecisionDataCoverageAudit;
  historicalDiscipline: DecisionHistoricalDiscipline;
  robustness: DecisionRobustnessAudit;
  evaluationPlan: DecisionEvaluationPlan;
  abstentionRules: DecisionAbstentionRule[];
  factors: DecisionFactor[];
  sensitivityChecks: DecisionSensitivityCheck[];
  publicReasoningSteps: string[];
  evidence: DecisionEvidence[];
  risks: string[];
  avoidReasons: string[];
  saferAlternatives: SaferAlternative[];
  missingSignals: string[];
  nextChecks: string[];
  llmEnhanced: boolean;
  llmModel?: string;
  llmStatus?: DecisionEnhancementStatus;
  llmFailureReason?: string;
  aiAgentReviewed?: boolean;
  aiAgentStatus?: DecisionAiAgentStatus;
  aiAgentModel?: string;
  aiAgentVerdict?: DecisionAiAgentVerdict;
  aiAgentSummary?: string;
  aiAgentAudit?: DecisionAiAgentAudit;
}

export interface DecisionEnhancementResult {
  requested: boolean;
  provider: "deterministic" | "openai";
  status: DecisionEnhancementStatus;
  decision: DecisionEngineReport;
  model?: string;
  reason?: string;
}

export interface DecisionAiAgentReview {
  reviewVerdict: DecisionAiAgentVerdict;
  recommendedAction: DecisionAction;
  confidenceAdjustment: Exclude<DecisionAiAgentAdjustment, "raise">;
  riskAdjustment: Exclude<DecisionAiAgentAdjustment, "lower">;
  summary: string;
  rationale: string[];
  riskFlags: string[];
  dataGaps: string[];
  saferAlternatives: string[];
  checksBeforeAction: string[];
  auditSummary: string;
  evidenceChecks: DecisionAiEvidenceCheck[];
  safetyGates: DecisionAiSafetyGate[];
  unsupportedClaims: string[];
}

export interface DecisionAiAgentResult {
  requested: boolean;
  provider: "deterministic" | "openai";
  status: DecisionAiAgentStatus;
  decision: DecisionEngineReport;
  review: DecisionAiAgentReview | null;
  model?: string;
  reason?: string;
}

export interface PredictionHistoryItem {
  id: string;
  date: string;
  match: string;
  pick: string;
  odds: number;
  modelProbability: number;
  edge: number;
  result: PredictionResult;
}

export interface ProviderResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface SportsDataProvider {
  getFixtures(date: string, sport: Sport): Promise<Match[]>;
  getMatch(matchId: string): Promise<Match | null>;
  getLiveScores(date: string, sport: Sport): Promise<Match[]>;
  getOdds(matchId: string): Promise<OddsMarket[]>;
  getTeamForm(teamId: string): Promise<TeamForm>;
}
