import { describe, expect, it } from "vitest";
import {
  cleanExternalIdentifier,
  escapeIlikePattern,
  isIsoTimestampCursor,
  isUuid
} from "@/lib/security/inputValidation";

describe("public input validation", () => {
  it("accepts canonical UUIDs and rejects malformed identifiers", () => {
    expect(isUuid("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    for (const value of ["", "123", "123e4567-e89b-02d3-a456-426614174000", "../admin", "x".repeat(500)]) {
      expect(isUuid(value)).toBe(false);
    }
  });

  it("bounds pagination cursors to valid ISO timestamps", () => {
    expect(isIsoTimestampCursor("2026-07-16T20:00:00.000Z")).toBe(true);
    expect(isIsoTimestampCursor("not-a-date")).toBe(false);
    expect(isIsoTimestampCursor("2026-07-16")).toBe(false);
    expect(isIsoTimestampCursor("2".repeat(100))).toBe(false);
  });

  it("allows provider identifiers without permitting control characters or paths", () => {
    expect(cleanExternalIdentifier("api-football:494954")).toBe("api-football:494954");
    expect(cleanExternalIdentifier("nba_123-abc")).toBe("nba_123-abc");
    expect(cleanExternalIdentifier("../../admin")).toBeNull();
    expect(cleanExternalIdentifier("fixture\nheader")).toBeNull();
  });

  it("escapes PostgREST ILIKE wildcard characters", () => {
    expect(escapeIlikePattern("100%_United\\FC")).toBe("100\\%\\_United\\\\FC");
  });
});
