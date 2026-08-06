import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One product shell, asserted against rendered output.
 *
 * A public audit reported that /engine/performance, /community, /forums and
 * /news still served the pre-v1.7 Home / Tips / Predictions / Live Scores /
 * Results / News / Engine navigation. Verified against production on
 * 2026-08-03 with cache-busting query strings and `Cache-Control: no-cache`:
 * all four serve the consolidated shell, and so do the other thirteen routes
 * checked. The snapshot was stale, not the deploy.
 *
 * It was stale for a measurable reason. Production serves several routes from
 * long-lived caches — `Age: 227741` (2.6 days) on /my and
 * /predictions/bet-slip, `Age: 31831` (8.8 hours) on /engine/performance with
 * `Cache-Status: "Next.js"; hit; fwd=stale`. A crawler that sampled before the
 * consolidation deploy kept serving that copy well after the code changed.
 *
 * So the risk this file guards is not "the shell regressed" — it is "the shell
 * regresses and nobody notices for two days, because the only signal is a
 * cached crawl". The existing product-navigation test checks the nav
 * *definition*; this one renders the components for every public route and
 * checks what a visitor would actually receive.
 */

const PRIMARY_DESTINATIONS = ["Today", "Explore", "Track Record", "My Padi"] as const;
const MOBILE_DESTINATIONS = ["Today", "Explore", "Record", "My Padi", "More"] as const;

/**
 * The pre-v1.7 top level. These words are fine as page copy or as a
 * contextual link — "News" is a legitimate Explore tile — so the assertion
 * below is deliberately about a *navigation* element carrying several of them,
 * which is what a competing shell looks like.
 */
const LEGACY_TOP_LEVEL = ["Home", "Tips", "Live Scores", "Results", "News", "Engine"] as const;

let currentPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

const { DesktopNavLinks, MobileTabBar } = await import("@/components/site/SiteNav");

/** Every route with a page, discovered from disk rather than hand-listed. */
function publicRoutes(dir = "src/app", prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) continue;
    if (entry === "api") continue;
    const route = `${prefix}/${entry}`;
    try {
      statSync(join(path, "page.tsx"));
      found.push(route);
    } catch {
      /* directory without its own page still may hold children */
    }
    found.push(...publicRoutes(path, route));
  }
  return found;
}

const ROUTES = ["/", ...publicRoutes()].sort();
/** Dynamic segments need a concrete value to stand in for a real visit. */
const CONCRETE = (route: string) =>
  route
    .replace("[matchId]", "api-football-1234")
    .replace("[slug]", "premier-league")
    .replace("[handle]", "someone")
    .replace("[category]", "general")
    .replace("[thread]", "a-thread");

function renderShell(pathname: string) {
  currentPathname = pathname;
  return {
    desktop: renderToStaticMarkup(<DesktopNavLinks />),
    mobile: renderToStaticMarkup(<MobileTabBar />)
  };
}

