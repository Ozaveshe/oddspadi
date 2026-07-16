import { describe, expect, it, vi } from "vitest";

const getDailySlate = vi.hoisted(() => vi.fn(async () => ({ scope: "daily" })));

vi.mock("@/lib/sports/intelligence/pipeline", () => ({ getDailySlate }));

import { GET } from "@/app/api/sports/daily-slate/route";

describe("public daily slate route", () => {
  it("always uses the stored read-only path", async () => {
    const response = await GET(new Request("https://oddspadi.example/api/sports/daily-slate"));

    expect(response.status).toBe(200);
    expect(getDailySlate).toHaveBeenCalledWith({ ensure: false });
  });
});
