import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { prepareCommunityText, repairMojibake, normaliseCommunityText } from "@/lib/community/textContent";
import { CommunityBody } from "@/components/community/CommunityBody";

// Every non-ASCII character in this file -- fixtures AND expectations -- is
// built from \uXXXX escapes so the file itself stays pure ASCII on disk.
// A test about encoding must not depend on its own encoding.

const RSQ_MOJI = "\u00e2\u20ac\u2122"; // mojibake of \u2019 (right single quote)
const EMDASH_MOJI = "\u00e2\u20ac\u201d"; // mojibake of \u2014 (em dash)
const LDQ_MOJI = "\u00e2\u20ac\u0153"; // mojibake of \u201c (left double quote)
const RDQ_MOJI = "\u00e2\u20ac\u009d"; // mojibake of \u201d (right double quote)
const UUML_MOJI = "\u00c3\u00bc"; // mojibake of u-umlaut
const NTILDE_MOJI = "\u00c3\u00b1"; // mojibake of n-tilde
const EACUTE_MOJI = "\u00c3\u00a9"; // mojibake of e-acute
const RSQ_DOUBLE_MOJI = "\u00c3\u00a2\u00e2\u201a\u00ac\u00e2\u201e\u00a2"; // \u2019 mojibaked twice

describe("repairMojibake", () => {
  it("repairs UTF-8-as-cp1252 punctuation", () => {
    expect(repairMojibake(`that${RSQ_MOJI}s a big win ${EMDASH_MOJI} wow`)).toBe(
      "that\u2019s a big win \u2014 wow"
    );
    expect(repairMojibake(`${LDQ_MOJI}quoted${RDQ_MOJI}`)).toBe("\u201cquoted\u201d");
  });

  it("repairs UTF-8-as-latin1 accented letters", () => {
    expect(repairMojibake(`M${UUML_MOJI}ller scores, Sa${NTILDE_MOJI}${EACUTE_MOJI} assists`)).toBe(
      "M\u00fcller scores, Sa\u00f1\u00e9 assists"
    );
  });

  it("unwinds double-encoded text in two passes", () => {
    expect(repairMojibake(`Bayern${RSQ_DOUBLE_MOJI}s midfield`)).toBe("Bayern\u2019s midfield");
  });

  it("leaves clean text untouched", () => {
    expect(repairMojibake("Straight ASCII stays put \u2014 even real em dashes.")).toBe(
      "Straight ASCII stays put \u2014 even real em dashes."
    );
    expect(repairMojibake("plain text")).toBe("plain text");
  });
});

describe("normaliseCommunityText", () => {
  it("strips zero-width characters and collapses blank runs", () => {
    expect(normaliseCommunityText("a\u200bb c\n\n\n\n\nd\te")).toBe("ab c\n\nd\te");
  });

  it("strips control characters", () => {
    expect(normaliseCommunityText("x\u0007y\u0000z")).toBe("xyz");
  });

  it("NFC-normalises combining sequences", () => {
    expect(normaliseCommunityText("cafe\u0301")).toBe("caf\u00e9");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseCommunityText("  spaced out  ")).toBe("spaced out");
  });
});

describe("prepareCommunityText", () => {
  it("chains repair then normalise", () => {
    expect(prepareCommunityText(`  ${LDQ_MOJI}quoted${RDQ_MOJI}  `)).toBe("\u201cquoted\u201d");
  });
});

describe("CommunityBody", () => {
  it("escapes script injection as plain text", () => {
    const html = renderToStaticMarkup(
      <CommunityBody text={"<script>alert(1)</script> <img src=x onerror=alert(1)>"} />
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img");
  });

  it("linkifies safe hosts with ugc rel", () => {
    const html = renderToStaticMarkup(<CommunityBody text={"read https://www.bbc.co.uk/sport today"} />);
    expect(html).toContain('href="https://www.bbc.co.uk/sport"');
    expect(html).toContain('rel="nofollow ugc noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("read ");
    expect(html).toContain(" today");
  });

  it("refuses to linkify unsafe hosts, rendering them as text", () => {
    const html = renderToStaticMarkup(<CommunityBody text={"grab https://bit.ly/xyz now"} />);
    expect(html).not.toContain("href=");
    expect(html).toContain("bit.ly/xyz");
  });

  it("prefixes bare www links with https when linkifying", () => {
    const html = renderToStaticMarkup(<CommunityBody text={"see www.espn.com/football"} />);
    expect(html).toContain('href="https://www.espn.com/football"');
  });
});
