import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toPublicReason, toPublicStatusLabel, sanitisePublicProvider } from "@/lib/security/publicErrorText";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("public error text", () => {
  it("collapses timeout/DB text to a coarse delayed phrase, never the raw text", () => {
    const reason = toPublicReason("Storage: canceling statement due to statement timeout");
    expect(reason).not.toMatch(/statement|timeout|canceling|Storage/);
    expect(reason).toMatch(/delayed/i);
  });

  it("maps run statuses to a coarse public state", () => {
    expect(toPublicStatusLabel("completed")).toBe("operational");
    expect(toPublicStatusLabel("failed")).toBe("unavailable");
    expect(toPublicStatusLabel("partial")).toBe("partial");
  });

  it("sanitises the provider block: no names, no run ids, no raw errors", () => {
    const safe = sanitisePublicProvider({
      status: "failed",
      providers: ["api-football", "the-odds-api"],
      lastRun: { status: "failed", finishedAt: "2026-08-09T00:00:00Z" }
    });
    expect(safe).toEqual({ status: "unavailable", sourceCount: 2, lastUpdatedAt: "2026-08-09T00:00:00Z" });
    expect(JSON.stringify(safe)).not.toMatch(/api-football|the-odds-api/);
  });
});

describe("consumer pages do not leak provider names, raw errors, thresholds or internal paths", () => {
  const CONSUMER_PAGES = [
    "src/components/odds/IntelligenceSlate.tsx",
    "src/app/predictions/decision-engine/page.tsx",
    "src/app/engine/performance/page.tsx",
    "src/app/track-record/page.tsx"
  ];

  it("does not render provider slugs by joining the providers array", () => {
    for (const page of CONSUMER_PAGES) {
      expect(read(page), `${page} joins provider names`).not.toMatch(/provider\.providers\.join|engineHealth\.providers\.join/);
    }
  });

  it("does not print the live value-edge threshold number", () => {
    expect(read("src/app/predictions/decision-engine/page.tsx")).not.toMatch(/minimumValueEdge \* 100/);
  });

  it("does not render internal table names or doc paths to the public", () => {
    for (const page of ["src/app/track-record/page.tsx", "src/app/predictions/decision-engine/page.tsx"]) {
      const source = read(page);
      expect(source, `${page} names op_ tables`).not.toMatch(/<code>op_[a-z_]+<\/code>/);
      expect(source, `${page} names docs paths`).not.toMatch(/docs\/[a-z-]+\.md/);
    }
  });
});

describe("public data reads never embed raw exception text", () => {
  it("history, storedFixture and report reasons are coarse", () => {
    expect(read("src/lib/sports/prediction/history.ts")).not.toMatch(/could not be read: \$\{detail\}/);
    expect(read("src/lib/sports/intelligence/storedFixture.ts")).not.toMatch(/could not be read: \$\{error\.message\}/);
    expect(read("src/lib/sports/performance/report.ts")).toContain("toPublicReason(ledger.reason)");
  });
});
