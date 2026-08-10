import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCommunityTipDraft } from "@/lib/community/predictionContracts";
import { communityTipStatus } from "@/lib/community/tipStatus";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260808181000_community_tip_ledger_v2.sql"),
  "utf8"
);

const validDraft = {
  fixtureId: "api-football-1234",
  sport: "football",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  kickoffAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
  market: "match_winner",
  selection: "home",
  selectionLabel: "Arsenal to win",
  tippedOdds: 2.1,
  stakeUnits: 1,
  oddsSource: "Bet365 via match odds board",
  rationale:
    "Home pressing has produced twelve big chances over the last three matches while Chelsea rotate midfield."
};

describe("parseCommunityTipDraft v2", () => {
  it("stamps canonical selection key and market version for a mappable market", () => {
    const parsed = parseCommunityTipDraft(validDraft);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.canonical_selection_key).toBe("football.1x2.regulation.home");
    expect(parsed.value.market_version).toBe("2026-08-07.1");
    expect(parsed.value.odds_source).toBe("Bet365 via match odds board");
    expect(parsed.value.market_line).toBeNull();
  });

  it("accepts a quarter-step line and canonicalises totals", () => {
    const withLine = parseCommunityTipDraft({
      ...validDraft,
      market: "over_under_25",
      selection: "over",
      selectionLabel: "Over 2.5 goals",
      marketLine: 2.5
    });
    expect(withLine.ok).toBe(true);
    if (!withLine.ok) return;
    expect(withLine.value.market_line).toBe(2.5);
    expect(withLine.value.canonical_selection_key).toBe("football.total_goals.regulation.over.2_5");
  });

  it("rejects a line that is not a quarter step", () => {
    expect(parseCommunityTipDraft({ ...validDraft, marketLine: 2.6 }).ok).toBe(false);
  });

  it("leaves canonical identity null for an unmappable market instead of guessing", () => {
    const parsed = parseCommunityTipDraft({ ...validDraft, market: "correct_score", selection: "2-1" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.canonical_selection_key).toBeNull();
    expect(parsed.value.market_version).toBeNull();
  });

  it("defaults odds_source when omitted and bounds it", () => {
    const draft = parseCommunityTipDraft({ ...validDraft, oddsSource: undefined });
    expect(draft.ok).toBe(true);
    if (draft.ok) expect(draft.value.odds_source).toBe("user-entered");
    expect(parseCommunityTipDraft({ ...validDraft, oddsSource: "x".repeat(121) }).ok).toBe(false);
  });

  it("still locks 30 minutes before kickoff", () => {
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(parseCommunityTipDraft({ ...validDraft, kickoffAt: soon }).ok).toBe(false);
  });
});

describe("tip ledger v2 migration", () => {
  it("adds the tracked columns", () => {
    for (const column of [
      "market_line",
      "odds_source",
      "canonical_selection_key",
      "market_version",
      "deleted_at",
      "rationale_updated_at",
      "moderated_at",
      "moderated_reason"
    ]) {
      expect(migration).toContain(column);
    }
  });

  it("restricts author updates to commentary and deletion", () => {
    expect(migration).toContain("grant update (rationale, deleted_at) on public.op_community_tips to authenticated");
    expect(migration).not.toMatch(/grant update[^;]*tipped_odds/);
    expect(migration).not.toMatch(/grant update[^;]*kickoff_at/);
  });

  it("freezes tracked values for everyone via trigger", () => {
    expect(migration).toContain("op_guard_community_tip_update");
    expect(migration).toContain("Tracked community tip values are immutable");
    expect(migration).toContain("A deleted community tip cannot be restored");
  });
});

describe("communityTipStatus", () => {
  it("supports the full ledger state set", () => {
    expect(communityTipStatus({})).toBe("pending");
    expect(communityTipStatus({ settlement: { result: "won" } })).toBe("won");
    expect(communityTipStatus({ settlement: { result: "void" } })).toBe("void");
    expect(communityTipStatus({ revisions: [{ revision_kind: "correction" }] })).toBe("corrected");
    expect(
      communityTipStatus({ settlement: { result: "lost" }, revisions: [{ revision_kind: "correction" }] })
    ).toBe("lost");
    expect(communityTipStatus({ moderatedAt: "2026-08-08T00:00:00Z", settlement: { result: "won" } })).toBe(
      "moderated"
    );
  });
});
