import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseUnavailable } from "@/lib/security/databaseError";

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(target) : entry.name === "route.ts" ? [target] : [];
  }));
  return nested.flat();
}

describe("database error disclosure security", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns a generic unavailable response and logs only a bounded code", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = databaseUnavailable(
      "profile update",
      { code: "PGRST999", message: "postgres://secret-host/op_profiles" } as { code: string; message: string },
      "Could not update your profile right now."
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "Could not update your profile right now." });
    expect(JSON.stringify(body)).not.toContain("secret-host");
    expect(consoleError).toHaveBeenCalledWith("[database] profile update failed", { code: "PGRST999" });
  });

  it("never returns raw database messages from account or community routes", async () => {
    const files = [
      ...(await routeFiles("src/app/api/account")),
      ...(await routeFiles("src/app/api/community"))
    ];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(/error:\s*error\.message|note:\s*error\.message/);
    }
  });
});
