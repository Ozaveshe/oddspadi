import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TipsterLeaderboard, type TipsterLeaderboardRow } from "@/components/community/TipsterLeaderboard";
import { wilsonInterval } from "@/lib/performance/ledgerMetrics";

const eligible: TipsterLeaderboardRow = {
  rank_position: 1,
  author_id: "a1",
  username: "sharp_analyst",
  display_name: "Sharp Analyst",
  account_type: "organic",
  published_tips: 14,
  settled_tips: 12,
  wins: 7,
  losses: 4,
  pushes: 1,
  net_units: 3.5,
  yield_percent: 12.2,
  average_settled_odds: 2.15,
  sports_mix: ["football", "basketball"],
  markets_mix: ["match_winner", "over_under_25"],
  ranking_score: 8.4,
  eligible: true
};

const establishing: TipsterLeaderboardRow = {
  ...eligible,
  rank_position: 2,
  author_id: "a2",
  username: "newcomer",
  display_name: null,
  settled_tips: 3,
  wins: 2,
  losses: 1,
  eligible: false
};

describe("TipsterLeaderboard", () => {
  it("shows sample, average odds, record, confidence interval and mix", () => {
    const html = renderToStaticMarkup(<TipsterLeaderboard rows={[eligible, establishing]} />);
    expect(html).toContain("12 settled");
    expect(html).toContain("2.15");
    expect(html).toContain("7–4");
    const interval = wilsonInterval(7, 11);
    expect(interval).not.toBeNull();
    if (!interval) return;
    expect(html).toContain(`${Math.round(interval.low * 100)}–${Math.round(interval.high * 100)}%`);
    expect(html).toContain("football");
    expect(html).toContain("3/5 to rank");
  });

  it("labels staff accounts on the board", () => {
    const staff: TipsterLeaderboardRow = { ...eligible, account_type: "staff" };
    const html = renderToStaticMarkup(<TipsterLeaderboard rows={[staff]} />);
    expect(html).toContain("OddsPadi staff");
  });

  it("keeps the open seat honest when nobody qualifies", () => {
    const html = renderToStaticMarkup(<TipsterLeaderboard rows={[establishing]} />);
    expect(html).toContain("No tipster has a qualified record yet");
  });
});
