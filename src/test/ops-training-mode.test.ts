import { describe, expect, it } from "vitest";
import {
  isTrainingMode,
  opsMode,
  guardCaseAction,
  assertProductionWriteAllowed,
  TrainingViolation
} from "@/lib/ops/trainingMode";

describe("isTrainingMode", () => {
  it("is on only for an explicit truthy flag", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isTrainingMode({ ODDSPADI_OPS_TRAINING: v }), v).toBe(true);
    }
    for (const v of [undefined, "", "0", "false", "no", "off"]) {
      expect(isTrainingMode({ ODDSPADI_OPS_TRAINING: v }), String(v)).toBe(false);
    }
    expect(opsMode({})).toBe("live");
    expect(opsMode({ ODDSPADI_OPS_TRAINING: "1" })).toBe("training");
  });
});

describe("guardCaseAction", () => {
  const planned = { describe: () => "assign case abc to analyst-42", payload: { assignee: "analyst-42" } };

  it("previews and withholds the payload in training mode", () => {
    const result = guardCaseAction("training", planned);
    expect(result.status).toBe("training-preview");
    if (result.status === "training-preview") {
      expect(result.wouldHave).toBe("assign case abc to analyst-42");
    }
    // No payload is returned for persistence.
    expect(result).not.toHaveProperty("action");
  });

  it("hands back the payload in live mode", () => {
    const result = guardCaseAction("live", planned);
    expect(result.status).toBe("live");
    if (result.status === "live") {
      expect(result.action).toEqual({ assignee: "analyst-42" });
    }
  });
});

describe("assertProductionWriteAllowed", () => {
  it("throws a TrainingViolation in training mode", () => {
    expect(() => assertProductionWriteAllowed("training", "update op_operational_cases")).toThrow(TrainingViolation);
    expect(() => assertProductionWriteAllowed("training")).toThrow(/may not write to production/);
  });

  it("permits the write in live mode", () => {
    expect(() => assertProductionWriteAllowed("live")).not.toThrow();
  });
});
