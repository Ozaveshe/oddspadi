import { describe, expect, it, vi } from "vitest";
import { writeExceptions, type PendingException } from "@/lib/settlement/exceptionWriter";

function stubClient(rpc = vi.fn().mockResolvedValue({ error: null })) {
  return { rpc, from: vi.fn() } as never;
}

function exception(overrides: Partial<PendingException> = {}): PendingException {
  return { kind: "result_conflict", fixtureId: "fix-1", detail: { reason: "observations_disagree" }, ...overrides };
}

describe("exception writing", () => {
  it("records each exception through the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const result = await writeExceptions(stubClient(rpc), [exception()], { persist: true });

    expect(result.status).toBe("written");
    expect(result.written).toBe(1);
    expect(rpc).toHaveBeenCalledWith("op_record_settlement_exception", expect.objectContaining({
      p_kind: "result_conflict",
      p_fixture_id: "fix-1"
    }));
  });

  it("never sends a timestamp", async () => {
    // first_seen_at and last_seen_at are the database's to set. A
    // caller-supplied timestamp on an audit trail is a claim about when
    // something happened, not evidence of it.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await writeExceptions(stubClient(rpc), [exception()], { persist: true });
    const payload = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(payload).some((key) => key.includes("seen") || key.includes("_at"))).toBe(false);
  });

  it("defaults severity by kind rather than making everything critical", async () => {
    // Defaulting everything to critical trains an operator to ignore the level,
    // which is worse than not having one.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await writeExceptions(
      stubClient(rpc),
      [exception(), exception({ kind: "close_missing" }), exception({ kind: "alias_overround" })],
      { persist: true }
    );
    expect(rpc.mock.calls[0]![1].p_severity).toBe("critical");
    expect(rpc.mock.calls[1]![1].p_severity).toBe("warning");
    expect(rpc.mock.calls[2]![1].p_severity).toBe("info");
  });

  it("honours an explicit severity over the default", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await writeExceptions(stubClient(rpc), [exception({ severity: "info" })], { persist: true });
    expect(rpc.mock.calls[0]![1].p_severity).toBe("info");
  });

  it("falls back to warning for a kind it has no default for", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await writeExceptions(stubClient(rpc), [exception({ kind: "something_new" })], { persist: true });
    expect(rpc.mock.calls[0]![1].p_severity).toBe("warning");
  });

  it("writes nothing in preview", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const result = await writeExceptions(stubClient(rpc), [exception()], { persist: false });
    expect(result.status).toBe("preview");
    expect(result.skipped).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does nothing at all with an empty list", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const result = await writeExceptions(stubClient(rpc), [], { persist: true });
    expect(result.written).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps writing the rest when one exception fails", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: "check constraint" } })
      .mockResolvedValue({ error: null });
    const result = await writeExceptions(stubClient(rpc), [exception(), exception({ fixtureId: "fix-2" })], {
      persist: true
    });
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.status).toBe("failed");
    expect(result.errors[0]).toContain("check constraint");
  });

  it("stops on a missing table rather than reporting each row as a failure", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ error: { code: "42P01", message: 'relation "op_settlement_exceptions" does not exist' } });
    const result = await writeExceptions(stubClient(rpc), [exception(), exception({ fixtureId: "fix-2" })], {
      persist: true
    });
    expect(result.status).toBe("not-migrated");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("reports a failure rather than silence when storage is not configured", async () => {
    const result = await writeExceptions(null, [exception()], { persist: true });
    expect(result.status).toBe("failed");
    expect(result.skipped).toBe(1);
  });
});
