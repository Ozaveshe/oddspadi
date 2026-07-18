import { describe, expect, it } from "vitest";
import { buildBestExecutableQuote } from "@/lib/sports/executableOdds";

describe("best executable odds", () => {
  it("shops every selection independently and retains exact bookmaker provenance", () => {
    const quote = buildBestExecutableQuote([
      {
        bookmaker: { id: "book-a", name: "Book A" },
        observedAt: "2026-07-18T08:00:00Z",
        selections: [
          { id: "home", label: "Home", decimalOdds: 1.9 },
          { id: "away", label: "Away", decimalOdds: 2.05 }
        ]
      },
      {
        bookmaker: { id: "book-b", name: "Book B" },
        observedAt: "2026-07-18T08:02:00Z",
        selections: [
          { id: "home", label: "Home", decimalOdds: 1.94 },
          { id: "away", label: "Away", decimalOdds: 2 }
        ]
      }
    ]);

    expect(quote?.bookmaker).toBeUndefined();
    expect(quote?.selections).toEqual([
      expect.objectContaining({ id: "home", decimalOdds: 1.94, bookmaker: { id: "book-b", name: "Book B" }, observedAt: "2026-07-18T08:02:00Z" }),
      expect.objectContaining({ id: "away", decimalOdds: 2.05, bookmaker: { id: "book-a", name: "Book A" }, observedAt: "2026-07-18T08:00:00Z" })
    ]);
  });

  it("uses the newer provider quote to break an equal-price tie deterministically", () => {
    const quote = buildBestExecutableQuote([
      { bookmaker: { id: "old", name: "Old" }, observedAt: "2026-07-18T07:55:00Z", selections: [{ id: "a", label: "A", decimalOdds: 2 }, { id: "b", label: "B", decimalOdds: 2 }] },
      { bookmaker: { id: "new", name: "New" }, observedAt: "2026-07-18T08:05:00Z", selections: [{ id: "a", label: "A", decimalOdds: 2 }, { id: "b", label: "B", decimalOdds: 2 }] }
    ]);

    expect(quote?.bookmaker).toEqual({ id: "new", name: "New" });
    expect(quote?.selections.every((selection) => selection.bookmaker?.id === "new")).toBe(true);
  });

  it("refuses to combine prices from different point lines", () => {
    expect(buildBestExecutableQuote([
      { point: -3.5, selections: [{ id: "home", label: "Home -3.5", decimalOdds: 1.9 }, { id: "away", label: "Away +3.5", decimalOdds: 1.9 }] },
      { point: -4, selections: [{ id: "home", label: "Home -4", decimalOdds: 2 }, { id: "away", label: "Away +4", decimalOdds: 1.82 }] }
    ])).toBeNull();
  });
});
