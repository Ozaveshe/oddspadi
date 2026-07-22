import { describe, expect, it, vi } from "vitest";
import { readRowsInChunks } from "@/lib/sports/intelligence/repository";

describe("stored slate repository chunked reads", () => {
  it("keeps large PostgREST in filters below the URL-safe batch limit", async () => {
    const read = vi.fn(async (ids: string[]) => ({
      data: ids.map((id) => ({ id })),
      error: null
    }));
    const ids = Array.from({ length: 205 }, (_, index) => `fixture-db-${index}`);

    const result = await readRowsInChunks(ids, read);

    expect(read.mock.calls.map(([batch]) => batch.length)).toEqual([100, 100, 5]);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(205);
  });

  it("stops after a failed chunk and preserves the upstream error", async () => {
    const read = vi.fn(async (ids: string[]) => ids[0] === "fixture-db-100"
      ? { data: null, error: { message: "Bad Request", code: "PGRST100" } }
      : { data: ids.map((id) => ({ id })), error: null });
    const ids = Array.from({ length: 205 }, (_, index) => `fixture-db-${index}`);

    const result = await readRowsInChunks(ids, read);

    expect(read).toHaveBeenCalledTimes(2);
    expect(result.error).toMatchObject({ message: "Bad Request", code: "PGRST100" });
    expect(result.data).toHaveLength(100);
  });
});
