import { afterEach, describe, expect, it, vi } from "vitest";
import { withApiHandler } from "@/app/api/sports/_utils";

describe("public API error boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs unexpected failures server-side without returning implementation detail", async () => {
    const error = new Error("relation op_private_model does not exist at postgres://secret-host");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = withApiHandler(async () => {
      throw error;
    });

    const response = await handler(new Request("https://oddspadi.com/api/sports/predictions"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, data: null, error: "Something went wrong on our side." });
    expect(JSON.stringify(body)).not.toContain("op_private_model");
    expect(JSON.stringify(body)).not.toContain("secret-host");
    expect(consoleError).toHaveBeenCalledWith("[api] /api/sports/predictions failed:", error);
  });
});
