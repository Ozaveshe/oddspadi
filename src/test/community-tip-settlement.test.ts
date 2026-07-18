import { describe, expect, it } from "vitest";
import { resolveCommunityTipSettlement, type CommunitySettlementFixture, type SettleableCommunityTip } from "@/lib/community/tipSettlement";

const NOW = new Date("2026-07-17T18:00:00.000Z");
const TIP: SettleableCommunityTip = {
  id: "tip-1",
  fixtureId: "api-football:123",
  sport: "football",
  kickoffAt: "2026-07-17T14:00:00.000Z",
  market: "match_winner",
  selection: "home",
  selectionLabel: "Lagos United",
  tippedOdds: 2.2,
  stakeUnits: 2,
  withdrawnAt: null
};
const FIXTURE: CommunitySettlementFixture = {
  provider: "api-football",
  status: "finished",
  homeScore: 2,
  awayScore: 1,
  observedAt: "2026-07-17T16:15:00.000Z"
};

describe("community tip settlement", () => {
  it("grades a provider-backed winner and preserves the quoted stake economics", () => {
    expect(resolveCommunityTipSettlement(TIP, FIXTURE, NOW)).toEqual({
      status: "settled",
      result: "won",
      netUnits: 2.4,
      reason: "Outcome settlement graded match_winner:home as won. Final provider score 2-1."
    });
  });

  it("voids a valid pre-lock withdrawal without using the match result", () => {
    const decision = resolveCommunityTipSettlement({ ...TIP, withdrawnAt: "2026-07-17T12:00:00.000Z" }, null, NOW);
    expect(decision).toMatchObject({ status: "settled", result: "void", netUnits: 0 });
  });

  it("refuses to grade unsupported tennis totals from set-score evidence", () => {
    const decision = resolveCommunityTipSettlement({
      ...TIP,
      sport: "tennis",
      market: "total_games",
      selection: "over",
      selectionLabel: "Over 22.5"
    }, { ...FIXTURE, provider: "the-odds-api", homeScore: 2, awayScore: 0 }, NOW);
    expect(decision).toEqual(expect.objectContaining({ status: "manual_review", result: null }));
  });

  it("does not settle from manual, preview or missing fixture evidence", () => {
    expect(resolveCommunityTipSettlement(TIP, { ...FIXTURE, provider: "manual" }, NOW).status).toBe("waiting");
    expect(resolveCommunityTipSettlement(TIP, null, new Date("2026-07-19T18:00:00.000Z")).status).toBe("manual_review");
  });
});
