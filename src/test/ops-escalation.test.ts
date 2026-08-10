import { describe, expect, it } from "vitest";
import {
  ESCALATION_PATHS,
  escalationPath,
  escalationPathForCategory,
  isEscalationPath
} from "@/lib/ops/escalation";

describe("escalation paths", () => {
  it("defines the six named paths, each routed to a role not a person", () => {
    const ids = ESCALATION_PATHS.map((p) => p.id);
    expect([...ids].sort()).toEqual(
      [
        "security",
        "data_corruption",
        "legal_community_safety",
        "mass_provider_failure",
        "model_contradiction",
        "public_record_correction"
      ].sort()
    );
    for (const p of ESCALATION_PATHS) {
      expect(p.target.length, `${p.id} needs a target owner`).toBeGreaterThan(0);
      expect(p.trigger.length).toBeGreaterThan(0);
    }
  });

  it("gives the safety-critical paths a critical severity floor", () => {
    for (const id of ["security", "data_corruption", "legal_community_safety", "mass_provider_failure"]) {
      expect(escalationPath(id)?.minimumSeverity, id).toBe("critical");
    }
  });

  it("suggests a default path from the case category, or null when unmapped", () => {
    expect(escalationPathForCategory("identity_mismatch")).toBe("data_corruption");
    expect(escalationPathForCategory("record_mismatch")).toBe("data_corruption");
    expect(escalationPathForCategory("provider_outage")).toBe("mass_provider_failure");
    expect(escalationPathForCategory("community_abuse")).toBe("legal_community_safety");
    expect(escalationPathForCategory("settlement_exception")).toBe("public_record_correction");
    expect(escalationPathForCategory("result_conflict")).toBe("public_record_correction");
    // A category with no obvious owner returns null rather than misrouting.
    expect(escalationPathForCategory("stale_fixture")).toBeNull();
    expect(escalationPathForCategory(null)).toBeNull();
  });

  it("validates a path id", () => {
    expect(isEscalationPath("security")).toBe(true);
    expect(isEscalationPath("made_up")).toBe(false);
    expect(isEscalationPath(42)).toBe(false);
  });
});
