import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readBoundedJson } from "@/lib/security/boundedJson";

function request(body: string, headers: HeadersInit = { "content-type": "application/json" }) {
  return new Request("https://oddspadi.com/api/community/posts", { method: "POST", headers, body });
}

describe("bounded JSON request parsing", () => {
  it("parses valid JSON under the byte limit", async () => {
    const result = await readBoundedJson<{ body: string }>(request('{"body":"hello"}'), 128);
    expect(result).toEqual({ ok: true, value: { body: "hello" } });
  });

  it("rejects unsupported media types and malformed JSON", async () => {
    const media = await readBoundedJson(request("{}", { "content-type": "text/plain" }), 128);
    const malformed = await readBoundedJson(request("{"), 128);
    expect(media.ok ? 0 : media.response.status).toBe(415);
    expect(malformed.ok ? 0 : malformed.response.status).toBe(400);
  });

  it("rejects oversized declared and measured bodies", async () => {
    const declared = await readBoundedJson(request("{}", { "content-type": "application/json", "content-length": "999" }), 32);
    const measured = await readBoundedJson(request(JSON.stringify({ body: "é".repeat(40) })), 32);
    expect(declared.ok ? 0 : declared.response.status).toBe(413);
    expect(measured.ok ? 0 : measured.response.status).toBe(413);
  });

  it("covers every cookie-authenticated JSON POST route", async () => {
    for (const route of [
      "src/app/api/account/profile/route.ts",
      "src/app/api/account/followed-teams/route.ts",
      "src/app/api/account/push-subscription/route.ts",
      "src/app/api/community/posts/route.ts",
      "src/app/api/community/likes/route.ts",
      "src/app/api/community/comments/route.ts",
      "src/app/api/community/polls/route.ts",
      "src/app/api/community/tips/route.ts",
      "src/app/api/community/tips/revisions/route.ts",
      "src/app/api/community/threads/route.ts",
      "src/app/api/community/replies/route.ts"
    ]) {
      const source = await readFile(route, "utf8");
      expect(source, route).toContain("readBoundedJson");
      expect(source, route).not.toContain("request.json()");
    }
  });
});
