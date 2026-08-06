import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Canonicals, redirects, orphans and carried context.
 *
 * These were the four routing properties nothing checked. The shell itself was
 * already consolidated — verified against production on 2026-08-03 — but a
 * stale crawl still reported the pre-v1.7 navigation for two days, because the
 * only signal anyone had was a cached snapshot. The lesson generalises: a
 * routing property with no test is a property you learn about from a crawler.
 */

const APP = "src/app";

function pageFiles(dir = APP, prefix = ""): { route: string; file: string }[] {
  const found: { route: string; file: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (!statSync(path).isDirectory() || entry === "api") continue;
    const route = `${prefix}/${entry}`;
    try {
      statSync(join(path, "page.tsx"));
      found.push({ route, file: join(path, "page.tsx").replace(/\\/g, "/") });
    } catch {
      /* nested-only directory */
    }
    found.push(...pageFiles(path, route));
  }
  return found;
}

const PAGES = [{ route: "/", file: `${APP}/page.tsx` }, ...pageFiles()];
const source = (file: string) => readFileSync(file, "utf8");

/** Routes deliberately kept out of the index. */
const NOINDEX = ["/my", "/account", "/offline", "/tips", "/community/u/[handle]"];

describe("canonical URLs", () => {
  it("gives every indexable page a canonical, and every noindex page none", () => {
    for (const { route, file } of PAGES) {
      const text = source(file);
      const declaresCanonical = /alternates:\s*\{[^}]*canonical/.test(text) || text.includes("pageMetadata(");
      const declaresNoIndex = /noIndex:\s*true|index:\s*false/.test(text);

      if (NOINDEX.includes(route)) {
        expect(declaresNoIndex, `${route} is meant to be noindex but does not say so`).toBe(true);
        continue;
      }
      expect(declaresCanonical, `${route} is indexable with no self-referencing canonical`).toBe(true);
    }
  });

  it("routes canonicals through one builder or an explicit alternates block, never a bare title", () => {
    // Next merges metadata shallowly: a page that sets only `title` inherits
    // the root layout's openGraph wholesale, including its url, and tells every
    // crawler the shared page *was* the homepage. pageMetadata() exists to stop
    // that; a page opting out must at least set alternates itself.
    for (const { route, file } of PAGES) {
      const text = source(file);
      if (!/export const metadata|generateMetadata/.test(text)) continue;
      if (NOINDEX.includes(route)) continue;
      const safe = text.includes("pageMetadata(") || /alternates:\s*\{[^}]*canonical/.test(text);
      expect(safe, `${route} declares metadata without a canonical`).toBe(true);
    }
  });

  it("never points two indexable routes at the same canonical", () => {
    const canonicals = new Map<string, string>();
    for (const { route, file } of PAGES) {
      if (NOINDEX.includes(route)) continue;
      const path = /pageMetadata\(\{[\s\S]*?path:\s*"([^"]+)"/.exec(source(file))?.[1];
      if (!path) continue;
      const existing = canonicals.get(path);
      expect(existing, `${route} and ${existing} both claim canonical ${path}`).toBeUndefined();
      canonicals.set(path, route);
    }
  });
});

describe("redirects", () => {
  it("keeps /tips a permanent redirect that does not compete in the index", () => {
    // 307 would tell crawlers /tips is still canonical and leave it competing
    // with /predictions/today. 308 consolidates.
    const tips = source(`${APP}/tips/page.tsx`);
    expect(tips).toContain("permanentRedirect");
    expect(tips).not.toMatch(/\bredirect\(\s*"/);
    expect(tips).toMatch(/index:\s*false/);
    expect(tips).toContain('"/predictions/today"');
  });

  it("does not redirect to a route that itself redirects", () => {
    // A chain costs a round trip and dilutes the signal that consolidation is
    // meant to concentrate.
    const destinations = PAGES.flatMap(({ file }) => {
      const text = source(file);
      return [...text.matchAll(/permanentRedirect\(\s*"([^"]+)"/g)].map((m) => m[1]);
    });
    const redirectingRoutes = new Set(
      PAGES.filter(({ file }) => source(file).includes("permanentRedirect(")).map(({ route }) => route)
    );
    for (const destination of destinations) {
      expect(redirectingRoutes.has(destination), `redirect chain: something points at ${destination}, which also redirects`).toBe(false);
    }
  });
});

describe("no orphaned routes", () => {
  it("keeps every public route reachable from navigation, a hub, or a documented context", () => {
    // A route nobody links to is a route nobody finds, and it still costs
    // crawl budget and maintenance.
    const nav = source("src/components/site/SiteNav.tsx");
    const routeMap = source("docs/route-map.md");
    const allSource = PAGES.map(({ file }) => source(file)).join("\n")
      + source("src/components/site/SiteFooter.tsx");

    const orphans: string[] = [];
    for (const { route } of PAGES) {
      if (route === "/") continue;
      const concrete = route.replace(/\[[^\]]+\]/g, "");
      // Links appear three ways: a JSX attribute, a template literal, and an
      // object literal in a nav/footer data array — the footer lists
      // /daily-double as `{ href: "/daily-double", label: ... }`, which an
      // attribute-only matcher reports as an orphan.
      const linked = nav.includes(`"${route}"`)
        || allSource.includes(`href="${route}"`)
        || allSource.includes(`href: "${route}"`)
        || allSource.includes(`href={\`${concrete}`)
        || new RegExp(`\`${concrete.replace(/\//g, "\\/")}`).test(allSource);
      const documented = routeMap.includes(`\`${route}\``);
      if (!linked && !documented) orphans.push(route);
    }
    expect(orphans, `unreachable and undocumented: ${orphans.join(", ")}`).toEqual([]);
  });

  it("documents every route in the route map", () => {
    const routeMap = source("docs/route-map.md");
    const undocumented = PAGES.map(({ route }) => route).filter((route) => !routeMap.includes(`\`${route}\``));
    expect(undocumented, `missing from docs/route-map.md: ${undocumented.join(", ")}`).toEqual([]);
  });
});

describe("context survives navigation", () => {
  it("keeps the timezone control in the global shell, not on individual pages", () => {
    // Mounted in the layout, the selected timezone survives every navigation
    // for free. Mounted per page, it resets whenever a route forgets it — and
    // kickoff times are the one thing a matchday visitor cannot afford to have
    // silently change.
    const layout = source(`${APP}/layout.tsx`);
    expect(layout).toMatch(/TimezonePicker|timezone-picker/);

    const perPage = PAGES.filter(({ file }) => /timezone-picker|<TimezonePicker/.test(source(file)));
    expect(perPage.map((p) => p.route), "timezone control duplicated onto a page").toEqual([]);
  });

  it("keeps fixture links canonical so context is never lost to a duplicate page", () => {
    // Every doorway to a fixture must land on the one canonical match page;
    // a second fixture URL would fork the selected market and source page.
    const offenders: string[] = [];
    for (const { route, file } of PAGES) {
      const text = source(file);
      if (/href={`\/(?!predictions\/)[a-z-]+\/\$\{[^}]*(?:fixture|match)/i.test(text)) offenders.push(route);
    }
    expect(offenders, `non-canonical fixture doorway: ${offenders.join(", ")}`).toEqual([]);
  });
});
