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
    expect(home).toContain("getCachedTodayTipsProduct()");
    expect(home).toContain("getCachedWeeklyTipsProduct()");
    expect(home).toContain("deriveHomepageMatchdayState(daily, liveBoard)");
    expect(home).toContain("matchday.featuredFixture");
    expect(home).toContain("matchday.previewFixtures");
    expect(home).not.toMatch(/loading\.\.\.|loading forever|spinner/i);
  });

  it("keeps the visual system editorial instead of glossy and preserves empty-state CTA contrast", () => {
    const styles = source("src/app/globals.css");
    const layout = source("src/app/layout.tsx");
    expect(styles).toContain(".hero h1 .accent");
    expect(styles).toContain("color: var(--green);");
    expect(styles).not.toContain("linear-gradient(96deg, var(--green)");
    expect(styles).toContain("border-radius: 10px;");
    expect(styles).toContain("background: var(--green-strong);");
    expect(styles).toContain(".home-today-best .empty-state .button");
    expect(styles).toContain("background: var(--surface-2); color: var(--text);");
    expect(styles).not.toContain(".section > .section-title,");
    expect(layout).toContain("data-scroll-behavior=\"smooth\"");
  });

  it("keeps the daily tips surface useful even without a published value pick", () => {
    const slate = source("src/components/odds/IntelligenceSlate.tsx");
    expect(slate).toContain("DailyDecisionOverview");
    expect(slate).toContain("No public pick forced");
    expect(slate).toContain("Evidence Queue");
    expect(slate).toContain("waitingForEvidence");
    expect(slate).toContain("Safer Leans");
    expect(slate).toContain("Watchlist");
    expect(slate).toContain("Analysed Abstentions");
    expect(slate).toContain("if (!product.sections.schedule.length)");
    expect(slate).toContain("fallbackBoard?.fixtures.length");
    expect(slate).toContain("<LiveCoverageFallback board={fallbackBoard}");
    expect(slate).toContain("Nothing real to analyse yet");
    expect(slate).toContain("0 provider rows");
    expect(slate).toContain("Public decision</dt><dd>Withheld");
    expect(slate).toContain("Check the weekly radar");
    expect(slate).toContain("const hasProviderFixtures = product.days.some");
    expect(slate).toContain("No real fixtures across the weekly window");
    expect(slate).toContain("0 generated");
    expect(slate).toContain("Social previews remain hidden");
    const weekly = source("src/app/predictions/week/page.tsx");
    expect(weekly).toContain("product.summary.fixturesFound > 0");
  });

  it("keeps anonymous tips routes read-only and shared-cache backed", () => {
    const reads = source("src/lib/sports/tips/publicReads.ts");
    expect(reads).toContain("getDailyTipsProduct({ day: \"today\", ensure: false })");
    expect(reads).toContain("getDailyTipsProduct({ day: \"tomorrow\", ensure: false })");
    expect(reads).toContain("getWeeklyTipsProduct({ ensure: false })");
    for (const path of [
      "src/app/predictions/page.tsx",
      "src/app/predictions/today/page.tsx",
      "src/app/predictions/tomorrow/page.tsx",
      "src/app/predictions/week/page.tsx",
      "src/app/predictions/value-picks/page.tsx",
      "src/app/api/tips/today/route.ts",
      "src/app/api/tips/tomorrow/route.ts",
      "src/app/api/tips/week/route.ts"
    ]) {
      expect(source(path)).not.toMatch(/get(?:Daily|Weekly)TipsProduct\(/);
    }
  });

  it("renders volatile tips surfaces per request so a cached provider failure can recover", () => {
    for (const path of [
      "src/app/page.tsx",
      "src/app/predictions/page.tsx",
      "src/app/predictions/today/page.tsx",
      "src/app/predictions/tomorrow/page.tsx",
      "src/app/predictions/week/page.tsx",
      "src/app/predictions/value-picks/page.tsx",
      "src/app/predictions/history/page.tsx"
    ]) {
      const page = source(path);
      expect(page).toContain('export const dynamic = "force-dynamic";');
      expect(page).not.toMatch(/export const revalidate\s*=/);
    }

    const health = source("scripts/site-health.mjs");
    expect(health).toContain("checkTipsSurfaceConsistency");
    expect(health).toContain('const todayPage = await checkPage("/predictions/today"');
    expect(health).toContain('const weeklyPage = await checkPage("/predictions/week"');
    expect(health).toContain("HTML is unavailable while API provider status is");
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
    expect(detail).toContain("match-decision-primary");
    expect(detail).toContain("ProbabilityDistribution");
    expect(detail).toContain("CalibrationReliabilityBand");
    expect(detail).toContain("DecisionEvidenceProfile");
    expect(detail).toContain("Fair market chance");
    expect(detail).not.toContain("The short version");
    expect(detail).toContain("Audit-only detail cannot override the canonical public decision above");
  });

  it("surfaces the deterministic probability path, factors, uncertainty, and calibration provenance", () => {
    const evidence = source("src/components/odds/DecisionEvidenceProfile.tsx");
    expect(evidence).toContain("Probability journey");
    expect(evidence).toContain("Decision factor contribution");
    expect(evidence).toContain("Decision-risk profile");
    expect(evidence).toContain("not a statistical confidence level");
    expect(evidence).toContain("Model and calibration provenance");
    expect(evidence).toContain("decision.probabilityTrace");
    expect(evidence).toContain("decision.learningProfile");
  });

  it("shows governed historical calibration without presenting diagnostic risk as statistical certainty", () => {
    const detail = source("src/app/predictions/[matchId]/page.tsx");
    const calibration = source("src/components/odds/CalibrationReliabilityBand.tsx");
    expect(detail).toContain("displayDecision.beliefState.confidenceInterval");
    expect(calibration).toContain("Historical calibration range");
    expect(calibration).toContain("wilson-calibration-bucket");
    expect(calibration).toContain("interval.detail");
    expect(calibration).toContain("not a range of possible match outcomes or a guarantee");
  });

  it("renders verified stored odds movement without inferring a trend from one price", () => {
    const detail = source("src/app/predictions/[matchId]/page.tsx");
    const chart = source("src/components/odds/OddsMovementChart.tsx");
    expect(detail).toContain("OddsMovementChart");
    expect(detail).toContain("oddsHistory");
    expect(chart).toContain("Verified price tape");
    expect(chart).toContain("Movement needs at least two verified capture times");
    expect(chart).toContain("This is observed movement, not proof that the move is correct");
  });

  it("shows whether backtest weights came from a separate training window", () => {
    const performance = source("src/app/engine/performance/page.tsx");
    expect(performance).toContain("Weight source");
    expect(performance).toContain('row.learnedWeightsTrainingOnly ? "training only" : "unverified"');
    expect(performance).toContain("learning fixtures");
    expect(performance).toContain("Odds evidence");
    expect(performance).toContain("verified close");
    expect(performance).toContain("legacy run or missing audit");
  });

  it("provides a readable mobile market analysis instead of relying on the desktop table", () => {
    const markets = source("src/components/odds/OddsTable.tsx");
    expect(markets).toContain("market-table-desktop");
    expect(markets).toContain('className="market-mobile-list"');
    expect(markets).toContain("Model chance");
    expect(markets).toContain("Fair market");
    expect(markets).toContain("Price details");
  });

  it("presents the engine as an evidence ledger without AI product language", () => {
    const engine = source("src/app/predictions/decision-engine/page.tsx");
    expect(engine).toContain("engine-run-metrics");
    expect(engine).toContain("engine-empty-ledger");
    expect(engine).toContain("Research-to-runtime authority");
    expect(engine).toContain("Benchmark evidence is not runtime authority");
    expect(engine).toContain("getDailyTipsProduct({ ensure: false })");
    expect(engine).toContain("Waiting for provider data");
    expect(engine).not.toContain("AI Decision Engine");
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
