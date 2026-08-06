import { describe, expect, it } from "vitest";
import {
  CARRIED_CONTEXT_KEYS,
  readNavigationContext,
  withNavigationContext
} from "@/lib/navigation/context";
import { PRIMARY_SURFACES, SURFACE_CONTEXT, surfaceForPath } from "@/lib/navigation/surfaces";

/**
 * Two navigation properties that had no test, both found by reading link
 * construction rather than by crawling.
 *
 * 1. `/predictions?sport=tennis` filters the board, but every fixture link was
 *    built as `/predictions/${id}` with no query, so an in-page link back
 *    dropped the filter. The browser back button restores it, which is why it
 *    stayed invisible: it only breaks on forward links.
 *
 * 2. Surface ownership was declared inside SiteNav and nowhere else, so
 *    analytics could not label a view without duplicating it — and a duplicate
 *    is a thing that drifts.
 */

describe("carried navigation context", () => {
  it("carries only the keys that change what the page is", () => {
    // Timezone and odds format are display preferences kept in storage
    // precisely so they never fork a URL into indexable variants.
    expect([...CARRIED_CONTEXT_KEYS]).toEqual(["sport", "date"]);
  });

  it("reads context from URLSearchParams and from a plain params object", () => {
    expect(readNavigationContext(new URLSearchParams("sport=tennis&date=2026-08-03")))
      .toEqual({ sport: "tennis", date: "2026-08-03" });
    expect(readNavigationContext({ sport: "basketball" })).toEqual({ sport: "basketball" });
    // Next gives repeated params as an array.
    expect(readNavigationContext({ sport: ["tennis", "football"] })).toEqual({ sport: "tennis" });
  });

  it("ignores empty, blank and absent values", () => {
    expect(readNavigationContext(undefined)).toEqual({});
    expect(readNavigationContext({ sport: "", date: "   " })).toEqual({});
  });

  it("appends carried context to an internal link", () => {
    expect(withNavigationContext("/predictions", { sport: "tennis" })).toBe("/predictions?sport=tennis");
    expect(withNavigationContext("/predictions/abc", { sport: "tennis", date: "2026-08-03" }))
      .toBe("/predictions/abc?sport=tennis&date=2026-08-03");
  });

  it("leaves a link untouched when there is nothing to carry", () => {
    // An unfiltered board must not grow a trailing "?" on every link.
    expect(withNavigationContext("/predictions", {})).toBe("/predictions");
  });

  it("never overwrites a key the link already sets", () => {
    // The sport switcher links explicitly to ?sport=football; ambient tennis
    // context must not win over a deliberate destination.
    expect(withNavigationContext("/predictions?sport=football", { sport: "tennis" }))
      .toBe("/predictions?sport=football");
  });

  it("preserves an existing query and fragment", () => {
    expect(withNavigationContext("/predictions?league=epl#board", { sport: "tennis" }))
      .toBe("/predictions?league=epl&sport=tennis#board");
  });

  it("never rewrites an external or protocol-relative link", () => {
    for (const href of ["https://example.com/x", "mailto:a@b.c", "//cdn.example.com/x"]) {
      expect(withNavigationContext(href, { sport: "tennis" })).toBe(href);
    }
  });

  it("round-trips: board -> fixture -> board keeps the filter", () => {
    const board = new URLSearchParams("sport=tennis");
    const context = readNavigationContext(board);
    const toFixture = withNavigationContext("/predictions/api-tennis-99", context);
    const backToBoard = withNavigationContext("/predictions", readNavigationContext(new URLSearchParams(toFixture.split("?")[1])));
    expect(backToBoard).toBe("/predictions?sport=tennis");
  });
});

describe("surface ownership is declared once", () => {
  it("resolves every top-level surface to itself", () => {
    for (const surface of PRIMARY_SURFACES) {
      expect(surfaceForPath(surface), `${surface} should own itself`).toBe(surface);
    }
  });

  it("reads the four prediction routes by where they belong, not by URL nesting", () => {
    // Explore owns /predictions, but results and the engine are evidence and a
    // bet slip is personal.
    expect(surfaceForPath("/predictions")).toBe("/explore");
    expect(surfaceForPath("/predictions/today")).toBe("/explore");
    expect(surfaceForPath("/predictions/history")).toBe("/track-record");
    expect(surfaceForPath("/predictions/value-picks")).toBe("/track-record");
    expect(surfaceForPath("/predictions/decision-engine")).toBe("/track-record");
    expect(surfaceForPath("/predictions/bet-slip")).toBe("/my");
  });

  it("gives /daily-double a surface, which it previously had none of", () => {
    // It matched no prefix, so the nav highlighted nothing at all on that page.
    expect(surfaceForPath("/daily-double")).toBe("/");
  });

  it("returns null outside the four surfaces rather than guessing", () => {
    for (const route of ["/privacy", "/terms", "/offline", "/about"]) {
      expect(surfaceForPath(route), `${route} should not claim a surface`).toBeNull();
    }
  });

  it("labels every surface for analytics", () => {
    for (const surface of PRIMARY_SURFACES) {
      expect(SURFACE_CONTEXT[surface], `${surface} has no analytics label`).toMatch(/^[a-z_]+$/);
    }
  });
});
