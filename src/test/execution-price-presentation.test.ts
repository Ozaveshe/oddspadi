import { describe, expect, it } from "vitest";
import { buildExecutionPricePresentation } from "@/lib/sports/prediction/executionPricePresentation";

describe("execution price presentation", () => {
  it("makes a best-price claim only with named bookmaker provenance", () => {
    expect(buildExecutionPricePresentation({
      bookmaker: { id: "book-a", name: "Book A" },
      priceObservedAt: "2026-07-18T08:00:00Z",
      priceMethod: "best-price-per-selection-v1"
    })).toMatchObject({
      state: "best-price",
      label: "Best executable quote",
      source: "Book A",
      timestamp: expect.stringContaining("18 Jul")
    });
  });

  it("uses an explicit incomplete-provenance state instead of inventing a source", () => {
    expect(buildExecutionPricePresentation({ priceMethod: "best-price-per-selection-v1" })).toMatchObject({
      state: "source-missing",
      label: "Quote provenance incomplete",
      source: "Bookmaker source unavailable",
      timestamp: "Selection update time unavailable",
      detail: expect.stringContaining("Do not treat this as a verified best-price claim")
    });
  });
});
