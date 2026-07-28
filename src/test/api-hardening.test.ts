import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIsoDateParam, parseSportsQuery } from "@/app/api/sports/_utils";
import { isKnownSport, isSupportedSport } from "@/lib/sports/service";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { PRIVATE_JSON_HEADERS, privateJson } from "@/lib/security/privateJson";
import { parseRequestedSports } from "@/lib/sports/intelligence/auth";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftIso(days: number): string {
  const date = new Date(`${todayIso()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("date parameters", () => {
  it("accepts a real date inside the window", () => {
    expect(parseIsoDateParam(shiftIso(3))).toEqual({ date: shiftIso(3) });
    expect(parseIsoDateParam(shiftIso(-3))).toEqual({ date: shiftIso(-3) });
  });

  it("falls back when the parameter is absent or empty", () => {
    expect(parseIsoDateParam(null, "fallback")).toEqual({ date: "fallback" });
    expect(parseIsoDateParam("", "fallback")).toEqual({ date: "fallback" });
  });

  it("rejects impossible dates that still match the ISO shape", () => {
    // The old check was format-only, so these all reached the provider.
    for (const value of ["2026-99-99", "2026-02-30", "2026-13-01", "0000-00-00"]) {
      expect(parseIsoDateParam(value)).toHaveProperty("error");
    }
  });

  it("rejects dates far outside the product's window", () => {
    // These are the values that would otherwise mint unbounded CDN cache keys
    // and unbounded upstream provider calls, one per distinct date.
    expect(parseIsoDateParam("1900-01-01")).toHaveProperty("error");
    expect(parseIsoDateParam("9999-12-31")).toHaveProperty("error");
    expect(parseIsoDateParam(shiftIso(401))).toHaveProperty("error");
    expect(parseIsoDateParam(shiftIso(-401))).toHaveProperty("error");
  });

  it("rejects malformed input", () => {
    for (const value of ["not-a-date", "2026-1-1", "2026-01-01T00:00:00Z", "  "]) {
      expect(parseIsoDateParam(value)).toHaveProperty("error");
    }
  });
});

describe("sports parameter", () => {
  function requestWith(query: string): Request {
    return new Request(`https://oddspadi.example/api/cron/refresh-odds?${query}`);
  }

  it("accepts the supported sports", () => {
    expect(parseRequestedSports(requestWith("sports=football,tennis"))).toEqual({
      sports: ["football", "tennis"]
    });
  });

  it("rejects an oversized value before splitting it", () => {
    const oversized = `sports=${"football,".repeat(200)}`;
    expect(parseRequestedSports(requestWith(oversized))).toHaveProperty("error");
  });

  it("rejects unsupported sports", () => {
    expect(parseRequestedSports(requestWith("sports=cricket"))).toHaveProperty("error");
  });
});

describe("bounded JSON reader", () => {
  function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
    return new Request("https://oddspadi.example/api/community/posts", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body
    });
  }

  it("reads a small well-formed body", async () => {
    const result = await readBoundedJson<{ body: string }>(jsonRequest(JSON.stringify({ body: "hi" })), 1_024);
    expect(result).toEqual({ ok: true, value: { body: "hi" } });
  });

  it("rejects an oversized body even when Content-Length is absent", async () => {
    // The reader must cap on measured bytes, not on the declared header: a
    // client that omits Content-Length previously had its whole body buffered
    // into function memory before the size check ran.
    const oversized = JSON.stringify({ body: "x".repeat(4_000) });
    const request = jsonRequest(oversized);
    request.headers.delete("content-length");
    const result = await readBoundedJson(request, 1_024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("rejects a non-JSON content type", async () => {
    const result = await readBoundedJson(jsonRequest("{}", { "content-type": "text/plain" }), 1_024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(415);
  });

  it("rejects malformed JSON", async () => {
    const result = await readBoundedJson(jsonRequest("{nope"), 1_024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });
});

describe("session-scoped responses", () => {
  it("are never cacheable and vary on the session cookie", () => {
    const response = privateJson({ ok: true });
    expect(response.headers.get("cache-control")).toBe(PRIVATE_JSON_HEADERS["Cache-Control"]);
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("let a caller add headers without dropping the cache directives", () => {
    const response = privateJson({ ok: true }, { status: 429, headers: { "Retry-After": "30" } });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("is used by every route that reads the visitor's Supabase session", async () => {
    const roots = ["src/app/api/account", "src/app/api/community"];
    const offenders: string[] = [];

    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (entry.name !== "route.ts") continue;
        const source = await readFile(path, "utf8");
        // A bare `Response.json` here would ship session-derived data with no
        // cache directive and no Vary, which a shared cache may cross-serve.
        if (/\bResponse\.json\(/.test(source)) offenders.push(path);
      }
    }

    await Promise.all(roots.map(walk));
    expect(offenders).toEqual([]);
  });
});

describe("transport security headers", () => {
  it("declares HSTS and cross-origin isolation in both deploy configs", async () => {
    const [netlifyConfig, nextConfig] = await Promise.all([
      readFile("netlify.toml", "utf8"),
      readFile("next.config.mjs", "utf8")
    ]);

    for (const config of [netlifyConfig, nextConfig]) {
      expect(config).toContain("Strict-Transport-Security");
      expect(config).toContain("max-age=63072000; includeSubDomains; preload");
      expect(config).toContain("Cross-Origin-Opener-Policy");
      expect(config).toContain("Cross-Origin-Resource-Policy");
    }
  });
});

describe("sport parameter", () => {
  /**
   * The catalogue carries six sports, three of them `active: false`. The
   * validator checked only that the id existed, so `?sport=cricket` passed,
   * reached a provider that returns nothing for it, and had that empty response
   * cached under its own `Netlify-Vary` key — instead of a 400. The sport
   * picker already disabled those options in the UI.
   */
  it("accepts only sports the product actually serves", () => {
    for (const sport of ["football", "basketball", "tennis"]) {
      expect(isSupportedSport(sport)).toBe(true);
      expect(isKnownSport(sport)).toBe(true);
    }
    for (const sport of ["cricket", "rugby", "handball"]) {
      expect(isSupportedSport(sport)).toBe(false);
      // Still in the catalogue — the distinction is deliberate.
      expect(isKnownSport(sport)).toBe(true);
    }
    expect(isSupportedSport("quidditch")).toBe(false);
    expect(isKnownSport("quidditch")).toBe(false);
    expect(isSupportedSport(null)).toBe(false);
  });

  it("rejects an inactive sport at the route boundary", () => {
    const request = new Request("https://oddspadi.example/api/sports/fixtures?sport=cricket");
    expect(parseSportsQuery(request)).toEqual({ error: "Invalid sport." });
  });
});
