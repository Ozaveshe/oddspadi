import { describe, expect, it, vi } from "vitest";

const getWeeklySlate = vi.hoisted(() => vi.fn(async () => ({ scope: "weekly" })));

vi.mock("@/lib/sports/intelligence/pipeline", () => ({ getWeeklySlate }));

import { GET } from "@/app/api/sports/weekly-slate/route";

describe("public weekly slate route", () => {
  it("always uses the stored read-only path", async () => {
    const response = await GET(new Request("https://oddspadi.example/api/sports/weekly-slate"));

    expect(response.status).toBe(200);
    expect(getWeeklySlate).toHaveBeenCalledWith({ ensure: false });
  });
});
