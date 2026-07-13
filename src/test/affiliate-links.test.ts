import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { AffiliateBookmakerLink } from "@/components/odds/AffiliateBookmakerLink";
import { affiliateBookmakerLink } from "@/lib/affiliate/bookmakerLinks";

const props = {
  bookmaker: { id: "betway", name: "Betway" },
  country: "Ghana",
  matchId: "fixture-42",
  sport: "football",
  league: "Ghana Premier League",
  placement: "odds_table" as const
};

describe("affiliate bookmaker links", () => {
  it("keeps the affiliate layer dormant without both a tag and an approved market", () => {
    expect(affiliateBookmakerLink("betway", "Ghana", {})).toBeNull();
    expect(affiliateBookmakerLink("betway", "Ghana", { ODDSPADI_AFFILIATE_BETWAY_TAG: "partner-1" })).toBeNull();
    expect(renderToStaticMarkup(createElement(AffiliateBookmakerLink, props))).toBe("");
  });

  it("does not render an otherwise configured link outside its approved markets", () => {
    expect(affiliateBookmakerLink("betway", "Kenya", {
      ODDSPADI_AFFILIATE_BETWAY_TAG: "partner-1",
      ODDSPADI_AFFILIATE_BETWAY_MARKETS: "GH"
    })).toBeNull();
  });

  it("renders a sponsored, analytics-labelled responsible-play link when enabled", () => {
    const previousTag = process.env.ODDSPADI_AFFILIATE_BETWAY_TAG;
    const previousMarkets = process.env.ODDSPADI_AFFILIATE_BETWAY_MARKETS;
    process.env.ODDSPADI_AFFILIATE_BETWAY_TAG = "padi & co";
    process.env.ODDSPADI_AFFILIATE_BETWAY_MARKETS = "GH,ZA";
    try {
      const html = renderToStaticMarkup(createElement(AffiliateBookmakerLink, props));
      expect(html).toContain("View at Betway");
      expect(html).toContain("rel=\"sponsored noopener\"");
      expect(html).toContain("data-analytics-event=\"affiliate_outbound_clicked\"");
      expect(html).toContain("18+ only. Play responsibly");
      expect(html).toContain("btag=padi+%26+co");
    } finally {
      if (previousTag === undefined) delete process.env.ODDSPADI_AFFILIATE_BETWAY_TAG;
      else process.env.ODDSPADI_AFFILIATE_BETWAY_TAG = previousTag;
      if (previousMarkets === undefined) delete process.env.ODDSPADI_AFFILIATE_BETWAY_MARKETS;
      else process.env.ODDSPADI_AFFILIATE_BETWAY_MARKETS = previousMarkets;
    }
  });
});
