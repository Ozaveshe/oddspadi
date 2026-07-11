import type { FootballProviderLiveWatchlistCandidate, FootballProviderLiveWatchlistReceipt } from "@/lib/sports/training/footballProviderLiveWatchlistReceipt";

export type FootballProviderLiveBriefingStatus = "explanation-ready" | "no-watchlist-candidate" | "blocked-evidence";

export type FootballProviderLiveBriefingEvidence = {
  id: string;
  label: string;
  status: "support" | "watch" | "block";
  detail: string;
  proofUrl: string;
};

export type FootballProviderLiveBriefingPacket = {
  mode: "football-provider-live-briefing-packet";
  generatedAt: string;
  status: FootballProviderLiveBriefingStatus;
  packetHash: string;
  summary: string;
  target: {
    targetDate: string;
    fixtureExternalId: string | null;
    match: string | null;
    selection: string | null;
    action: "monitor" | "avoid";
    publicPickAllowed: false;
  };
  publicBriefing: {
    headline: string;
    modelCase: string[];
    riskCase: string[];
    avoidIf: string[];
    saferAlternatives: string[];
    nextEvidence: string[];
  };
  evidence: {
    ids: string[];
    items: FootballProviderLiveBriefingEvidence[];
    support: number;
    watch: number;
    block: number;
  };
  requestPreview: {
    model: string;
    store: false;
    instructions: string[];
    responseContract: {
      format: "strict-json";
      allowedVerdicts: Array<"agree" | "downgrade" | "needs-evidence" | "block">;
      allowedActions: Array<"avoid" | "monitor">;
      forbidden: string[];
      requiredKeys: string[];
    };
    input: {
      watchlistHash: string;
      target: FootballProviderLiveBriefingPacket["target"];
      topCandidate: FootballProviderLiveWatchlistCandidate | null;
      candidateMath: Array<{
        rank: number;
        selection: string;
        modelProbability: number;
        marketProbability: number;
        edge: number;
        expectedValue: number;
        odds: number;
        action: "monitor" | "avoid";
      }>;
      evidence: FootballProviderLiveBriefingEvidence[];
      publicBriefing: FootballProviderLiveBriefingPacket["publicBriefing"];
    };
  };
  controls: {
    canInspectReadOnly: true;
    canPrepareAIReview: boolean;
    canSubmitToOpenAI: false;
    canApplyAIOutput: false;
    canWriteFeatureSnapshots: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
    canUpgradePublicAction: false;
  };
  nextAction: {
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  locks: string[];
  proofUrls: string[];
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

function compact(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function unique(values: string[], limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))).slice(0, limit);
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function signedPct(value: number): string {
  const rounded = Math.round(value * 1000) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function evidenceItems(watchlist: FootballProviderLiveWatchlistReceipt, topCandidate: FootballProviderLiveWatchlistCandidate | null): FootballProviderLiveBriefingEvidence[] {
  const items: FootballProviderLiveBriefingEvidence[] = [
    {
      id: "live-watchlist",
      label: "Live watchlist receipt",
      status: watchlist.status === "watchlist-ready" ? "support" : watchlist.status === "no-positive-edge" ? "watch" : "block",
      detail: watchlist.summary,
      proofUrl: "/api/sports/decision/training/football-provider-live-watchlist"
    },
    {
      id: "side-effect-lock",
      label: "Side-effect lock",
      status: "block",
      detail: "The live watchlist forbids writes, training, publishing, staking, and public pick upgrades.",
      proofUrl: "/api/sports/decision/training/football-provider-live-watchlist"
    }
  ];

  if (!topCandidate) return items;

  items.push(
    {
      id: "candidate-edge",
      label: "Candidate edge math",
      status: topCandidate.edge > 0 && topCandidate.expectedValue > 0 ? "support" : "watch",
      detail: `${topCandidate.selectionLabel} has model probability ${pct(topCandidate.modelProbability)}, no-vig market probability ${pct(
        topCandidate.marketProbability
      )}, edge ${signedPct(topCandidate.edge)}, and EV ${signedPct(topCandidate.expectedValue)}.`,
      proofUrl: "/api/sports/decision/training/football-provider-live-watchlist"
    },
    {
      id: "pending-settlement",
      label: "Pending settlement",
      status: "block",
      detail: "The fixture is upcoming/live and has no settled outcome label, so it cannot train models or validate the edge yet.",
      proofUrl: "/api/sports/decision/training/football-provider-live-feature-materializer"
    },
    {
      id: "missing-provider-context",
      label: "Provider context gaps",
      status: "watch",
      detail: unique(topCandidate.risks, 4).join(" "),
      proofUrl: "/api/sports/decision/training/football-provider-feature-intake-gap"
    },
    {
      id: "safer-alternatives",
      label: "Safer alternatives",
      status: topCandidate.saferAlternatives.some((item) => item.availableInMvp) ? "support" : "watch",
      detail: topCandidate.saferAlternatives.map((item) => `${item.label}: ${item.rationale}`).join(" "),
      proofUrl: "/api/sports/decision/training/football-provider-live-watchlist"
    }
  );

  return items.map((item) => ({
    ...item,
    detail: compact(item.detail, 360)
  }));
}

function nextEvidence(topCandidate: FootballProviderLiveWatchlistCandidate | null): string[] {
  return unique([
    "Provider-backed fixture ID and raw payload link.",
    "Fresh bookmaker odds snapshot with market timestamp and margin.",
    "Confirmed injuries, suspensions, and lineup availability.",
    "News and weather context where relevant.",
    "Closing odds movement before kickoff.",
    "Settled result label after the match.",
    ...(topCandidate?.selection === "draw" ? ["Draw-specific calibration and lower-variance alternative market check."] : ["Draw-no-bet and double-chance prices for the favored side."])
  ]);
}

function briefingFor(watchlist: FootballProviderLiveWatchlistReceipt, topCandidate: FootballProviderLiveWatchlistCandidate | null): FootballProviderLiveBriefingPacket["publicBriefing"] {
  if (!topCandidate) {
    return {
      headline: "No live watchlist candidate is ready for explanation.",
      modelCase: [watchlist.summary],
      riskCase: unique(watchlist.risks.length ? watchlist.risks : ["No ranked live candidate is available."]),
      avoidIf: ["Avoid any public pick until a ranked candidate and provider evidence exist."],
      saferAlternatives: ["No safer alternative can be ranked without a live candidate."],
      nextEvidence: nextEvidence(null)
    };
  }

  const actionLabel = topCandidate.action === "monitor" ? "Monitor" : "Avoid";
  return {
    headline: `${actionLabel} ${topCandidate.selectionLabel} in ${topCandidate.matchLabel}; public pick remains locked.`,
    modelCase: unique(topCandidate.whyModelFavorsIt),
    riskCase: unique(topCandidate.risks),
    avoidIf: unique([
      "Avoid if provider-backed fixture, odds, lineup, injury, news, or weather evidence is missing at decision time.",
      "Avoid if the edge turns negative after a fresh no-vig market refresh.",
      "Avoid if the candidate remains synthetic, mock-seeded, or without raw payload proof.",
      "Avoid if settlement/backtest evidence does not support this segment."
    ]),
    saferAlternatives: unique(topCandidate.saferAlternatives.map((item) => `${item.label}: ${item.rationale}`)),
    nextEvidence: nextEvidence(topCandidate)
  };
}

function statusFor(watchlist: FootballProviderLiveWatchlistReceipt, topCandidate: FootballProviderLiveWatchlistCandidate | null): FootballProviderLiveBriefingStatus {
  if (!topCandidate) return "no-watchlist-candidate";
  if (!watchlist.controls.canRankWatchlist || watchlist.status === "blocked-evidence") return "blocked-evidence";
  return "explanation-ready";
}

function summaryFor(status: FootballProviderLiveBriefingStatus, topCandidate: FootballProviderLiveWatchlistCandidate | null): string {
  if (status === "explanation-ready") {
    return `${topCandidate?.selectionLabel ?? "Top candidate"} has an explanation-ready monitor packet with evidence IDs, risk gates, and safer alternatives.`;
  }
  if (status === "blocked-evidence") return "Live briefing packet is blocked because the watchlist evidence cannot safely rank a candidate.";
  return "Live briefing packet has no watchlist candidate to explain.";
}

export function buildFootballProviderLiveBriefingPacket({
  watchlist,
  model = "gpt-4.1-mini",
  now = new Date()
}: {
  watchlist: FootballProviderLiveWatchlistReceipt;
  model?: string;
  now?: Date;
}): FootballProviderLiveBriefingPacket {
  const topCandidate = watchlist.topCandidate;
  const status = statusFor(watchlist, topCandidate);
  const publicBriefing = briefingFor(watchlist, topCandidate);
  const items = evidenceItems(watchlist, topCandidate);
  const target = {
    targetDate: watchlist.source.targetDate,
    fixtureExternalId: topCandidate?.fixtureExternalId ?? null,
    match: topCandidate?.matchLabel ?? null,
    selection: topCandidate?.selectionLabel ?? null,
    action: topCandidate?.action ?? ("avoid" as const),
    publicPickAllowed: false as const
  };
  const candidateMath = watchlist.candidates.slice(0, 6).map((candidate) => ({
    rank: candidate.rank,
    selection: candidate.selectionLabel,
    modelProbability: candidate.modelProbability,
    marketProbability: candidate.marketProbability,
    edge: candidate.edge,
    expectedValue: candidate.expectedValue,
    odds: candidate.decimalOdds,
    action: candidate.action
  }));

  const packetHash = stableHash({
    watchlistHash: watchlist.watchlistHash,
    status,
    target,
    candidateMath,
    evidence: items.map((item) => [item.id, item.status])
  });

  return {
    mode: "football-provider-live-briefing-packet",
    generatedAt: now.toISOString(),
    status,
    packetHash,
    summary: summaryFor(status, topCandidate),
    target,
    publicBriefing,
    evidence: {
      ids: items.map((item) => item.id),
      items,
      support: items.filter((item) => item.status === "support").length,
      watch: items.filter((item) => item.status === "watch").length,
      block: items.filter((item) => item.status === "block").length
    },
    requestPreview: {
      model,
      store: false,
      instructions: [
        "Use only the supplied evidence IDs; cite evidence IDs for every material claim.",
        "Return public reasoning notes only, not hidden chain-of-thought.",
        "You may agree, downgrade, request evidence, or block. You must not upgrade monitor/avoid into a public pick.",
        "Do not invent injuries, lineups, weather, odds, scores, news, suspensions, provider payloads, or settlement results.",
        "Positive EV may support monitoring only; pending settlement and missing provider proof block publishing and staking."
      ],
      responseContract: {
        format: "strict-json",
        allowedVerdicts: ["agree", "downgrade", "needs-evidence", "block"],
        allowedActions: ["avoid", "monitor"],
        forbidden: [
          "publish pick",
          "stake",
          "persist decision",
          "train model",
          "raise trust",
          "upgrade public action",
          "use hidden chain-of-thought",
          "claim unsupported team news",
          "claim odds are live unless evidence says so"
        ],
        requiredKeys: ["reviewVerdict", "recommendedAction", "summary", "rationale", "riskFlags", "dataGaps", "saferAlternatives", "evidenceChecks", "unsupportedClaims"]
      },
      input: {
        watchlistHash: watchlist.watchlistHash,
        target,
        topCandidate,
        candidateMath,
        evidence: items,
        publicBriefing
      }
    },
    controls: {
      canInspectReadOnly: true,
      canPrepareAIReview: status === "explanation-ready",
      canSubmitToOpenAI: false,
      canApplyAIOutput: false,
      canWriteFeatureSnapshots: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    nextAction: {
      label: status === "explanation-ready" ? "Review explanation packet" : "Repair live watchlist evidence",
      verifyUrl: "/api/sports/decision/training/football-provider-live-briefing-packet",
      expectedEvidence:
        "The briefing packet returns a strict, evidence-cited AI review contract plus public model case, risk case, avoid gates, and safer alternatives with all side effects locked."
    },
    locks: [
      "Live briefing packet is read-only and cannot submit to OpenAI, write snapshots, train, publish picks, stake, or upgrade public action.",
      "AI review is prepared as a strict contract only; a separate explicit run gate is required before any provider call.",
      "The packet forbids hidden chain-of-thought and unsupported claims about injuries, lineups, odds, weather, news, scores, suspensions, or settlement.",
      "Monitor candidates must remain blocked from public-pick language until provider-backed evidence, closing odds, settlement, and backtest gates clear.",
      ...watchlist.locks
    ].slice(0, 12),
    proofUrls: unique([
      "/api/sports/decision/training/football-provider-live-briefing-packet",
      "/api/sports/decision/training/football-provider-live-watchlist",
      "/api/sports/decision/training/football-provider-live-feature-materializer",
      "/api/sports/decision/training/football-provider-feature-intake-gap",
      ...watchlist.proofUrls
    ])
  };
}
