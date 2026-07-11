import type { DecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import type { DecisionDataAuthority, DecisionDataAuthorityFamily } from "@/lib/sports/prediction/decisionDataAuthority";
import type { DecisionEnvActivationMatrix } from "@/lib/sports/prediction/decisionEnvActivationMatrix";
import type { DecisionModelMathProof, DecisionModelMathSportProof } from "@/lib/sports/prediction/decisionModelMathProof";
import type { DecisionModelCards } from "@/lib/sports/prediction/decisionModelCards";
import type { DecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { TrainingCorpusProof } from "@/lib/sports/training/trainingCorpusProof";
import type { DecisionDataSignalCategory } from "@/lib/sports/types";

export type DecisionOriginalBriefCoverageStatus = "real" | "shadow" | "blocked";
export type DecisionOriginalBriefCoverageSectionId =
  | "data-layer"
  | "prediction-engine"
  | "odds-intelligence"
  | "ai-explanation"
  | "training-corpus"
  | "deployment-storage"
  | "safety-controls";

export type DecisionOriginalBriefCoverageItem = {
  id: string;
  section: DecisionOriginalBriefCoverageSectionId;
  label: string;
  requirement: string;
  status: DecisionOriginalBriefCoverageStatus;
  evidence: string;
  blocker: string | null;
  nextAction: string;
  proofUrl: string;
};

export type DecisionOriginalBriefCoverageSection = {
  id: DecisionOriginalBriefCoverageSectionId;
  label: string;
  status: DecisionOriginalBriefCoverageStatus;
  counts: Record<DecisionOriginalBriefCoverageStatus, number>;
  items: DecisionOriginalBriefCoverageItem[];
};

export type DecisionOriginalBriefCoverage = {
  mode: "original-brief-coverage";
  generatedAt: string;
  status: DecisionOriginalBriefCoverageStatus;
  coverageHash: string;
  summary: string;
  counts: Record<DecisionOriginalBriefCoverageStatus, number>;
  sections: DecisionOriginalBriefCoverageSection[];
  topGap: DecisionOriginalBriefCoverageItem | null;
  nextSafeCommand: {
    label: string;
    command: string | null;
    proofUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canRunOpenAIReview: boolean;
    canWriteSecrets: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

const SECTION_LABELS: Record<DecisionOriginalBriefCoverageSectionId, string> = {
  "data-layer": "Data layer",
  "prediction-engine": "Prediction engine",
  "odds-intelligence": "Odds intelligence",
  "ai-explanation": "AI explanation",
  "training-corpus": "10-year training corpus",
  "deployment-storage": "Supabase and Netlify",
  "safety-controls": "Responsible controls"
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

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function countsFor(items: DecisionOriginalBriefCoverageItem[]): Record<DecisionOriginalBriefCoverageStatus, number> {
  return {
    real: items.filter((item) => item.status === "real").length,
    shadow: items.filter((item) => item.status === "shadow").length,
    blocked: items.filter((item) => item.status === "blocked").length
  };
}

function statusFromCounts(counts: Record<DecisionOriginalBriefCoverageStatus, number>): DecisionOriginalBriefCoverageStatus {
  if (counts.blocked > 0) return "blocked";
  if (counts.shadow > 0) return "shadow";
  return "real";
}

function item(input: DecisionOriginalBriefCoverageItem): DecisionOriginalBriefCoverageItem {
  return input;
}

function dataStatus(family: DecisionDataAuthorityFamily | undefined): DecisionOriginalBriefCoverageStatus {
  if (!family) return "blocked";
  if (family.status === "live-authorized") return "real";
  if (family.status === "computed-shadow" || family.status === "dry-run-ready") return "shadow";
  return "blocked";
}

function dataEvidence(family: DecisionDataAuthorityFamily | undefined): string {
  if (!family) return "No data-authority family currently maps this requirement.";
  return `${family.status}; live use ${family.liveDecisionUse}; training use ${family.trainingUse}; ${family.affectedMatches} affected match(es).`;
}

function dataBlocker(family: DecisionDataAuthorityFamily | undefined): string | null {
  if (!family || family.blockers.length) return family?.blockers.join(", ") || "provider or proof mapping missing";
  if (family.missingEnv.length) return `missing env: ${family.missingEnv.join(", ")}`;
  if (family.storageMissing.length) return `storage proof missing: ${family.storageMissing.join(", ")}`;
  return null;
}

function dataItem(
  authority: DecisionDataAuthority,
  category: DecisionDataSignalCategory,
  id: string,
  label: string,
  requirement: string
): DecisionOriginalBriefCoverageItem {
  const family = authority.families.find((candidate) => candidate.category === category);
  const status = dataStatus(family);
  return item({
    id,
    section: "data-layer",
    label,
    requirement,
    status,
    evidence: dataEvidence(family),
    blocker: status === "real" ? null : dataBlocker(family),
    nextAction: status === "real" ? "Keep this signal fresh before decision windows." : family?.expectedEvidence ?? "Connect the provider feed and rerun data authority.",
    proofUrl: family?.verifyUrl ?? "/api/sports/decision/data-authority"
  });
}

function modelItem(
  modelCards: DecisionModelCards,
  modelMathProof: DecisionModelMathProof | null,
  sport: "football" | "basketball" | "tennis",
  label: string,
  requirement: string
): DecisionOriginalBriefCoverageItem {
  const card = modelCards.cards.find((candidate) => candidate.sport === sport);
  const math = modelMathProof?.sports.find((candidate) => candidate.sport === sport) ?? null;
  const status: DecisionOriginalBriefCoverageStatus = !card || card.status === "blocked" || math?.status === "blocked"
    ? "blocked"
    : math && (math.status === "needs-provider" || math.blockedProviderFeeds > 0 || math.proxyOrMissingInputs.length > 0)
      ? "shadow"
      : "real";
  const mathEvidence = math
    ? ` Math proof ${math.status}; ${math.formulas.length} formula(s); ${math.blockedProviderFeeds} blocked provider feed gate(s).`
    : "";
  return item({
    id: `model-${sport}`,
    section: "prediction-engine",
    label,
    requirement,
    status,
    evidence: card
      ? `${card.modelVersion}; ${card.formulas.length} formula(s), ${card.markets.length} market family/families, governance ${card.governance.status}.${mathEvidence}`
      : "No model card exists for this sport.",
    blocker:
      status === "real"
        ? null
        : math?.blockedProviderFeeds
          ? `${math.blockedProviderFeeds} provider feed gate(s): ${math.providerFeedGates
              .filter((feed) => feed.status === "missing-critical")
              .slice(0, 3)
              .map((feed) => feed.label)
              .join(", ")}`
          : card?.status === "blocked" || !card
            ? card?.governance.topChecks.find((check) => check.status === "fail")?.requiredAction ?? "model card missing"
            : math?.proxyOrMissingInputs[0] ?? null,
    nextAction:
      status === "real"
        ? "Keep model math, provider feeds, odds, and calibration fresh before decision windows."
        : math?.providerFeedGates.find((feed) => feed.status === "missing-critical")?.proofUrl
          ? "Clear the blocked provider feed gates shown by the model math proof."
          : card?.upgradePath[0] ?? "Create a model card and proof route for this sport.",
    proofUrl: math ? "/api/sports/decision/model-math-proof" : "/api/sports/decision/model-cards?sport=all"
  });
}

function oddsItem(
  proof: DecisionOddsIntelligenceProof,
  checkId: DecisionOddsIntelligenceProof["proofChecks"][number]["id"],
  label: string,
  requirement: string
): DecisionOriginalBriefCoverageItem {
  const check = proof.proofChecks.find((candidate) => candidate.id === checkId);
  const status: DecisionOriginalBriefCoverageStatus = check?.status === "pass" ? "real" : check?.status === "watch" ? "shadow" : "blocked";
  return item({
    id: `odds-${checkId}`,
    section: "odds-intelligence",
    label,
    requirement,
    status,
    evidence: check?.detail ?? "No odds proof check exists for this requirement.",
    blocker: status === "real" ? null : check?.detail ?? "odds proof missing",
    nextAction: status === "real" ? "Refresh odds before operator action." : "Keep watch/avoid posture until the odds proof passes.",
    proofUrl: "/api/sports/decision/odds-intelligence-proof"
  });
}

function section(id: DecisionOriginalBriefCoverageSectionId, items: DecisionOriginalBriefCoverageItem[]): DecisionOriginalBriefCoverageSection {
  const counts = countsFor(items);
  return {
    id,
    label: SECTION_LABELS[id],
    status: statusFromCounts(counts),
    counts,
    items
  };
}

function buildDataItems(authority: DecisionDataAuthority): DecisionOriginalBriefCoverageItem[] {
  return [
    dataItem(authority, "fixtures", "data-fixtures", "Fixtures for the day", "Collect fixtures for the current decision slate."),
    dataItem(authority, "historical-results", "data-history", "Team/player historical results", "Collect historical results for training and model features."),
    dataItem(authority, "standings", "data-standings", "League standings", "Collect standings and table context."),
    dataItem(authority, "home-away", "data-home-away", "Home/away performance", "Track home/away splits and venue effects."),
    dataItem(authority, "recent-form", "data-form", "Recent form", "Track recent team/player form."),
    dataItem(authority, "injuries", "data-injuries", "Injuries", "Collect injury signals where available."),
    dataItem(authority, "suspensions", "data-suspensions", "Suspensions", "Collect suspension and availability restrictions."),
    dataItem(authority, "lineups", "data-lineups", "Lineups when available", "Collect lineups and starter context near kickoff."),
    dataItem(authority, "odds", "data-odds", "Bookmaker odds", "Collect bookmaker prices for no-vig and EV calculations."),
    dataItem(authority, "live-scores", "data-live-scores", "Live scores", "Collect score and clock state for live decisions."),
    dataItem(authority, "match-events", "data-events", "Match events", "Collect goals, cards, substitutions, injuries, and other events."),
    dataItem(authority, "news", "data-news", "News signals", "Collect bounded news signals with sources."),
    dataItem(authority, "weather", "data-weather", "Weather for football", "Collect weather when conditions matter.")
  ];
}

function footballMathProviderGateSummary(math: DecisionModelMathSportProof | null): string | null {
  if (!math?.providerFeedGates.length) return null;
  return math.providerFeedGates
    .filter((feed) => feed.status !== "configured")
    .slice(0, 4)
    .map((feed) => `${feed.label}: ${feed.missingKeys.join(" or ") || feed.status}`)
    .join("; ");
}

function buildPredictionItems(modelCards: DecisionModelCards, modelMathProof: DecisionModelMathProof | null): DecisionOriginalBriefCoverageItem[] {
  const football = modelCards.cards.find((card) => card.sport === "football");
  const footballMath = modelMathProof?.sports.find((sport) => sport.sport === "football") ?? null;
  const footballGateSummary = footballMathProviderGateSummary(footballMath);
  return [
    modelItem(
      modelCards,
      modelMathProof,
      "football",
      "Football model",
      "Use Poisson expected goals, team strength/Elo-style ratings, home advantage, recent form, xG where available, injury/news adjustment, and market adjustment."
    ),
    item({
      id: "model-football-xg-provider",
      section: "prediction-engine",
      label: "Football xG/provider upgrade",
      requirement: "Use xG where available and keep provider-backed context separate from mock/proxy signals.",
      status: football && football.featureProvenance.providerBacked > 0 && !footballMath?.blockedProviderFeeds ? "real" : "shadow",
      evidence: football
        ? `${football.featureProvenance.providerBacked} provider-backed, ${football.featureProvenance.computed} computed, ${football.featureProvenance.mock} mock, ${football.featureProvenance.missing} missing feature(s). ${footballMath ? `Math proof ${footballMath.status}; ${footballMath.blockedProviderFeeds} blocked feed gate(s).` : ""}`
        : "No football model card exists.",
      blocker:
        football && football.featureProvenance.providerBacked > 0 && !footballMath?.blockedProviderFeeds
          ? null
          : footballGateSummary || "xG/provider-backed context still needs provider feed proof",
      nextAction: football?.upgradePath[0] ?? "Connect provider-backed football feature feeds.",
      proofUrl: "/api/sports/decision/model-math-proof"
    }),
    modelItem(
      modelCards,
      modelMathProof,
      "basketball",
      "Basketball model",
      "Use team rating, pace, offensive/defensive efficiency, rest days, home/away, injuries, spread, and moneyline logic."
    ),
    modelItem(
      modelCards,
      modelMathProof,
      "tennis",
      "Tennis model",
      "Use player Elo, surface-specific rating, recent form, head-to-head, fatigue, tournament round, and injury/news context."
    )
  ];
}

function buildOddsItems(proof: DecisionOddsIntelligenceProof): DecisionOriginalBriefCoverageItem[] {
  return [
    oddsItem(proof, "implied-probability", "Implied probability", "Convert odds to implied probability."),
    oddsItem(proof, "no-vig-margin-removal", "No-vig market probability", "Remove bookmaker margin where possible."),
    oddsItem(proof, "model-vs-market-edge", "Model vs market edge", "Compare model probability with no-vig market probability."),
    oddsItem(proof, "expected-value", "Expected value ranking", "Calculate EV and rank positive expected value."),
    oddsItem(proof, "risk-and-safer-alternatives", "Risk and safer alternatives", "Explain risks, avoid reasons, and safer alternatives."),
    item({
      id: "odds-money-feature",
      section: "odds-intelligence",
      label: "Money feature summary",
      requirement: "Rank positive expected value markets and explain why to consider, monitor, or avoid.",
      status: proof.status === "ready-proof" ? "real" : proof.status === "watch" ? "shadow" : "blocked",
      evidence: `${proof.totals.positiveExpectedValue} positive-EV selection(s), ${proof.totals.saferAlternatives} safer alternative(s), best edge ${proof.totals.bestEdge ?? "N/A"}.`,
      blocker: proof.status === "ready-proof" ? null : proof.summary,
      nextAction: "Refresh odds and rerun the odds-intelligence proof before any operator action.",
      proofUrl: "/api/sports/decision/odds-intelligence-proof"
    })
  ];
}

function buildAiItems(readiness: DecisionAIReviewReadiness, diagnostic: DecisionOpenAIKeyDiagnostic): DecisionOriginalBriefCoverageItem[] {
  return [
    item({
      id: "ai-structured-explanations",
      section: "ai-explanation",
      label: "Structured explanations",
      requirement: "Explain why the model favors a side, what risks exist, which news may affect the match, why to avoid, and safer alternatives.",
      status: "real",
      evidence: `${readiness.totals.lanes} AI review contract(s), deterministic fallbacks, public cognitive proof, evidence graph, and thinking introspection are linked.`,
      blocker: null,
      nextAction: "Inspect the cognitive proof and odds proof before requesting live review.",
      proofUrl: "/api/sports/decision/ai-review-readiness"
    }),
    item({
      id: "ai-live-review-key",
      section: "ai-explanation",
      label: "Live OpenAI review",
      requirement: "Use a guarded AI reviewer only after the OpenAI key is configured and run=1 is explicitly requested.",
      status: diagnostic.status === "ready-to-request" ? "real" : diagnostic.status === "blocked" ? "blocked" : "shadow",
      evidence: `${diagnostic.status}; key shape ${diagnostic.runtime.keyShape}; ${diagnostic.runtime.lanesReady}/${diagnostic.runtime.lanes} lane(s) ready.`,
      blocker: diagnostic.status === "ready-to-request" ? null : diagnostic.summary,
      nextAction: diagnostic.nextStep.label,
      proofUrl: "/api/sports/decision/openai-key-diagnostic"
    }),
    item({
      id: "ai-same-or-safer",
      section: "ai-explanation",
      label: "Same-or-safer guardrail",
      requirement: "AI may critique, downgrade, abstain, or request data, but cannot upgrade a weak/no-edge decision.",
      status: readiness.controls.canUpgradePublicAction ? "blocked" : "real",
      evidence: `canUpgradePublicAction=${readiness.controls.canUpgradePublicAction}; canPersist=${readiness.controls.canPersist}; canPublish=${readiness.controls.canPublish}.`,
      blocker: readiness.controls.canUpgradePublicAction ? "AI upgrade control is open" : null,
      nextAction: "Keep the AI firewall and citation validator between model output and public authority.",
      proofUrl: "/api/sports/decision/ai-firewall"
    })
  ];
}

function buildTrainingItems(proof: TrainingCorpusProof): DecisionOriginalBriefCoverageItem[] {
  const status: DecisionOriginalBriefCoverageStatus =
    proof.status === "shadow-ready" ? "real" : proof.status === "ready-dry-run" || proof.status === "waiting-corpus" ? "shadow" : "blocked";
  return [
    item({
      id: "corpus-10-year-plan",
      section: "training-corpus",
      label: "10-year corpus plan",
      requirement: "Plan the last 10 years of scores, odds, events, standings, lineups, news, weather, features, and backtests.",
      status: proof.seasonWindow.from <= 2016 && proof.seasonWindow.to >= 2025 ? "real" : "shadow",
      evidence: `${proof.seasonWindow.from}-${proof.seasonWindow.to}; ${proof.targets.estimatedHistoricalMatches} estimated matches and ${proof.targets.estimatedOddsSnapshots} odds snapshots.`,
      blocker: null,
      nextAction: proof.nextProof.expectedEvidence,
      proofUrl: "/api/sports/decision/training/corpus-proof"
    }),
    item({
      id: "corpus-real-data",
      section: "training-corpus",
      label: "Real training rows",
      requirement: "Use real historical rows as training data before learned guardrails affect live decisions.",
      status,
      evidence: `${proof.totals.realFinishedFixtures} real fixture(s), ${proof.totals.realOddsSnapshots} real odds snapshot(s), ${proof.totals.featureSnapshots} feature snapshot(s), ${proof.totals.backtestRuns} backtest run(s).`,
      blocker: status === "real" ? null : proof.blockers[0] ?? proof.summary,
      nextAction: proof.nextProof.label,
      proofUrl: "/api/sports/decision/training/corpus-proof"
    }),
    item({
      id: "corpus-no-write-lock",
      section: "training-corpus",
      label: "Training write lock",
      requirement: "Keep provider writes, training-row persistence, model training, learned weights, and publishing locked until proof passes.",
      status:
        proof.controls.canWriteProviderRows ||
        proof.controls.canPersistTrainingRows ||
        proof.controls.canTrainModels ||
        proof.controls.canUseLearnedWeights ||
        proof.controls.canPublishPicks
          ? "blocked"
          : "real",
      evidence: `write=${proof.controls.canWriteProviderRows}, persistTraining=${proof.controls.canPersistTrainingRows}, train=${proof.controls.canTrainModels}, learnedWeights=${proof.controls.canUseLearnedWeights}.`,
      blocker: null,
      nextAction: "Keep dry-runs and proof receipts separate from write-mode imports.",
      proofUrl: "/api/sports/decision/training/corpus-proof"
    })
  ];
}

function buildDeploymentItems({
  supabaseProofBinder,
  envActivationMatrix
}: {
  supabaseProofBinder: DecisionSupabaseProofBinder;
  envActivationMatrix: DecisionEnvActivationMatrix;
}): DecisionOriginalBriefCoverageItem[] {
  const siteRow = envActivationMatrix.rows.find((row) => row.id === "site-url");
  const openAiRow = envActivationMatrix.rows.find((row) => row.id === "openai-key");
  return [
    item({
      id: "supabase-project-proof",
      section: "deployment-storage",
      label: "Supabase project proof",
      requirement: "Use the new OddsPadi Supabase project only, with schema and MCP proof before writes.",
      status: supabaseProofBinder.status === "ready-proof" ? "real" : supabaseProofBinder.status.startsWith("blocked") ? "blocked" : "shadow",
      evidence: `${supabaseProofBinder.status}; expected ref ${supabaseProofBinder.expected.projectRef}; schema ${supabaseProofBinder.observed.verifiedTableCount}/${supabaseProofBinder.expected.tableCount}.`,
      blocker: supabaseProofBinder.status === "ready-proof" ? null : supabaseProofBinder.nextProof.label,
      nextAction: supabaseProofBinder.nextProof.expectedEvidence,
      proofUrl: "/api/sports/decision/supabase-proof-binder"
    }),
    item({
      id: "netlify-env",
      section: "deployment-storage",
      label: "Netlify/local env",
      requirement: "Use Netlify with server secrets in environment variables and public URLs in public env only.",
      status: envActivationMatrix.status === "ready" ? "real" : envActivationMatrix.status === "waiting" ? "shadow" : "blocked",
      evidence: `${envActivationMatrix.totals.configured}/${envActivationMatrix.totals.rows} env row(s) configured; missing ${envActivationMatrix.totals.missing}; invalid ${envActivationMatrix.totals.invalid}.`,
      blocker: envActivationMatrix.nextRow?.label ?? null,
      nextAction: siteRow?.nextAction ?? envActivationMatrix.nextRow?.nextAction ?? "Keep Netlify secrets out of source files.",
      proofUrl: "/api/sports/decision/env-activation-matrix"
    }),
    item({
      id: "openai-env",
      section: "deployment-storage",
      label: "OpenAI env",
      requirement: "Configure OPENAI_API_KEY server-side locally and on Netlify before live AI review.",
      status: openAiRow?.status === "configured" ? "real" : "shadow",
      evidence: openAiRow ? `${openAiRow.status}; ${openAiRow.destination}; ${openAiRow.exposure}.` : "OpenAI env row is missing from the activation matrix.",
      blocker: openAiRow?.status === "configured" ? null : openAiRow?.nextAction ?? "OPENAI_API_KEY is missing.",
      nextAction: openAiRow?.nextAction ?? "Create or reuse an OpenAI API key through the secure setup flow.",
      proofUrl: "/api/sports/decision/openai-key-diagnostic"
    })
  ];
}

function buildSafetyItems({
  oddsProof,
  trainingProof,
  aiReadiness,
  openAiDiagnostic
}: {
  oddsProof: DecisionOddsIntelligenceProof;
  trainingProof: TrainingCorpusProof;
  aiReadiness: DecisionAIReviewReadiness;
  openAiDiagnostic: DecisionOpenAIKeyDiagnostic;
}): DecisionOriginalBriefCoverageItem[] {
  return [
    item({
      id: "safety-no-staking",
      section: "safety-controls",
      label: "No staking",
      requirement: "Do not place bets or expose staking as an enabled action.",
      status: oddsProof.controls.canStake ? "blocked" : "real",
      evidence: `canStake=${oddsProof.controls.canStake}; canPublish=${oddsProof.controls.canPublish}.`,
      blocker: oddsProof.controls.canStake ? "staking control is open" : null,
      nextAction: "Keep all betting operations outside the MVP runtime.",
      proofUrl: "/api/sports/decision/odds-intelligence-proof"
    }),
    item({
      id: "safety-no-publish",
      section: "safety-controls",
      label: "No publish until proof",
      requirement: "Do not publish picks while provider, AI, Supabase, training, or responsible controls are incomplete.",
      status: oddsProof.controls.canPublish || trainingProof.controls.canPublishPicks || aiReadiness.controls.canPublish ? "blocked" : "real",
      evidence: `oddsPublish=${oddsProof.controls.canPublish}, corpusPublish=${trainingProof.controls.canPublishPicks}, aiPublish=${aiReadiness.controls.canPublish}.`,
      blocker: null,
      nextAction: "Keep public action locked until activation audit passes.",
      proofUrl: "/api/sports/decision/launch-commander"
    }),
    item({
      id: "safety-no-secret-output",
      section: "safety-controls",
      label: "No secret output",
      requirement: "Never print keys or write secrets from diagnostic routes.",
      status: openAiDiagnostic.controls.canPrintSecrets || openAiDiagnostic.controls.canWriteSecrets ? "blocked" : "real",
      evidence: `canPrintSecrets=${openAiDiagnostic.controls.canPrintSecrets}; canWriteSecrets=${openAiDiagnostic.controls.canWriteSecrets}.`,
      blocker: null,
      nextAction: "Keep credential creation in the secure OpenAI Platform flow only.",
      proofUrl: "/api/sports/decision/openai-key-diagnostic"
    })
  ];
}

export function buildDecisionOriginalBriefCoverage({
  dataAuthority,
  modelCards,
  modelMathProof = null,
  oddsIntelligenceProof,
  aiReviewReadiness,
  openAiKeyDiagnostic,
  trainingCorpusProof,
  supabaseProofBinder,
  envActivationMatrix,
  now = new Date()
}: {
  dataAuthority: DecisionDataAuthority;
  modelCards: DecisionModelCards;
  modelMathProof?: DecisionModelMathProof | null;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  aiReviewReadiness: DecisionAIReviewReadiness;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  trainingCorpusProof: TrainingCorpusProof;
  supabaseProofBinder: DecisionSupabaseProofBinder;
  envActivationMatrix: DecisionEnvActivationMatrix;
  now?: Date;
}): DecisionOriginalBriefCoverage {
  const sections = [
    section("data-layer", buildDataItems(dataAuthority)),
    section("prediction-engine", buildPredictionItems(modelCards, modelMathProof)),
    section("odds-intelligence", buildOddsItems(oddsIntelligenceProof)),
    section("ai-explanation", buildAiItems(aiReviewReadiness, openAiKeyDiagnostic)),
    section("training-corpus", buildTrainingItems(trainingCorpusProof)),
    section("deployment-storage", buildDeploymentItems({ supabaseProofBinder, envActivationMatrix })),
    section("safety-controls", buildSafetyItems({ oddsProof: oddsIntelligenceProof, trainingProof: trainingCorpusProof, aiReadiness: aiReviewReadiness, openAiDiagnostic: openAiKeyDiagnostic }))
  ];
  const items = sections.flatMap((candidate) => candidate.items);
  const counts = countsFor(items);
  const status = statusFromCounts(counts);
  const topGap = items.find((candidate) => candidate.status === "blocked") ?? items.find((candidate) => candidate.status === "shadow") ?? null;
  const nextSafeCommand = {
    label: topGap ? `Inspect ${topGap.label}` : "Inspect original brief coverage",
    command: decisionCurlCommand("/api/sports/decision/original-brief-coverage"),
    proofUrl: topGap?.proofUrl ?? "/api/sports/decision/original-brief-coverage",
    safeToRun: true,
    expectedEvidence: topGap?.nextAction ?? "Coverage response shows every original brief item as real, shadow, or blocked."
  };

  return {
    mode: "original-brief-coverage",
    generatedAt: now.toISOString(),
    status,
    coverageHash: stableHash({
      status,
      sections: sections.map((candidate) => [candidate.id, candidate.status, candidate.counts]),
      dataAuthority: dataAuthority.authorityHash,
      modelCards: modelCards.status,
      modelMathProof: modelMathProof?.proofHash ?? null,
      odds: oddsIntelligenceProof.proofHash,
      ai: aiReviewReadiness.readinessHash,
      openai: openAiKeyDiagnostic.diagnosticHash,
      corpus: trainingCorpusProof.proofHash,
      supabase: supabaseProofBinder.binderHash,
      env: envActivationMatrix.matrixHash
    }),
    summary: `Original brief coverage: ${counts.real} real, ${counts.shadow} shadow, ${counts.blocked} blocked.`,
    counts,
    sections,
    topGap,
    nextSafeCommand,
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: dataAuthority.controls.canRunProviderDryRun || trainingCorpusProof.controls.canRunProviderDryRun,
      canRunOpenAIReview: aiReviewReadiness.controls.canRunLiveReview,
      canWriteSecrets: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/original-brief-coverage",
      ...sections.flatMap((candidate) => candidate.items.map((coverageItem) => coverageItem.proofUrl)),
      ...dataAuthority.proofUrls,
      ...modelCards.proofUrls,
      ...(modelMathProof?.proofUrls ?? []),
      ...oddsIntelligenceProof.proofUrls,
      ...aiReviewReadiness.proofUrls,
      ...openAiKeyDiagnostic.proofUrls,
      ...trainingCorpusProof.proofUrls,
      ...supabaseProofBinder.proofUrls,
      ...envActivationMatrix.proofUrls
    ]),
    locks: [
      "Coverage is read-only and cannot fetch providers, write secrets, persist decisions, train models, publish picks, or upgrade public action.",
      "Shadow coverage means the implementation path exists but still needs provider, corpus, Supabase, Netlify, or OpenAI proof.",
      "Blocked coverage keeps launch gated until the named proof route changes state."
    ]
  };
}
