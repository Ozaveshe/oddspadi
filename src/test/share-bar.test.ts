import { describe, expect, it } from "vitest";
import { buildShareLinks } from "@/components/share/ShareBar";

describe("ShareBar links", () => {
  it("encodes responsible analysis copy and its destination for WhatsApp and Telegram", () => {
    const text = "⚽ Arsenal vs Aston Villa — OddsPadi’s analysis leans Arsenal (51%). Full analysis:";
    const url = "https://oddspadi.com/predictions/epl-001";
    const links = buildShareLinks(text, url);

    expect(decodeURIComponent(links.whatsapp)).toContain(`${text} ${url}`);
    expect(decodeURIComponent(links.telegram)).toContain(`url=${url}`);
    expect(decodeURIComponent(links.telegram)).toContain(`text=${text}`);
    expect(text.toLowerCase()).not.toContain("guaranteed");
  });
});
