// The single sanitised text path for community content.
// Write path: prepareCommunityText (repair mojibake, then normalise).
// Render path: <CommunityBody> (React-escaped text, safe-host linkification only).
// This file is pure ASCII on disk: the mojibake detector is written with
// \uXXXX escapes so the module never depends on its own encoding.

const MOJIBAKE_MARKER = /\u00e2\u20ac|\u00c3[\u0080-\u00bf]|\u00c2[\u00a0-\u00bf]|\ufffd/;

const CONTROL_AND_ZERO_WIDTH = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200d\ufeff]/g;

// cp1252 codepoints that differ from latin-1: map the visible character back
// to the byte it was decoded from.
const CP1252_REVERSE = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f]
]);

function markerCount(text: string): number {
  return (text.match(new RegExp(MOJIBAKE_MARKER.source, "g")) ?? []).length;
}

function toWindows1252Bytes(text: string): Uint8Array | null {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0xff) bytes[index] = code;
    else if (CP1252_REVERSE.has(code)) bytes[index] = CP1252_REVERSE.get(code)!;
    else return null;
  }
  return bytes;
}

export function repairMojibake(text: string): string {
  let current = text;
  // Two passes: double-encoded text needs two unwinds.
  for (let pass = 0; pass < 2; pass += 1) {
    if (!MOJIBAKE_MARKER.test(current)) return current;
    const bytes = toWindows1252Bytes(current);
    if (!bytes) return current;
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return current;
    }
    if (decoded === current || markerCount(decoded) > markerCount(current)) return current;
    current = decoded;
  }
  return current;
}

export function normaliseCommunityText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_AND_ZERO_WIDTH, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function prepareCommunityText(text: string): string {
  return normaliseCommunityText(repairMojibake(text));
}
