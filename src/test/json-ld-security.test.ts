import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "@/lib/security/jsonLd";

describe("JSON-LD script serialization", () => {
  it("preserves data while escaping script-breaking characters", () => {
    const input = { title: '</script><script>alert("xss")</script>', note: "A&B\u2028C\u2029D" };
    const output = serializeJsonLd(input);

    expect(output).not.toContain("<");
    expect(output).not.toContain(">");
    expect(output).not.toContain("&");
    expect(output).not.toContain("\u2028");
    expect(output).not.toContain("\u2029");
    expect(JSON.parse(output)).toEqual(input);
  });

  it("routes every dangerouslySetInnerHTML JSON-LD sink through the safe serializer", async () => {
    for (const file of [
      "src/app/layout.tsx",
      "src/app/season-outlooks/page.tsx",
      "src/app/predictions/[matchId]/page.tsx",
      "src/app/forums/[category]/[thread]/page.tsx",
      "src/app/forums/[category]/page.tsx",
      "src/app/predictions/league/[slug]/table/page.tsx",
      "src/app/predictions/history/page.tsx",
      "src/app/news/[slug]/page.tsx"
    ]) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(/dangerouslySetInnerHTML=\{\{ __html: JSON\.stringify\(/);
      expect(source, file).toContain("serializeJsonLd");
    }
  });
});
