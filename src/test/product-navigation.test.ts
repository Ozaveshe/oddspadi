import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Navigation and route-inventory contracts for the four-surface architecture.
 *
 * docs/route-map.md promises that no route was deleted and every surface stays
 * reachable. These tests hold the code to the document: every route the map
 * lists must exist as a page file, the hubs must link the deep routes they
 * claim to own, and the mobile tab bar must stay at four surfaces + More.
 */
const ROOT = process.cwd();

/** Route → page file that must exist (dynamic segments in brackets). */
const ROUTE_FILES: Record<string, string> = {
  "/": "src/app/page.tsx",
  "/explore": "src/app/explore/page.tsx",
  "/my": "src/app/my/page.tsx",
  "/track-record": "src/app/track-record/page.tsx",
  "/predictions": "src/app/predictions/page.tsx",
  "/predictions/[matchId]": "src/app/predictions/[matchId]/page.tsx",
  "/predictions/today": "src/app/predictions/today/page.tsx",
  "/predictions/tomorrow": "src/app/predictions/tomorrow/page.tsx",
  "/predictions/week": "src/app/predictions/week/page.tsx",
  "/predictions/value-picks": "src/app/predictions/value-picks/page.tsx",
  "/predictions/history": "src/app/predictions/history/page.tsx",
  "/predictions/decision-engine": "src/app/predictions/decision-engine/page.tsx",
  "/predictions/bet-slip": "src/app/predictions/bet-slip/page.tsx",
  "/predictions/league/[slug]/table": "src/app/predictions/league/[slug]/table/page.tsx",
  "/live-scores": "src/app/live-scores/page.tsx",
  "/tips": "src/app/tips/page.tsx",
  "/season-outlooks": "src/app/season-outlooks/page.tsx",
  "/news": "src/app/news/page.tsx",
  "/news/[slug]": "src/app/news/[slug]/page.tsx",
  "/engine/performance": "src/app/engine/performance/page.tsx",
  "/community": "src/app/community/page.tsx",
  "/forums": "src/app/forums/page.tsx",
  "/account": "src/app/account/page.tsx",
  "/about": "src/app/about/page.tsx",
  "/privacy": "src/app/privacy/page.tsx",
  "/terms": "src/app/terms/page.tsx"
};

describe("product navigation contracts", () => {
  it("keeps every route in the route map alive — nothing was deleted", async () => {
    for (const [route, file] of Object.entries(ROUTE_FILES)) {
      await expect(access(join(ROOT, file)), `${route} should exist at ${file}`).resolves.toBeUndefined();
    }
  });

  it("documents every kept route in docs/route-map.md", async () => {
    const routeMap = await readFile(join(ROOT, "docs", "route-map.md"), "utf8");
    for (const route of Object.keys(ROUTE_FILES)) {
      expect(routeMap, `route map must document ${route}`).toContain(`\`${route}\``);
    }
  });

  it("gives each surface hub links to the deep routes it owns", async () => {
    const explore = await readFile(join(ROOT, "src", "app", "explore", "page.tsx"), "utf8");
    for (const href of ["/predictions/today", "/predictions/tomorrow", "/predictions/week", "/live-scores", "/season-outlooks", "/news", "/community", "/forums", "/predictions?sport="]) {
      expect(explore, `Explore must link ${href}`).toContain(href);
    }
    const trackRecord = await readFile(join(ROOT, "src", "app", "track-record", "page.tsx"), "utf8");
    for (const href of ["/predictions/history", "/predictions/value-picks", "/engine/performance", "/predictions/decision-engine"]) {
      expect(trackRecord, `Track Record must link ${href}`).toContain(href);
    }
    const my = await readFile(join(ROOT, "src", "components", "product", "MyShelves.tsx"), "utf8");
    expect(my).toContain("/predictions/bet-slip");
    expect(my).toContain("/account");
  });

  it("keeps the mobile tab bar at the four surfaces plus More", async () => {
    const nav = await readFile(join(ROOT, "src", "components", "site", "SiteNav.tsx"), "utf8");
    const tabItemsBlock = nav.slice(nav.indexOf("const tabItems"), nav.indexOf("const moreSheetItems"));
    const tabCount = (tabItemsBlock.match(/href: "/g) ?? []).length;
    expect(tabCount).toBe(4);
    // The sheet keeps a focus trap and modal semantics for thumb + screen-reader use.
    expect(nav).toContain('role="dialog"');
    expect(nav).toContain("aria-modal");
    expect(nav).toContain("aria-expanded");
  });

  it("keeps guest personalisation local — no account gate in the loop", async () => {
    const shelf = await readFile(join(ROOT, "src", "lib", "product", "fixtureShelf.ts"), "utf8");
    expect(shelf).toContain("localStorage");
    const my = await readFile(join(ROOT, "src", "app", "my", "page.tsx"), "utf8");
    expect(my.toLowerCase()).toContain("no account needed");
  });

  it("keeps every canonical-fixture doorway pointed at /predictions/[matchId]", async () => {
    const doorways: Array<[string, string]> = [
      ["src/components/live/LiveScoreBoard.tsx", "predictions/${encodeURIComponent(fixture.matchId)}"],
      ["src/components/product/MyShelves.tsx", "predictions/${encodeURIComponent(fixture.matchId)}"],
      ["src/lib/editorial/generatedStories.ts", "predictions/${encodeURIComponent(row.fixture_external_id)}"]
    ];
    for (const [file, needle] of doorways) {
      const source = await readFile(join(ROOT, file), "utf8");
      expect(source, `${file} must link the canonical fixture page`).toContain(needle);
    }
  });
});
