import { cleanExternalIdentifier, isUuid } from "@/lib/security/inputValidation";
import type { Sport } from "@/lib/sports/types";

export type CommunityPollChoice = "home" | "draw" | "away";

export type CommunityTipDraft = {
  fixture_id: string;
  sport: Sport;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  market: string;
  selection: string;
  selection_label: string;
  tipped_odds: number;
  stake_units: number;
  rationale: string;
};

export type ContractResult<T> = { ok: true; value: T } | { ok: false; error: string };

function boundedText(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= minimum && normalized.length <= maximum ? normalized : null;
}

export function parseCommunityPollVote(payload: unknown): ContractResult<{ pollId: string; choice: CommunityPollChoice }> {
  if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid poll vote." };
  const candidate = payload as { pollId?: unknown; choice?: unknown };
  if (!isUuid(candidate.pollId)) return { ok: false, error: "Invalid poll." };
  if (candidate.choice !== "home" && candidate.choice !== "draw" && candidate.choice !== "away") {
    return { ok: false, error: "Choose home, draw or away." };
  }
  return { ok: true, value: { pollId: candidate.pollId, choice: candidate.choice } };
}

export function parseCommunityTipDraft(payload: unknown, now = new Date()): ContractResult<CommunityTipDraft> {
  if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid community tip." };
  const candidate = payload as Record<string, unknown>;
  const fixtureId = cleanExternalIdentifier(candidate.fixtureId);
  if (!fixtureId) return { ok: false, error: "Choose a valid fixture." };
  const sport = candidate.sport;
  if (sport !== "football" && sport !== "basketball" && sport !== "tennis") return { ok: false, error: "Choose a supported sport." };
  const homeTeam = boundedText(candidate.homeTeam, 1, 120);
  const awayTeam = boundedText(candidate.awayTeam, 1, 120);
  if (!homeTeam || !awayTeam) return { ok: false, error: "Both teams are required." };
  const kickoffAt = typeof candidate.kickoffAt === "string" && Number.isFinite(Date.parse(candidate.kickoffAt)) ? new Date(candidate.kickoffAt).toISOString() : null;
  if (!kickoffAt || Date.parse(kickoffAt) <= now.getTime() + 30 * 60 * 1000) {
    return { ok: false, error: "Community tips lock 30 minutes before kickoff." };
  }
  const market = boundedText(candidate.market, 1, 100);
  const selection = boundedText(candidate.selection, 1, 160);
  const selectionLabel = boundedText(candidate.selectionLabel, 1, 160);
  if (!market || !selection || !selectionLabel) return { ok: false, error: "Market and selection are required." };
  const tippedOdds = typeof candidate.tippedOdds === "number" ? candidate.tippedOdds : Number.NaN;
  if (!Number.isFinite(tippedOdds) || tippedOdds <= 1 || tippedOdds > 1000) return { ok: false, error: "Enter valid decimal odds above 1.00." };
  const stakeUnits = typeof candidate.stakeUnits === "number" ? candidate.stakeUnits : Number.NaN;
  if (!Number.isFinite(stakeUnits) || stakeUnits < 0.1 || stakeUnits > 10) return { ok: false, error: "Stake must be between 0.1 and 10 units." };
  const rationale = boundedText(candidate.rationale, 50, 2000);
  if (!rationale) return { ok: false, error: "Explain the match-specific reasoning in 50 to 2000 characters." };
  return {
    ok: true,
    value: {
      fixture_id: fixtureId,
      sport,
      home_team: homeTeam,
      away_team: awayTeam,
      kickoff_at: kickoffAt,
      market,
      selection,
      selection_label: selectionLabel,
      tipped_odds: tippedOdds,
      stake_units: stakeUnits,
      rationale
    }
  };
}

export function parseCommunityTipRevision(payload: unknown): ContractResult<{ tipId: string; revisionKind: "correction" | "withdrawal"; reason: string }> {
  if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid tip note." };
  const candidate = payload as { tipId?: unknown; revisionKind?: unknown; reason?: unknown };
  if (!isUuid(candidate.tipId)) return { ok: false, error: "Invalid community tip." };
  if (candidate.revisionKind !== "correction" && candidate.revisionKind !== "withdrawal") return { ok: false, error: "Choose correction or withdrawal." };
  const reason = boundedText(candidate.reason, 10, 500);
  if (!reason) return { ok: false, error: "Explain the change in 10 to 500 characters." };
  return { ok: true, value: { tipId: candidate.tipId, revisionKind: candidate.revisionKind, reason } };
}
