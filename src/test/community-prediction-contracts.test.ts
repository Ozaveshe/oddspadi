import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCommunityPollVote, parseCommunityTipDraft, parseCommunityTipRevision } from "@/lib/community/predictionContracts";

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/serverAuthClient", () => ({ createSupabaseServerClient: createSupabaseServerClientMock }));

import { POST as vote } from "@/app/api/community/polls/route";
import { POST as publishTip } from "@/app/api/community/tips/route";

const POLL_ID = "123e4567-e89b-42d3-a456-426614174011";
const VALID_TIP = {
  fixtureId: "api-football:123",
  sport: "football",
  homeTeam: "Lagos United",
  awayTeam: "Kano Stars",
  kickoffAt: "2027-08-20T18:00:00.000Z",
  market: "Draw no bet",
  selection: "away",
  selectionLabel: "Kano Stars DNB",
  tippedOdds: 2.14,
  stakeUnits: 1.5,
  rationale: "Kano have controlled midfield transitions across the recent sample, while the price still implies a materially weaker away performance than the matchup evidence supports."
};

function request(path: string, body: unknown) {
  return new Request(`http://127.0.0.1:3010${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function client(userId: string | null = "user-1") {
  const upsert = vi.fn(async () => ({ error: null }));
  const single = vi.fn(async () => ({ data: { id: "created-1" }, error: null }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn((table: string) => table === "op_match_poll_votes" ? { upsert } : { insert });
  createSupabaseServerClientMock.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
    rpc: vi.fn(async () => ({ data: [{ allowed: true, remaining: 10, retry_after_seconds: 60 }], error: null })),
    from
  });
  return { from, upsert, insert };
}

beforeEach(() => createSupabaseServerClientMock.mockReset());

describe("community prediction contracts", () => {
  it("accepts a match-specific future tip and normalizes its immutable fields", () => {
    const result = parseCommunityTipDraft(VALID_TIP, new Date("2026-07-17T10:00:00.000Z"));
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (result.ok) expect(result.value).toMatchObject({ fixture_id: "api-football:123", tipped_odds: 2.14, stake_units: 1.5 });
  });

  it("rejects shallow rationale and tips inside the 30-minute lock", () => {
    expect(parseCommunityTipDraft({ ...VALID_TIP, rationale: "Too short." }).ok).toBe(false);
    const locked = parseCommunityTipDraft({ ...VALID_TIP, kickoffAt: "2026-07-17T10:29:59.000Z" }, new Date("2026-07-17T10:00:00.000Z"));
    expect(locked).toEqual({ ok: false, error: "Community tips lock 30 minutes before kickoff." });
  });

  it("allows only bounded poll choices and append-only correction kinds", () => {
    expect(parseCommunityPollVote({ pollId: POLL_ID, choice: "home" }).ok).toBe(true);
    expect(parseCommunityPollVote({ pollId: POLL_ID, choice: "confidence" }).ok).toBe(false);
    expect(parseCommunityTipRevision({ tipId: POLL_ID, revisionKind: "correction", reason: "The quoted team name was wrong." }).ok).toBe(true);
    expect(parseCommunityTipRevision({ tipId: POLL_ID, revisionKind: "edit", reason: "Change selection." }).ok).toBe(false);
  });

  it("persists a fan vote under the authenticated identity", async () => {
    const { upsert } = client();
    const response = await vote(request("/api/community/polls", { pollId: POLL_ID, choice: "away" }));
    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith({ poll_id: POLL_ID, user_id: "user-1", choice: "away" }, { onConflict: "poll_id,user_id" });
  });

  it("publishes a structured tip into the community-opinion lane", async () => {
    const { from, insert } = client();
    const response = await publishTip(request("/api/community/tips", VALID_TIP));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "created-1", truthLane: "community-opinion" });
    expect(from).toHaveBeenCalledWith("op_community_tips");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ author_id: "user-1", fixture_id: "api-football:123", rationale: VALID_TIP.rationale }));
  });

  it("rejects signed-out poll and tip writes before touching tables", async () => {
    const { from } = client(null);
    expect((await vote(request("/api/community/polls", { pollId: POLL_ID, choice: "home" }))).status).toBe(401);
    expect((await publishTip(request("/api/community/tips", VALID_TIP))).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps voter identity private and model performance separate in SQL", async () => {
    const source = await readFile("supabase/migrations/20260718065856_add_community_prediction_contracts.sql", "utf8");
    expect(source).toContain("alter table public.op_match_poll_votes enable row level security");
    expect(source).toContain("using ((select auth.uid()) = user_id)");
    expect(source).not.toContain("grant select on table public.op_match_poll_votes to anon");
    expect(source).toContain("with (security_invoker = true)");
    expect(source).toContain("Never blended with OddsPadi model performance");
    expect(source).not.toMatch(/grant update .*op_community_tips to authenticated/i);
    expect(source).not.toMatch(/grant delete .*op_community_tips to authenticated/i);
    expect(source).toContain("set search_path = pg_catalog, public");
    expect(source).toContain("revoke execute on function public.op_refresh_match_poll_counts() from public, anon, authenticated");
    expect(source).toContain("grant select on table public.op_match_polls to anon, authenticated");
    expect(source).toContain("grant select on table public.op_public_tipster_performance to anon, authenticated");
    expect(source).toContain("grant select on table public.op_public_tipster_leaderboard to anon, authenticated");
  });

  it("provisions polls from canonical fixtures and prevents client-authored fixture identity", async () => {
    const source = await readFile("supabase/migrations/20260718065856_add_community_prediction_contracts.sql", "utf8");
    expect(source).toContain("create trigger op_fixtures_sync_match_poll");
    expect(source).toContain("after insert or update of sport, external_id, home_team_name, away_team_name, kickoff_at, status");
    expect(source).toContain("insert into public.op_match_polls");
    expect(source).toContain("create trigger op_community_tips_canonicalize_fixture");
    expect(source).toContain("new.fixture_db_id := fixture.id");
    expect(source).toContain("new.home_team := fixture.home_team_name");
    expect(source).toContain("new.kickoff_at := fixture.kickoff_at");
    expect(source).toContain("revoke execute on function public.op_canonicalize_community_tip_fixture() from public, anon, authenticated");
    expect(source).toContain("create trigger op_community_tip_revisions_validate");
    expect(source).toContain("Community tips cannot be withdrawn inside the 30-minute lock");
    expect(source).toContain("revoke execute on function public.op_validate_community_tip_revision() from public, anon, authenticated");
    expect(source).toContain("performance.settled_tips >= 5 as eligible");
    expect(source).toContain("+ 20) * 100");
  });

  it("keeps the match desk and tipster scorecard explicitly outside the model lane", async () => {
    const [desk, matchPage, profilePage] = await Promise.all([
      readFile("src/components/community/MatchCommunityDesk.tsx", "utf8"),
      readFile("src/app/predictions/[matchId]/page.tsx", "utf8"),
      readFile("src/app/community/u/[handle]/page.tsx", "utf8")
    ]);
    expect(matchPage).toContain("<MatchCommunityDesk");
    expect(desk).toContain("Separate truth lane");
    expect(desk).toContain("votes and community tips never change OddsPadi probability");
    expect(desk).toContain("Original tips cannot be rewritten after publication");
    expect(profilePage).toContain("Only immutable, settled community tips count here");
  });
});
