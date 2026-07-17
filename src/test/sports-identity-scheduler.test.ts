import { describe, expect, it } from "vitest";
import { config } from "../../netlify/functions/sports-identity-enrichment-sweep";

describe("sports identity scheduler", () => {
  it("runs once daily after the main fixture import window", () => {
    expect(config.schedule).toBe("10 3 * * *");
  });
});
