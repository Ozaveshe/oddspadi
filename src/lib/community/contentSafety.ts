// Community content safety: pure checks shared by the write routes (which
// reject unsafe submissions) and the render path (which linkifies only what
// passes). No I/O, no clock.

export type ContentSafetyFlag = "unsafe_link" | "scam_or_paid_tips" | "guaranteed_win_claim" | "spam";

export type ContentSafetyVerdict = { allowed: boolean; reasons: string[]; flags: ContentSafetyFlag[] };

export const CONTENT_SAFETY_COPY: Record<ContentSafetyFlag, string> = {
  unsafe_link: "Shortened or unverifiable links are not allowed. Link directly to the source.",
  scam_or_paid_tips: "Selling, promoting or soliciting paid tips is not allowed on OddsPadi.",
  guaranteed_win_claim: "Claims of certain outcomes are not allowed here. No result is certain.",
  spam: "This looks like spam. Remove repeated links and try again."
};

export const LINK_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'()]+/gi;

const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "cutt.ly",
  "rb.gy",
  "shorturl.at",
  "is.gd",
  "ow.ly",
  "rebrand.ly",
  "buff.ly",
  "tiny.cc",
  "goo.gl",
  "lnkd.in",
  "s.id"
]);

const SOLICITATION_PATTERN =
  /(?:\bvip\s+(?:tips?|group|channel|package)\b|\bdm\s+(?:me|us)\b|\bt\.me\/|\btelegram\.me\b|\bwa\.me\/|whatsapp\.com\/(?:channel|chat)|\binsider\s+(?:info|fix)\b|\bsure\s+odds\b|\bpay(?:ment)?\s+for\s+(?:sure\s+)?(?:tips?|odds|games)\b)/i;

const CERTAINTY_PATTERN =
  /(?:\bguaranteed\s+(?:win|profit|odds|money)\b|\bcan'?t\s+lose\b|\brisk[-\s]?free\s+(?:bet|profit)\b|\b100\s*%\s*(?:win|sure|accurate|guaranteed)\b|\bfixed\s+match(?:es)?\b)/i;

export function extractLinks(text: string): string[] {
  return text.match(LINK_PATTERN) ?? [];
}

function parseUrl(rawUrl: string): URL | null {
  const candidate = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

export function isSafeLinkHost(rawUrl: string): boolean {
  if (/^\s*(?:javascript|data|vbscript|file):/i.test(rawUrl)) return false;
  const url = parseUrl(rawUrl);
  if (!url) return false;
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (SHORTENER_HOSTS.has(host)) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  if (!host.includes(".")) return false;
  return true;
}

export function assessCommunityText(text: string): ContentSafetyVerdict {
  const flags: ContentSafetyFlag[] = [];
  const links = extractLinks(text);
  if (links.some((link) => !isSafeLinkHost(link))) flags.push("unsafe_link");
  if (SOLICITATION_PATTERN.test(text)) flags.push("scam_or_paid_tips");
  if (CERTAINTY_PATTERN.test(text)) flags.push("guaranteed_win_claim");
  const counts = new Map<string, number>();
  for (const link of links) counts.set(link, (counts.get(link) ?? 0) + 1);
  if (links.length > 5 || [...counts.values()].some((count) => count > 3)) flags.push("spam");
  const unique = [...new Set(flags)];
  return { allowed: unique.length === 0, reasons: unique.map((flag) => CONTENT_SAFETY_COPY[flag]), flags: unique };
}