describe("every public route renders the one product shell", () => {
  beforeEach(() => {
    currentPathname = "/";
  });

  it("discovers the real route list rather than a hand-maintained one", () => {
    // A hand-listed set silently stops covering new routes, which is how a
    // shell regression hides.
    expect(ROUTES.length).toBeGreaterThanOrEqual(30);
    for (const expected of ["/", "/engine/performance", "/community", "/forums", "/news", "/track-record", "/my"]) {
      expect(ROUTES, `${expected} missing from discovered routes`).toContain(expected);
    }
  });

  it("puts all four primary destinations in the desktop nav on every route", () => {
    for (const route of ROUTES) {
      const { desktop } = renderShell(CONCRETE(route));
      for (const label of PRIMARY_DESTINATIONS) {
        expect(desktop, `${route} desktop nav is missing ${label}`).toContain(`>${label}</a>`);
      }
    }
  });

  it("puts the consolidated destinations in the mobile nav on every route", () => {
    // Mobile is the matchday context; a route that only works on desktop width
    // is a route people cannot use at kickoff.
    for (const route of ROUTES) {
      const { mobile } = renderShell(CONCRETE(route));
      for (const label of MOBILE_DESTINATIONS) {
        expect(mobile, `${route} mobile nav is missing ${label}`).toContain(`<span>${label}</span>`);
      }
    }
  });

  it("never renders a competing top-level shell", () => {
    for (const route of ROUTES) {
      const { desktop, mobile } = renderShell(CONCRETE(route));
      for (const markup of [desktop, mobile]) {
        const legacy = LEGACY_TOP_LEVEL.filter((label) => new RegExp(`>\\s*${label}\\s*<`).test(markup));
        expect(legacy, `${route} renders legacy top-level items ${legacy.join(", ")}`).toEqual([]);
      }
    }
  });

  it("marks exactly one destination active, and the right one", () => {
    const expectedSurface: Record<string, string> = {
      "/": "Today",
      "/predictions": "Explore",
      "/predictions/today": "Explore",
      "/live-scores": "Explore",
      "/news": "Explore",
      "/community": "Explore",
      "/forums": "Explore",
      "/season-outlooks": "Explore",
      "/track-record": "Track Record",
      "/engine/performance": "Track Record",
      "/predictions/history": "Track Record",
      "/predictions/value-picks": "Track Record",
      "/predictions/decision-engine": "Track Record",
      "/my": "My Padi",
      "/account": "My Padi",
      "/predictions/bet-slip": "My Padi"
    };

    for (const [route, surface] of Object.entries(expectedSurface)) {
      const { desktop } = renderShell(route);
      const active = [...desktop.matchAll(/aria-current="page"[^>]*>([^<]+)</g)].map((m) => m[1]);
      const activeAlt = [...desktop.matchAll(/>([^<]+)<\/a>/g)]
        .filter((_, index) => desktop.split("<a")[index + 1]?.includes('aria-current="page"'))
        .map((m) => m[1]);
      const resolved = active.length ? active : activeAlt;
      expect(resolved, `${route} should highlight exactly one surface, got ${resolved.join("|") || "none"}`).toHaveLength(1);
      expect(resolved[0], `${route} should highlight ${surface}`).toBe(surface);
    }
  });
});

describe("no route escapes the global shell", () => {
  it("keeps a single layout, so a nested one cannot replace the shell", () => {
    // Next renders the closest layout. A second layout.tsx anywhere under
    // src/app would silently own its subtree's chrome.
    const layouts: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        // Normalised: join() emits backslashes on Windows, and the release
        // runs on both.
        else if (entry === "layout.tsx") layouts.push(path.replace(/\\/g, "/"));
      }
    };
    walk("src/app");

    expect(layouts, `expected only the root layout, found ${layouts.join(", ")}`).toEqual(["src/app/layout.tsx"]);
  });

  it("mounts the shell in that layout", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain("<DesktopNavLinks");
    expect(layout).toContain("<MobileTabBar");
    expect(layout).toContain("<SiteFooter");
  });

  it("keeps loading, error and not-found states inside the shell", () => {
    // These render as children of the root layout, so they inherit the nav.
    // Rendering their own <header>/<nav> is what a regression looks like.
    const shells = [
      "src/app/error.tsx",
      "src/app/not-found.tsx",
      "src/app/community/loading.tsx",
      "src/app/forums/loading.tsx",
      "src/app/live-scores/loading.tsx",
      "src/app/predictions/loading.tsx",
      "src/app/predictions/[matchId]/loading.tsx"
    ];
    for (const shell of shells) {
      const source = readFileSync(shell, "utf8");
      expect(source, `${shell} must not render its own site chrome`).not.toMatch(/<header|className="tabbar"|DesktopNavLinks|MobileTabBar/);
      expect(source, `${shell} must not open its own document`).not.toContain("<html");
    }
  });

  it("allows global-error its own document, but requires it to stay branded", () => {
    // Next replaces the root layout for global-error, so it is the one file
    // that cannot inherit the shell. It still must not look like a different
    // product, and it must carry the viewport meta the layout would have given
    // it — without that it renders zoomed out on a phone.
    const source = readFileSync("src/app/global-error.tsx", "utf8");
    expect(source).toContain("<html");
    expect(source).toContain("OddsPadi");
    expect(source).toContain('name="viewport"');
    expect(source).toContain("./globals.css");
  });
});
