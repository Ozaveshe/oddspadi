import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("live OddsPadi product UI contract", () => {
  it("renders the homepage as a resolved live-product surface", () => {
    const home = source("src/app/page.tsx");
    expect(home).toContain("Your padi for <span className=\"accent\">smarter match reads.</span>");
    expect(home).toContain("home-engine-strip");
    expect(home).toContain("Daily Tips Preview");
    expect(home).toContain("<LiveTicker initial={liveBoard}");
    expect(home).not.toMatch(/loading\.\.\.|loading forever|spinner/i);
  });

  it("keeps the daily tips surface useful even without a published value pick", () => {
    const slate = source("src/components/odds/IntelligenceSlate.tsx");
    expect(slate).toContain("'s Full Schedule");
    expect(slate).toContain("Safer Leans");
    expect(slate).toContain("Watchlist");
    expect(slate).toContain("No-Pick Matches");
  });

  it("shows leans, watchlist, and no-pick reasons on the empty value-picks state", () => {
    const valuePicks = source("src/app/predictions/value-picks/page.tsx");
    expect(valuePicks).toContain("No published value picks right now");
    expect(valuePicks).toContain("Here are today's leans");
    expect(valuePicks).toContain("Here is the watchlist");
    expect(valuePicks).toContain("Why today has no picks");
  });

  it("uses the canonical public decision before any match audit detail", () => {
    const detail = source("src/app/predictions/[matchId]/page.tsx");
    expect(detail).toContain("const canonical = prediction.canonicalDecision");
    expect(detail.indexOf("match-decision-hero")).toBeGreaterThan(-1);
    expect(detail.indexOf("match-decision-hero")).toBeLessThan(detail.indexOf("Advanced engine audit"));
    expect(detail).not.toContain("The short version");
    expect(detail).toContain("Audit-only detail cannot override the canonical public decision above");
  });

  it("keeps the advanced engine audit collapsed by default", () => {
    const detail = source("src/app/predictions/[matchId]/page.tsx");
    expect(detail).toMatch(/<details className="fold">\s*<summary>Advanced engine audit<\/summary>/);
    expect(detail).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
  });

  it("uses the requested desktop, mobile, and More navigation paths", () => {
    const navigation = source("src/components/site/SiteNav.tsx");
    for (const label of ["Home", "Tips", "Predictions", "Live Scores", "Results", "News", "Engine"]) expect(navigation).toContain(`label: "${label}"`);
    for (const label of ["Weekly", "Value Picks", "Tables", "Forums", "Slip Check"]) expect(navigation).toContain(`label: "${label}"`);
    expect(navigation).toContain('<span>More</span>');
    expect(navigation).toContain('aria-label="Quick navigation"');
  });
});
