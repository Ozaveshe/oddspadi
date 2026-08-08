# Community Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OddsPadi community contextual, accountable, moderated and honest — canonical-entity discussion subjects, a complete immutable community tip ledger (line, odds source, canonical market version, edit boundary, deletion tombstones), demo/staff/system provenance labelling, an eligibility-gated sample-aware leaderboard, a production moderation system (reports, blocks, queue, appeals, audit log), one sanitised text path, and honest ops (no unlabelled seeded activity, no canary that demands artificial content).

**Architecture:** Three additive Supabase migrations (provenance → tip ledger v2 → moderation + leaderboard v2) on top of the existing v1 feed/forums and v2 tips schema; pure TS libraries for content safety, text normalisation and tip status; thin API routes following the existing origin-guard → cookie-auth → rate-limit → bounded-JSON → privateJson pattern; server-component UI panels reusing the existing embed conventions. Community truth lane stays strictly separate from `op_publications`.

**Tech Stack:** Next.js 15 App Router, React 19, Supabase (Postgres + RLS), Vitest, no new npm dependencies.

## Global Constraints

- Community tips lock **30 minutes before kickoff** (existing contract + RLS + trigger) — post-start submission stays impossible.
- A tracked tip's posted values (`fixture`, `market`, `selection`, `line`, `odds`, `odds source`, `stake`, `timestamps`, `canonical market version`) are **immutable for everyone, including the service role** (freeze trigger). Only `rationale` (commentary) and one-way `deleted_at` are author-editable.
- Community and official records stay separate: nothing here reads or writes `op_publications`; leaderboard reads only community tables. Copy `truthLane: "community-opinion"` stays on API responses.
- Every `route.ts` under `src/app/api/community` must use `privateJson`, `rejectCrossSiteMutation` on mutations, `enforceUserRateLimit`, and `readBoundedJson` (enforced by `api-hardening.test.ts`, `mutation-origin-security.test.ts`, `user-rate-limit-security.test.ts`, `bounded-json-security.test.ts` — the last three keep hardcoded route lists that MUST be extended in Task 7).
- New page `/community/moderation` must be registered in `docs/route-map.md`, added to the `NOINDEX` list in `src/test/route-canonical-contract.test.ts`, and declare `robots: { index: false }`.
- No `.toLocaleString`/`.toLocaleDateString` without pinned `timeZone` in `src/app` or `src/components` — use existing `RelativeTime` / `LocalTime` components.
- No new npm dependencies (React auto-escaping + our own tokenizer is the sanitisation path; no DOMPurify/markdown lib).
- Migrations are **files in `supabase/migrations/`**; applying to the live DB requires the `supabase_oddspadi` connector verified against `https://wncwtzqipnoqwmqlznqn.supabase.co` (unauthenticated in this session → report as handoff, per AGENTS.md).
- Run tests with `npx vitest run <file>`; full proof stack before commit: `npm run build`, `npm run typecheck`, `npm test`, `git diff --check`.
- Error copy must not trip `src/test/consumer-copy-integrity.test.ts` (no certainty language in `src/app`/`src/components`); check its regex list before finalising any new user-facing string.

---

### Task 1: Content-safety library

**Files:**
- Create: `src/lib/community/contentSafety.ts`
- Test: `src/test/community-content-safety.test.ts`

**Interfaces:**
- Produces: `assessCommunityText(text: string): ContentSafetyVerdict` where `ContentSafetyVerdict = { allowed: boolean; reasons: string[]; flags: ContentSafetyFlag[] }`, `ContentSafetyFlag = "unsafe_link" | "scam_or_paid_tips" | "guaranteed_win_claim" | "spam"`, `extractLinks(text: string): string[]`, `isSafeLinkHost(rawUrl: string): boolean`, `CONTENT_SAFETY_COPY: Record<ContentSafetyFlag, string>`. Consumed by Tasks 2 (linkification), 8 (route enforcement).

- [ ] **Step 1: Write the failing test** (`src/test/community-content-safety.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { assessCommunityText, extractLinks, isSafeLinkHost, CONTENT_SAFETY_COPY } from "@/lib/community/contentSafety";

describe("extractLinks", () => {
  it("finds http, https and www links", () => {
    expect(extractLinks("see https://example.com/a and www.example.org")).toEqual([
      "https://example.com/a",
      "www.example.org"
    ]);
  });
});

describe("assessCommunityText", () => {
  it("allows ordinary match talk", () => {
    const verdict = assessCommunityText("Arsenal look strong at home this season, midfield press is the difference.");
    expect(verdict.allowed).toBe(true);
    expect(verdict.flags).toEqual([]);
  });
  it("rejects link shorteners", () => {
    const verdict = assessCommunityText("free picks here https://bit.ly/3abcd");
    expect(verdict.allowed).toBe(false);
    expect(verdict.flags).toContain("unsafe_link");
    expect(verdict.reasons).toContain(CONTENT_SAFETY_COPY.unsafe_link);
  });
  it("rejects raw-IP hosts and userinfo tricks", () => {
    expect(assessCommunityText("http://203.0.113.9/pay").allowed).toBe(false);
    expect(assessCommunityText("https://legit.com@evil.example/x").allowed).toBe(false);
  });
  it("rejects paid-tip solicitation", () => {
    for (const text of [
      "DM me for tips, big odds tonight",
      "join my VIP group on t.me/bigwins",
      "wa.me/2348000000 for sure odds"
    ]) {
      const verdict = assessCommunityText(text);
      expect(verdict.allowed).toBe(false);
      expect(verdict.flags).toContain("scam_or_paid_tips");
    }
  });
  it("rejects certainty claims", () => {
    for (const text of ["guaranteed win tonight", "this bet is 100% sure", "fixed match info available"]) {
      const verdict = assessCommunityText(text);
      expect(verdict.allowed).toBe(false);
      expect(verdict.flags).toContain("guaranteed_win_claim");
    }
  });
  it("rejects link spam", () => {
    const repeated = Array.from({ length: 4 }, () => "https://example.com/offer").join(" ");
    expect(assessCommunityText(repeated).flags).toContain("spam");
  });
  it("keeps flags deduplicated and reasons aligned", () => {
    const verdict = assessCommunityText("guaranteed win https://bit.ly/x https://bit.ly/x");
    expect(new Set(verdict.flags).size).toBe(verdict.flags.length);
    expect(verdict.reasons.length).toBe(verdict.flags.length);
  });
});

describe("isSafeLinkHost", () => {
  it("accepts plain https hosts and rejects shorteners", () => {
    expect(isSafeLinkHost("https://www.bbc.co.uk/sport")).toBe(true);
    expect(isSafeLinkHost("https://tinyurl.com/x")).toBe(false);
    expect(isSafeLinkHost("javascript:alert(1)")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/test/community-content-safety.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/community/contentSafety.ts`**

```ts
// Community content safety: pure checks shared by the write routes (reject) and
// the render path (linkify only what passes). No I/O, no clock.

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
  "bit.ly", "tinyurl.com", "t.co", "cutt.ly", "rb.gy", "shorturl.at", "is.gd",
  "ow.ly", "rebrand.ly", "tiny.cc", "goo.gl", "lnkd.in", "buff.ly", "s.id"
]);

const SOLICITATION_PATTERN =
  /(?:\bvip\s+(?:tips?|group|channel|package)\b|\bdm\s+(?:me|us)\b|\bt\.me\/|\btelegram\.me\b|\bwa\.me\/|whatsapp\.com\/(?:channel|chat)|\binsider\s+(?:info|fix)\b|\bsure\s+odds\b|\bpay(?:ment)?\s+for\s+(?:sure\s+)?(?:tips?|odds|games)\b)/i;

const CERTAINTY_PATTERN =
  /(?:\bguaranteed\s+(?:win|profit|odds|money)\b|\bcan'?t\s+lose\b|\brisk[-\s]?free\s+(?:bet|profit)\b|\b100\s*%\s*(?:win|sure|accurate|guaranteed)\b|\bfixed\s+match(?:es)?\b)/i;

export function extractLinks(text: string): string[] {
  return text.match(LINK_PATTERN) ?? [];
}

function parseUrl(rawUrl: string): URL | null {
  const candidate = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

export function isSafeLinkHost(rawUrl: string): boolean {
  if (/^(?:javascript|data|vbscript|file):/i.test(rawUrl.trim())) return false;
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
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/test/community-content-safety.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/community/contentSafety.ts src/test/community-content-safety.test.ts && git commit -m "feat(community): content-safety checks for scam links, solicitation, certainty claims"`

---

### Task 2: One sanitised text path (encoding repair + CommunityBody)

**Files:**
- Create: `src/lib/community/textContent.ts`, `src/components/community/CommunityBody.tsx`
- Modify: `src/components/community/CommunityFeed.tsx:63` (post body), `src/components/community/PostComments.tsx:136` (comment body), `src/components/community/MatchCommunityDesk.tsx:321` (tip rationale), `src/app/forums/[category]/[thread]/page.tsx` (thread body + reply bodies), `src/app/api/community/posts/route.ts`, `src/app/api/community/comments/route.ts`, `src/app/api/community/threads/route.ts`, `src/app/api/community/replies/route.ts` (normalise on write)
- Test: `src/test/community-text-content.test.ts`

**Interfaces:**
- Consumes: `isSafeLinkHost`, `LINK_PATTERN` from Task 1.
- Produces: `repairMojibake(text: string): string`, `normaliseCommunityText(text: string): string`, `prepareCommunityText(text: string): string` (repair → normalise, the single write-path entry), `<CommunityBody text={string} />` (the single render-path entry). Consumed by Tasks 8, 10, 11.

- [ ] **Step 1: Write the failing test** (`src/test/community-text-content.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { prepareCommunityText, repairMojibake, normaliseCommunityText } from "@/lib/community/textContent";
import { CommunityBody } from "@/components/community/CommunityBody";

describe("repairMojibake", () => {
  it("repairs UTF-8-as-cp1252 sequences", () => {
    expect(repairMojibake("thatâ€™s a big win â€” wow")).toBe("that’s a big win — wow");
    expect(repairMojibake("BayernÃ¢â‚¬â„¢?")).not.toContain("Ã¢");
    expect(repairMojibake("MÃ¼ller scores, SaÃ±Ã© assists")).toBe("Müller scores, Sañé assists");
  });
  it("leaves clean text untouched", () => {
    expect(repairMojibake("Straight ASCII stays put — even real em dashes.")).toBe(
      "Straight ASCII stays put — even real em dashes."
    );
  });
});

describe("normaliseCommunityText", () => {
  it("strips control and zero-width characters, collapses blank runs", () => {
    expect(normaliseCommunityText("ab​c\n\n\n\nd\t e")).toBe("abc\n\nd\t e");
  });
  it("NFC-normalises", () => {
    expect(normaliseCommunityText("é")).toBe("é");
  });
});

describe("prepareCommunityText", () => {
  it("chains repair then normalise", () => {
    expect(prepareCommunityText("â€œquotedâ€")).toBe("“quoted”");
  });
});

describe("CommunityBody", () => {
  it("escapes script injection as plain text", () => {
    const html = renderToStaticMarkup(<CommunityBody text={'<script>alert(1)</script> <img src=x onerror=alert(1)>'} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img");
  });
  it("linkifies safe hosts with ugc rel", () => {
    const html = renderToStaticMarkup(<CommunityBody text={"read https://www.bbc.co.uk/sport today"} />);
    expect(html).toContain('href="https://www.bbc.co.uk/sport"');
    expect(html).toContain('rel="nofollow ugc noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });
  it("refuses to linkify unsafe hosts, rendering them as text", () => {
    const html = renderToStaticMarkup(<CommunityBody text={"grab https://bit.ly/xyz now"} />);
    expect(html).not.toContain("href=");
    expect(html).toContain("bit.ly/xyz");
  });
});
```

(File extension must be `.tsx`: name it `src/test/community-text-content.test.tsx` so JSX parses; `tsconfig.test.json` already covers `src/test`.)

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run src/test/community-text-content.test.tsx`.

- [ ] **Step 3: Implement `src/lib/community/textContent.ts`**

```ts
// The single sanitised text path for community content.
// Write path: prepareCommunityText (repair mojibake, normalise).
// Render path: <CommunityBody> (React-escaped text, safe-host linkification only).

const MOJIBAKE_MARKER = /\u00e2\u20ac|\u00c3[\u0080-\u00bf]|\u00c2[\u00a0-\u00bf]|\ufffd/;

// cp1252 codepoints that differ from latin-1: map the visible character back to its byte.
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
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0xff) bytes[i] = code;
    else if (CP1252_REVERSE.has(code)) bytes[i] = CP1252_REVERSE.get(code)!;
    else return null;
  }
  return bytes;
}

export function repairMojibake(text: string): string {
  let current = text;
  // Up to two passes: double-encoded text needs two unwinds.
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
    if (markerCount(decoded) >= markerCount(current)) return current;
    current = decoded;
  }
  return current;
}

export function normaliseCommunityText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200d\ufeff]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function prepareCommunityText(text: string): string {
  return normaliseCommunityText(repairMojibake(text));
}
```

- [ ] **Step 4: Implement `src/components/community/CommunityBody.tsx`** (server-compatible, no hooks)

```tsx
import { Fragment } from "react";
import { LINK_PATTERN, isSafeLinkHost } from "@/lib/community/contentSafety";

// The single render path for user-authored community text. Everything is a React
// text node (auto-escaped); only links whose host passes the safety check become
// anchors, always rel="nofollow ugc noopener noreferrer".
export function CommunityBody({ text, className }: { text: string; className?: string }) {
  const parts = text.split(new RegExp(`(${LINK_PATTERN.source})`, "gi"));
  return (
    <p className={className} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {parts.map((part, index) => {
        const isLink = index % 2 === 1;
        if (isLink && isSafeLinkHost(part)) {
          const href = part.startsWith("http") ? part : `https://${part}`;
          return (
            <a key={index} href={href} rel="nofollow ugc noopener noreferrer" target="_blank">
              {part}
            </a>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </p>
  );
}
```

- [ ] **Step 5: Run to verify PASS** — `npx vitest run src/test/community-text-content.test.tsx`.
- [ ] **Step 6: Swap render sites.** Replace `<p style={{whiteSpace:"pre-wrap"}}>{post.body}</p>` in `CommunityFeed.tsx:63` with `<CommunityBody text={post.body} />` (keep surrounding classes); same for `PostComments.tsx:136` (`<CommunityBody text={comment.body} />`), `MatchCommunityDesk.tsx:321` (`<CommunityBody text={tip.rationale} />`), and the thread body + each reply body in `src/app/forums/[category]/[thread]/page.tsx` (leave the JSON-LD `serializeJsonLd` path exactly as is).
- [ ] **Step 7: Normalise on write.** In `posts/route.ts` POST, `comments/route.ts` POST, `threads/route.ts` POST (title AND body), `replies/route.ts` POST: run the validated string through `prepareCommunityText(...)` before insert and re-check length bounds after normalisation (a string of only zero-width chars must fail the min-length check).
- [ ] **Step 8: Run the existing route tests** — `npx vitest run src/test/community-write-routes.test.ts src/test/community-v2-routes.test.ts` → PASS (normalisation of plain ASCII fixtures is identity).
- [ ] **Step 9: Commit** — `git commit -m "feat(community): one sanitised text path — mojibake repair, normalisation, CommunityBody renderer"`

---

### Task 3: Migration — account provenance, demo marking, discussion subjects

**Files:**
- Create: `supabase/migrations/20260808180000_community_provenance.sql`, `src/components/community/AccountBadge.tsx`
- Modify: `src/app/community/page.tsx:30` (author embed select), `src/app/api/community/posts/route.ts` (GET select), `src/app/api/community/tips/route.ts:12` (TIP_SELECT author embed), `src/app/community/u/[handle]/page.tsx` (profile select + badge), `src/app/forums/[category]/page.tsx` + `src/app/forums/[category]/[thread]/page.tsx` (author embeds + badge), `src/components/community/CommunityFeed.tsx` (render badge)
- Test: `src/test/community-provenance.test.ts`

**Interfaces:**
- Produces: `op_profiles.account_type` (`'organic' | 'staff' | 'system' | 'demo'`, default `'organic'`, service-role-only writes), `op_profiles.integrity_flagged_at timestamptz` / `integrity_flag_reason text`, `op_feed_posts.subject_type/subject_id`, `op_forum_threads.subject_type/subject_id`, `<AccountBadge accountType={string | null | undefined} />` rendering the literal strings `OddsPadi staff`, `Demo account`, `System`. Consumed by Tasks 6 (leaderboard gates), 7 (moderation), 9, 10.

- [ ] **Step 1: Write the failing test** (`src/test/community-provenance.test.ts`) — follows the SQL-literal convention of `community-prediction-contracts.test.ts:135`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountBadge } from "@/components/community/AccountBadge";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260808180000_community_provenance.sql"),
  "utf8"
);

describe("community provenance migration", () => {
  it("adds a constrained account_type with organic default", () => {
    expect(migration).toContain("add column if not exists account_type text not null default 'organic'");
    expect(migration).toContain("account_type in ('organic','staff','system','demo')");
  });
  it("marks the eight seed personas honestly", () => {
    expect(migration).toContain("set account_type = 'staff'");
    expect(migration).toContain("where username = 'oddspadi_desk'");
    expect(migration).toContain("set account_type = 'demo'");
    for (const persona of ["kunle_lagos", "ama_kotoko", "tunde_united", "zainab_hoops", "chidi_naija", "mariam_casa", "sipho_amakhosi"]) {
      expect(migration).toContain(persona);
    }
  });
  it("reserves staff-looking handles for non-organic accounts, not valid retroactively", () => {
    expect(migration).toContain("op_profiles_reserved_handles");
    expect(migration).toMatch(/not valid/);
  });
  it("never grants account_type or integrity columns to authenticated", () => {
    expect(migration).not.toMatch(/grant (insert|update)[^;]*account_type/);
    expect(migration).not.toMatch(/grant (insert|update)[^;]*integrity_/);
  });
  it("adds canonical discussion subjects to feed posts and forum threads", () => {
    expect(migration).toContain("'fixture','competition','team','player','publication','season_outlook','strategy','product_feedback'");
    expect(migration).toContain("op_feed_posts_subject_idx");
    expect(migration).toContain("op_forum_threads_subject_idx");
    expect(migration).toContain("set subject_type = 'fixture'");
  });
});

describe("AccountBadge", () => {
  it("labels staff, demo and system accounts and stays silent for organic", () => {
    expect(renderToStaticMarkup(<AccountBadge accountType="staff" />)).toContain("OddsPadi staff");
    expect(renderToStaticMarkup(<AccountBadge accountType="demo" />)).toContain("Demo account");
    expect(renderToStaticMarkup(<AccountBadge accountType="system" />)).toContain("System");
    expect(renderToStaticMarkup(<AccountBadge accountType="organic" />)).toBe("");
    expect(renderToStaticMarkup(<AccountBadge accountType={null} />)).toBe("");
  });
});
```

(Name the file `.tsx` for JSX: `src/test/community-provenance.test.tsx`.)

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Write the migration** `supabase/migrations/20260808180000_community_provenance.sql`:

```sql
-- Community provenance: every account is typed (organic | staff | system | demo),
-- seeded personas are labelled honestly, staff-looking handles are reserved, and
-- discussions gain canonical subjects (fixture, competition, team, player,
-- publication, season outlook, strategy topic, product feedback).

-- 1) Account provenance ------------------------------------------------------
alter table public.op_profiles
  add column if not exists account_type text not null default 'organic';
alter table public.op_profiles
  add constraint op_profiles_account_type_check
  check (account_type in ('organic','staff','system','demo'));

alter table public.op_profiles
  add column if not exists integrity_flagged_at timestamptz;
alter table public.op_profiles
  add column if not exists integrity_flag_reason text;
alter table public.op_profiles
  add constraint op_profiles_integrity_reason_length
  check (integrity_flag_reason is null or char_length(integrity_flag_reason) between 1 and 500);

comment on column public.op_profiles.account_type is
  'organic = real user; staff = OddsPadi employee (visibly labelled); system = automated OddsPadi account; demo = seeded persona (visibly labelled, excluded from leaderboards and engagement metrics).';

-- Column-level insert/update grants for authenticated remain the explicit
-- five-column list from 20260712050714; account_type and integrity_* are
-- deliberately NOT granted, so they are service-role-only.

-- 2) Label the eight seed personas (no-op where they do not exist) -----------
update public.op_profiles set account_type = 'staff', is_admin = true
  where username = 'oddspadi_desk';
update public.op_profiles set account_type = 'demo'
  where username in ('kunle_lagos','ama_kotoko','tunde_united','zainab_hoops','chidi_naija','mariam_casa','sipho_amakhosi');

-- 3) Reserve staff-looking handles for labelled accounts ---------------------
-- NOT VALID: never breaks a pre-existing organic row; enforced on every new
-- insert/update, which is what impersonation protection needs.
alter table public.op_profiles
  add constraint op_profiles_reserved_handles
  check (
    account_type <> 'organic'
    or username !~* '^(oddspadi|odds_padi|admin|moderator|staff|support|official)'
  ) not valid;

-- 4) Canonical discussion subjects ------------------------------------------
alter table public.op_feed_posts add column if not exists subject_type text;
alter table public.op_feed_posts add column if not exists subject_id text;
alter table public.op_feed_posts
  add constraint op_feed_posts_subject_check
  check (
    (subject_type is null and subject_id is null)
    or (
      subject_type in ('fixture','competition','team','player','publication','season_outlook','strategy','product_feedback')
      and subject_id is not null
      and char_length(subject_id) between 1 and 120
    )
  );
create index if not exists op_feed_posts_subject_idx
  on public.op_feed_posts (subject_type, subject_id, created_at desc);

alter table public.op_forum_threads add column if not exists subject_type text;
alter table public.op_forum_threads add column if not exists subject_id text;
alter table public.op_forum_threads
  add constraint op_forum_threads_subject_check
  check (
    (subject_type is null and subject_id is null)
    or (
      subject_type in ('fixture','competition','team','player','publication','season_outlook','strategy','product_feedback')
      and subject_id is not null
      and char_length(subject_id) between 1 and 120
    )
  );
create index if not exists op_forum_threads_subject_idx
  on public.op_forum_threads (subject_type, subject_id, last_activity_at desc);

-- Fixture chatter that already carried a match id becomes a fixture subject.
update public.op_feed_posts
  set subject_type = 'fixture', subject_id = match_id
  where match_id is not null and subject_type is null;

grant insert (subject_type, subject_id) on public.op_feed_posts to authenticated;
grant insert (subject_type, subject_id) on public.op_forum_threads to authenticated;
```

- [ ] **Step 4: Implement `src/components/community/AccountBadge.tsx`**

```tsx
const LABELS: Record<string, string> = {
  staff: "OddsPadi staff",
  demo: "Demo account",
  system: "System"
};

export function AccountBadge({ accountType }: { accountType?: string | null }) {
  const label = accountType ? LABELS[accountType] : undefined;
  if (!label) return null;
  return (
    <span
      data-account-type={accountType}
      style={{
        fontSize: "0.72rem",
        fontWeight: 600,
        padding: "0.1rem 0.45rem",
        borderRadius: "999px",
        border: "1px solid currentColor",
        opacity: 0.85,
        marginLeft: "0.4rem",
        whiteSpace: "nowrap"
      }}
    >
      {label}
    </span>
  );
}
```

(At execution: if `globals.css` has an existing pill/badge utility class, use it instead of inline style.)

- [ ] **Step 5: Thread `account_type` through the reads and render the badge.** Add `account_type` to every author embed select: `src/app/community/page.tsx:30`, `posts/route.ts` GET select, `tips/route.ts` `TIP_SELECT` (`author:op_profiles!...(username,display_name,avatar_url,account_type)`), `community/u/[handle]/page.tsx` profile select, forum category/thread pages' author embeds. Render `<AccountBadge accountType={post.author?.account_type} />` beside the author handle in `CommunityFeed.tsx` (next to the handle link at :62), in `PostComments.tsx` comment headers, in forum thread/reply author lines, in `MatchCommunityDesk` tip cards, and on the `/community/u/[handle]` profile header.
- [ ] **Step 6: Run** `npx vitest run src/test/community-provenance.test.tsx src/test/community-write-routes.test.ts src/test/community-v2-routes.test.ts` → PASS.
- [ ] **Step 7: Commit** — `git commit -m "feat(community): account provenance (staff/demo/system labels), reserved handles, canonical discussion subjects"`

---

### Task 4: Migration — tip ledger v2 (line, odds source, market version, edit boundary, deletion)

**Files:**
- Create: `supabase/migrations/20260808181000_community_tip_ledger_v2.sql`, `src/lib/community/tipStatus.ts`
- Modify: `src/lib/community/predictionContracts.ts`, `src/app/api/community/tips/route.ts`, `src/components/community/MatchCommunityDesk.tsx` (send `marketLine`/`oddsSource`; render status via `tipStatus`), `src/app/predictions/[matchId]/page.tsx:154-162` (keep bookmaker name in `communityMarkets` selections)
- Test: `src/test/community-tip-ledger-v2.test.ts`; update `src/test/community-v2-routes.test.ts` fixtures with the new draft fields

**Interfaces:**
- Consumes: `legacySelectionKey({ sport, market, selection, marketLine? }): string | null` (`src/lib/markets/legacyKeys.ts:49`), `canonicalSelection(key): CanonicalSelectionRef | null` (`src/lib/markets/canonicalMarkets.ts:406`).
- Produces: `CommunityTipDraft` gains `market_line: number | null; odds_source: string; canonical_selection_key: string | null; market_version: string | null`. New exports `boundedCommunityText(value: unknown, min: number, max: number): string | null` (rename of internal `boundedText`, kept private alias), `communityTipStatus(input): CommunityTipStatus` with `CommunityTipStatus = "pending" | "won" | "lost" | "push" | "void" | "corrected" | "moderated"`. Tips route gains `PATCH` (edit commentary) and `DELETE` (tombstone). Consumed by Tasks 5, 6, 9.

- [ ] **Step 1: Write the failing tests** (`src/test/community-tip-ledger-v2.test.ts`) — three groups:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCommunityTipDraft } from "@/lib/community/predictionContracts";
import { communityTipStatus } from "@/lib/community/tipStatus";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260808181000_community_tip_ledger_v2.sql"),
  "utf8"
);

const validDraft = {
  fixtureId: "api-football-1234",
  sport: "football",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  kickoffAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
  market: "match_winner",
  selection: "home",
  selectionLabel: "Arsenal to win",
  tippedOdds: 2.1,
  stakeUnits: 1,
  oddsSource: "Bet365 via match odds board",
  rationale: "Home pressing has produced twelve big chances over the last three matches; Chelsea rotate midfield."
};

describe("parseCommunityTipDraft v2", () => {
  it("stamps canonical selection key and market version for a mappable market", () => {
    const parsed = parseCommunityTipDraft(validDraft);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.canonical_selection_key).toBe("football.1x2.regulation.home");
    expect(parsed.value.market_version).toBe("2026-08-07.1");
    expect(parsed.value.odds_source).toBe("Bet365 via match odds board");
    expect(parsed.value.market_line).toBeNull();
  });
  it("accepts a quarter-step line and rejects others", () => {
    const withLine = parseCommunityTipDraft({ ...validDraft, market: "over_under_25", selection: "over", selectionLabel: "Over 2.5 goals", marketLine: 2.5 });
    expect(withLine.ok).toBe(true);
    if (withLine.ok) expect(withLine.value.market_line).toBe(2.5);
    expect(parseCommunityTipDraft({ ...validDraft, marketLine: 2.6 }).ok).toBe(false);
  });
  it("defaults odds_source when omitted and bounds it", () => {
    const draft = parseCommunityTipDraft({ ...validDraft, oddsSource: undefined });
    expect(draft.ok).toBe(true);
    if (draft.ok) expect(draft.value.odds_source).toBe("user-entered");
    expect(parseCommunityTipDraft({ ...validDraft, oddsSource: "x".repeat(121) }).ok).toBe(false);
  });
  it("still locks 30 minutes before kickoff", () => {
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(parseCommunityTipDraft({ ...validDraft, kickoffAt: soon }).ok).toBe(false);
  });
});

describe("tip ledger v2 migration", () => {
  it("adds the tracked columns", () => {
    for (const column of ["market_line", "odds_source", "canonical_selection_key", "market_version", "deleted_at", "rationale_updated_at", "moderated_at", "moderated_reason"]) {
      expect(migration).toContain(column);
    }
  });
  it("restricts author updates to commentary and deletion", () => {
    expect(migration).toContain("grant update (rationale, deleted_at) on public.op_community_tips to authenticated");
    expect(migration).not.toMatch(/grant update[^;]*tipped_odds/);
  });
  it("freezes tracked values for everyone via trigger", () => {
    expect(migration).toContain("op_guard_community_tip_update");
    expect(migration).toContain("Tracked community tip values are immutable");
    expect(migration).toContain("A deleted community tip cannot be restored");
  });
});

describe("communityTipStatus", () => {
  it("supports the full ledger state set", () => {
    expect(communityTipStatus({})).toBe("pending");
    expect(communityTipStatus({ settlement: { result: "won" } })).toBe("won");
    expect(communityTipStatus({ settlement: { result: "void" } })).toBe("void");
    expect(communityTipStatus({ revisions: [{ revision_kind: "correction" }] })).toBe("corrected");
    expect(communityTipStatus({ settlement: { result: "lost" }, revisions: [{ revision_kind: "correction" }] })).toBe("lost");
    expect(communityTipStatus({ moderatedAt: "2026-08-08T00:00:00Z", settlement: { result: "won" } })).toBe("moderated");
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Write the migration** `supabase/migrations/20260808181000_community_tip_ledger_v2.sql`:

```sql
-- Community tip ledger v2: a trackable selection carries user, fixture, market,
-- selection, line, odds, odds source, timestamps, scheduled start and the
-- canonical market version. Posted values are immutable for everyone; the
-- author may edit commentary (rationale) and may delete (one-way tombstone,
-- which never removes a settled result from accountable statistics).

alter table public.op_community_tips add column if not exists market_line numeric(6,2);
alter table public.op_community_tips
  add constraint op_community_tips_market_line_step
  check (market_line is null or (abs(market_line) <= 200 and (market_line * 4) = round(market_line * 4)));

alter table public.op_community_tips add column if not exists odds_source text not null default 'user-entered';
alter table public.op_community_tips
  add constraint op_community_tips_odds_source_length
  check (char_length(odds_source) between 1 and 120);

alter table public.op_community_tips add column if not exists canonical_selection_key text;
alter table public.op_community_tips
  add constraint op_community_tips_canonical_key_length
  check (canonical_selection_key is null or char_length(canonical_selection_key) between 3 and 160);

alter table public.op_community_tips add column if not exists market_version text;
alter table public.op_community_tips
  add constraint op_community_tips_market_version_length
  check (market_version is null or char_length(market_version) between 1 and 40);

alter table public.op_community_tips add column if not exists deleted_at timestamptz;
alter table public.op_community_tips add column if not exists rationale_updated_at timestamptz;
alter table public.op_community_tips add column if not exists moderated_at timestamptz;
alter table public.op_community_tips add column if not exists moderated_reason text;
alter table public.op_community_tips
  add constraint op_community_tips_moderated_reason_length
  check (moderated_reason is null or char_length(moderated_reason) between 1 and 500);

-- Authors may write the new tracked columns at insert time only.
grant insert (market_line, odds_source, canonical_selection_key, market_version)
  on public.op_community_tips to authenticated;

-- Edit boundary: commentary and one-way deletion only.
grant update (rationale, deleted_at) on public.op_community_tips to authenticated;

create policy "Tipsters may edit commentary or delete their tip"
  on public.op_community_tips for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- Freeze trigger: tracked values are immutable for every role, deletion is
-- one-way, commentary edits stamp rationale_updated_at.
create or replace function public.op_guard_community_tip_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_id is distinct from old.author_id
    or new.fixture_db_id is distinct from old.fixture_db_id
    or new.fixture_id is distinct from old.fixture_id
    or new.sport is distinct from old.sport
    or new.home_team is distinct from old.home_team
    or new.away_team is distinct from old.away_team
    or new.kickoff_at is distinct from old.kickoff_at
    or new.market is distinct from old.market
    or new.selection is distinct from old.selection
    or new.selection_label is distinct from old.selection_label
    or new.tipped_odds is distinct from old.tipped_odds
    or new.stake_units is distinct from old.stake_units
    or new.market_line is distinct from old.market_line
    or new.odds_source is distinct from old.odds_source
    or new.canonical_selection_key is distinct from old.canonical_selection_key
    or new.market_version is distinct from old.market_version
    or new.published_at is distinct from old.published_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Tracked community tip values are immutable' using errcode = '42501';
  end if;
  if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
    raise exception 'A deleted community tip cannot be restored' using errcode = '42501';
  end if;
  if new.rationale is distinct from old.rationale then
    new.rationale_updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.op_guard_community_tip_update() from public, anon, authenticated;

drop trigger if exists op_community_tips_guard_update on public.op_community_tips;
create trigger op_community_tips_guard_update
  before update on public.op_community_tips
  for each row execute function public.op_guard_community_tip_update();

comment on column public.op_community_tips.deleted_at is
  'Tombstone: hides the tip from normal display but never removes a validly posted result from accountable statistics.';
```

- [ ] **Step 4: Extend `parseCommunityTipDraft`** in `src/lib/community/predictionContracts.ts`. Add to the type; export `boundedCommunityText` (the existing `boundedText`, renamed export while keeping the internal name); after the `stakeUnits` check insert:

```ts
const marketLineRaw = candidate.marketLine;
let marketLine: number | null = null;
if (marketLineRaw !== undefined && marketLineRaw !== null) {
  const invalid =
    typeof marketLineRaw !== "number" ||
    !Number.isFinite(marketLineRaw) ||
    Math.abs(marketLineRaw) > 200 ||
    Math.round(marketLineRaw * 4) !== marketLineRaw * 4;
  if (invalid) return { ok: false, error: "Lines use quarter steps, for example 2.5 or -1.25." };
  marketLine = marketLineRaw;
}
const oddsSource = candidate.oddsSource === undefined || candidate.oddsSource === null
  ? "user-entered"
  : boundedText(candidate.oddsSource, 1, 120);
if (!oddsSource) return { ok: false, error: "Describe the odds source in 1 to 120 characters." };
const canonicalKey = legacySelectionKey({ sport, market, selection, marketLine });
const canonicalRef = canonicalKey ? canonicalSelection(canonicalKey) : null;
```

and to the returned value: `market_line: marketLine, odds_source: oddsSource, canonical_selection_key: canonicalRef ? canonicalKey : null, market_version: canonicalRef ? canonicalRef.market.version : null`. (Check `legacySelectionKey`'s exact parameter shape at `src/lib/markets/legacyKeys.ts:49` when wiring — pass `marketLine: marketLine ?? undefined` if it wants optional.)

- [ ] **Step 5: Create `src/lib/community/tipStatus.ts`**

```ts
// Derived community-ledger state. Precedence: moderation shadows display,
// a settled result is the ledger truth, a correction marks an unsettled tip.
export type CommunityTipStatus = "pending" | "won" | "lost" | "push" | "void" | "corrected" | "moderated";

export type CommunityTipStatusInput = {
  moderatedAt?: string | null;
  settlement?: { result: "won" | "lost" | "push" | "void" } | null;
  revisions?: Array<{ revision_kind?: string | null }> | null;
};

export function communityTipStatus(tip: CommunityTipStatusInput): CommunityTipStatus {
  if (tip.moderatedAt) return "moderated";
  if (tip.settlement?.result) return tip.settlement.result;
  if ((tip.revisions ?? []).some((revision) => revision.revision_kind === "correction")) return "corrected";
  return "pending";
}

export const COMMUNITY_TIP_STATUS_LABEL: Record<CommunityTipStatus, string> = {
  pending: "Pending",
  won: "Won",
  lost: "Lost",
  push: "Push",
  void: "Void",
  corrected: "Corrected",
  moderated: "Moderated"
};
```

- [ ] **Step 6: Extend the tips route** (`src/app/api/community/tips/route.ts`):
  - `TIP_SELECT`: add `market_line,odds_source,canonical_selection_key,market_version,deleted_at,moderated_at,rationale_updated_at` and `account_type` in the author embed.
  - GET: add `.is("deleted_at", null).is("moderated_at", null)` — deleted/moderated tips leave normal display; accountable statistics live in the views (Task 6) and the profile page shows tombstones (Task 9).
  - Add `PATCH` (commentary edit) and `DELETE` (tombstone):

```ts
export async function PATCH(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Community tips are not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to edit your commentary." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_tip"); if (rateLimit) return rateLimit;
  const parsed = await readBoundedJson<unknown>(request, 4_096);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as { tipId?: unknown; rationale?: unknown };
  if (!isUuid(body.tipId)) return privateJson({ error: "Invalid community tip." }, { status: 400 });
  const rationale = boundedCommunityText(body.rationale, 50, 2000);
  if (!rationale) return privateJson({ error: "Explain the match-specific reasoning in 50 to 2000 characters." }, { status: 400 });
  const { data, error } = await supabase
    .from("op_community_tips")
    .update({ rationale: prepareCommunityText(rationale) })
    .eq("id", body.tipId)
    .eq("author_id", user.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) return databaseUnavailable("community tip edit", error, "Could not update that commentary right now.");
  if (!data) return privateJson({ error: "Tip not found or already deleted." }, { status: 404 });
  return privateJson({ id: data.id, note: "Commentary updated. The tracked market, odds and timestamps stay as posted." });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Community tips are not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to manage your tips." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_tip"); if (rateLimit) return rateLimit;
  const tipId = new URL(request.url).searchParams.get("tipId");
  if (!isUuid(tipId)) return privateJson({ error: "Invalid community tip." }, { status: 400 });
  const { data, error } = await supabase
    .from("op_community_tips")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", tipId)
    .eq("author_id", user.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) return databaseUnavailable("community tip delete", error, "Could not delete that tip right now.");
  if (!data) return privateJson({ error: "Tip not found or already deleted." }, { status: 404 });
  return privateJson({ ok: true, note: "Tip removed from display. A settled result stays in your accountable record." });
}
```

- [ ] **Step 7: Desk + page wiring.** In `src/app/predictions/[matchId]/page.tsx:154-162` keep `bookmaker: selection.bookmaker?.name ?? null` in the reshaped selections. In `MatchCommunityDesk.tsx` submit body add `marketLine: marketLineFromLabel(selectedSelection.label)` (import from `@/lib/sports/results/publicPicks`) and `oddsSource: selectedSelection.bookmaker ? `${selectedSelection.bookmaker} via match odds board` : "match odds board"`; render each tip's status chip via `communityTipStatus` + `COMMUNITY_TIP_STATUS_LABEL`.
- [ ] **Step 8: Run** `npx vitest run src/test/community-tip-ledger-v2.test.ts src/test/community-v2-routes.test.ts src/test/community-prediction-contracts.test.ts` → PASS (update the v2-routes fixtures to include the new draft fields where asserted exactly).
- [ ] **Step 9: Commit** — `git commit -m "feat(community): tip ledger v2 — line, odds source, canonical market version, edit boundary, deletion tombstones"`

---

### Task 5: Settlement uses the stored line; deleted tips still settle

**Files:**
- Modify: `src/lib/community/tipSettlement.ts` (select + decision input)
- Test: extend `src/test/community-tip-settlement.test.ts`

**Interfaces:**
- Consumes: `market_line` column (Task 4). `SettleableCommunityTip` gains `marketLine: number | null`.
- Produces: unchanged run/decision signatures.

- [ ] **Step 1: Failing test** — add to `src/test/community-tip-settlement.test.ts`:

```ts
it("grades with the stored market line, not the label regex", () => {
  const decision = resolveCommunityTipSettlement(
    { ...baseTip, market: "over_under_25", selection: "over", selectionLabel: "Over 2.5 goals (special)", marketLine: 2.5 },
    { provider: "api-football", status: "finished", homeScore: 2, awayScore: 1, lastSyncedAt: iso(now), updatedAt: iso(now) },
    now
  );
  expect(decision.status).toBe("settled");
  expect(decision.result).toBe("won");
});

it("still settles a deleted tip — the tombstone keeps the result", () => {
  // deletion is display-level: resolveCommunityTipSettlement has no deleted input,
  // and runCommunityTipSettlement must not filter deleted rows.
  const source = readFileSync(join(process.cwd(), "src", "lib", "community", "tipSettlement.ts"), "utf8");
  expect(source).not.toMatch(/deleted_at[^,]*is\s*null|\.is\("deleted_at"/);
});
```

(Adapt `baseTip`/fixture helpers to whatever the existing test file already defines — reuse its builders.)

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement.** In `tipSettlement.ts`: add `marketLine: number | null` to `SettleableCommunityTip`; in the select at :234-238 add `market_line`; map it into candidates; in the grading call replace `line: marketLineFromLabel(tip.selectionLabel)` with `line: tip.marketLine ?? marketLineFromLabel(tip.selectionLabel)`.
- [ ] **Step 4: Run to verify PASS** — `npx vitest run src/test/community-tip-settlement.test.ts`.
- [ ] **Step 5: Commit** — `git commit -m "feat(community): settlement grades against the stored line; deleted tips keep settling"`

---

### Task 6: Migration — moderation schema, rate limits v4, leaderboard v2

**Files:**
- Create: `supabase/migrations/20260808182000_community_moderation.sql`
- Test: `src/test/community-moderation.test.ts` (SQL-literal group; route group added in Task 7)

**Interfaces:**
- Produces tables: `op_content_reports`, `op_user_blocks`, `op_moderation_actions`, `op_moderation_appeals`; `hidden_at`/`hidden_reason` on `op_feed_posts`, `op_feed_comments`, `op_forum_threads`, `op_forum_replies` (author-visible RLS); rate-limit actions `community_report` 10/3600, `community_block` 30/3600, `community_appeal` 5/86400, `community_moderation` 120/3600 (plus `workspace_sync` added to the table CHECK, fixing the v3 omission); recreated views `op_public_tipster_performance` (adds `tracked_tips`, `deleted_tips`, `moderated_tips`, `average_settled_odds`, `sports_mix`, `markets_mix`) and `op_public_tipster_leaderboard` (adds `account_type`, eligibility gates). Consumed by Tasks 7, 8, 9.

- [ ] **Step 1: Failing SQL-literal tests** (`src/test/community-moderation.test.ts`):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260808182000_community_moderation.sql"),
  "utf8"
);

describe("moderation migration", () => {
  it("creates the four moderation tables", () => {
    for (const table of ["op_content_reports", "op_user_blocks", "op_moderation_actions", "op_moderation_appeals"]) {
      expect(migration).toContain(`create table public.${table}`);
    }
  });
  it("keeps the audit log service-role-only (RLS on, no policies)", () => {
    expect(migration).toContain("alter table public.op_moderation_actions enable row level security");
    expect(migration).not.toMatch(/create policy[^;]*op_moderation_actions/);
  });
  it("hides moderated content from everyone except the author", () => {
    for (const table of ["op_feed_posts", "op_feed_comments", "op_forum_threads", "op_forum_replies"]) {
      expect(migration).toContain(`alter table public.${table} add column if not exists hidden_at timestamptz`);
    }
    expect(migration).toContain("hidden_at is null or author_id = auth.uid()");
  });
  it("extends rate limits and repairs the workspace_sync check omission", () => {
    for (const action of ["community_report", "community_block", "community_appeal", "community_moderation", "workspace_sync"]) {
      expect(migration).toContain(`'${action}'`);
    }
  });
  it("rebuilds the leaderboard with eligibility gates and sample-aware stats", () => {
    expect(migration).toContain("account_type in ('organic','staff')");
    expect(migration).toContain("integrity_flagged_at is null");
    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain("deleted_tips * 4");
    expect(migration).toContain("average_settled_odds");
    expect(migration).toContain("sports_mix");
    expect(migration).toContain("markets_mix");
    expect(migration).toContain("+ 20)) * 100");
  });
  it("keeps one report per reporter per content item", () => {
    expect(migration).toContain("unique (reporter_id, content_type, content_id)");
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Write the migration** `supabase/migrations/20260808182000_community_moderation.sql`. Full content:

```sql
-- Community moderation: reports, blocks, a service-role moderation audit log,
-- appeals, hide-from-display columns, moderation rate limits, and the
-- eligibility-gated sample-aware tipster leaderboard.

-- 1) Reports -----------------------------------------------------------------
create table public.op_content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.op_profiles(id) on delete cascade,
  content_type text not null check (content_type in ('feed_post','feed_comment','forum_thread','forum_reply','community_tip','profile')),
  content_id text not null check (char_length(content_id) between 1 and 80),
  category text not null check (category in ('spam','scam_or_paid_tips','guaranteed_win_claim','harassment','impersonation','unsafe_link','other')),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.op_profiles(id) on delete set null,
  unique (reporter_id, content_type, content_id)
);
create index op_content_reports_queue_idx on public.op_content_reports (status, created_at);
alter table public.op_content_reports enable row level security;
create policy "users file their own reports"
  on public.op_content_reports for insert
  to authenticated
  with check (auth.uid() = reporter_id);
create policy "users read their own reports"
  on public.op_content_reports for select
  to authenticated
  using (auth.uid() = reporter_id);
grant select on public.op_content_reports to authenticated;
grant insert (reporter_id, content_type, content_id, category, note) on public.op_content_reports to authenticated;
grant all on public.op_content_reports to service_role;

-- 2) Blocks ------------------------------------------------------------------
create table public.op_user_blocks (
  blocker_id uuid not null references public.op_profiles(id) on delete cascade,
  blocked_id uuid not null references public.op_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index op_user_blocks_blocked_idx on public.op_user_blocks (blocked_id);
alter table public.op_user_blocks enable row level security;
create policy "users read their own blocks"
  on public.op_user_blocks for select to authenticated using (auth.uid() = blocker_id);
create policy "users create their own blocks"
  on public.op_user_blocks for insert to authenticated with check (auth.uid() = blocker_id);
create policy "users remove their own blocks"
  on public.op_user_blocks for delete to authenticated using (auth.uid() = blocker_id);
grant select, delete on public.op_user_blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.op_user_blocks to authenticated;
grant all on public.op_user_blocks to service_role;

-- 3) Moderation audit log (service-role only; RLS on, zero policies) ---------
create table public.op_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.op_profiles(id) on delete restrict,
  action text not null check (action in ('hide','unhide','lock_thread','unlock_thread','moderate_tip','dismiss_report','flag_account','unflag_account','note')),
  content_type text check (content_type in ('feed_post','feed_comment','forum_thread','forum_reply','community_tip','profile')),
  content_id text check (content_id is null or char_length(content_id) between 1 and 80),
  target_user_id uuid references public.op_profiles(id) on delete set null,
  report_id uuid references public.op_content_reports(id) on delete set null,
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now()
);
create index op_moderation_actions_target_idx on public.op_moderation_actions (target_user_id, created_at desc);
create index op_moderation_actions_content_idx on public.op_moderation_actions (content_type, content_id);
alter table public.op_moderation_actions enable row level security;
grant all on public.op_moderation_actions to service_role;

-- 4) Appeals (written by the server after verifying the target; read-own) ----
create table public.op_moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.op_moderation_actions(id) on delete cascade,
  appellant_id uuid not null references public.op_profiles(id) on delete cascade,
  body text not null check (char_length(body) between 10 and 1000),
  status text not null default 'open' check (status in ('open','upheld','overturned')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  unique (action_id, appellant_id)
);
alter table public.op_moderation_appeals enable row level security;
create policy "users read their own appeals"
  on public.op_moderation_appeals for select to authenticated using (auth.uid() = appellant_id);
grant select on public.op_moderation_appeals to authenticated;
grant all on public.op_moderation_appeals to service_role;

-- 5) Hide-from-display columns ------------------------------------------------
alter table public.op_feed_posts add column if not exists hidden_at timestamptz;
alter table public.op_feed_posts add column if not exists hidden_reason text;
alter table public.op_feed_comments add column if not exists hidden_at timestamptz;
alter table public.op_feed_comments add column if not exists hidden_reason text;
alter table public.op_forum_threads add column if not exists hidden_at timestamptz;
alter table public.op_forum_threads add column if not exists hidden_reason text;
alter table public.op_forum_replies add column if not exists hidden_at timestamptz;
alter table public.op_forum_replies add column if not exists hidden_reason text;

drop policy "feed posts are readable by everyone" on public.op_feed_posts;
create policy "feed posts are readable unless hidden"
  on public.op_feed_posts for select to anon, authenticated
  using (hidden_at is null or author_id = auth.uid());
drop policy "feed comments are readable by everyone" on public.op_feed_comments;
create policy "feed comments are readable unless hidden"
  on public.op_feed_comments for select to anon, authenticated
  using (hidden_at is null or author_id = auth.uid());
drop policy "forum threads are readable by everyone" on public.op_forum_threads;
create policy "forum threads are readable unless hidden"
  on public.op_forum_threads for select to anon, authenticated
  using (hidden_at is null or author_id = auth.uid());
drop policy "forum replies are readable by everyone" on public.op_forum_replies;
create policy "forum replies are readable unless hidden"
  on public.op_forum_replies for select to anon, authenticated
  using (hidden_at is null or author_id = auth.uid());

-- 6) Rate limits v4 -----------------------------------------------------------
-- (Copy the full function body from 20260808130000_workspaces_and_shares.sql
-- and extend the VALUES policy list; also rebuild the action CHECK, which v3
-- forgot to extend for workspace_sync.)
alter table public.op_user_rate_limits drop constraint op_user_rate_limits_action_check;
alter table public.op_user_rate_limits add constraint op_user_rate_limits_action_check check (
  action in (
    'profile_update','follow_team','push_subscription','community_post','community_comment',
    'community_like','forum_thread','forum_reply','community_poll_vote','community_tip',
    'workspace_sync','community_report','community_block','community_appeal','community_moderation'
  )
);
-- create or replace function public.op_consume_user_rate_limit(p_action text) ...
--   new rows in the VALUES list:
--     ('community_report', 10, 3600),
--     ('community_block', 30, 3600),
--     ('community_appeal', 5, 86400),
--     ('community_moderation', 120, 3600)
-- [At execution: paste the exact v3 function body and add these four rows.]

-- 7) Leaderboard v2 ------------------------------------------------------------
drop view if exists public.op_public_tipster_leaderboard;
drop view if exists public.op_public_tipster_performance;

create view public.op_public_tipster_performance
with (security_invoker = true) as
select
  t.author_id,
  count(*) as tracked_tips,
  count(*) filter (where t.deleted_at is null and t.moderated_at is null) as published_tips,
  count(*) filter (where t.deleted_at is not null) as deleted_tips,
  count(*) filter (where t.moderated_at is not null) as moderated_tips,
  count(s.tip_id) filter (where s.result <> 'void') as settled_tips,
  count(s.tip_id) filter (where s.result = 'won') as wins,
  count(s.tip_id) filter (where s.result = 'lost') as losses,
  count(s.tip_id) filter (where s.result = 'push') as pushes,
  count(s.tip_id) filter (where s.result = 'void') as voids,
  coalesce(sum(t.stake_units) filter (where s.result in ('won','lost','push')), 0) as staked_units,
  coalesce(sum(s.net_units), 0) as net_units,
  round((avg(t.tipped_odds) filter (where s.result in ('won','lost','push')))::numeric, 2) as average_settled_odds,
  case
    when coalesce(sum(t.stake_units) filter (where s.result in ('won','lost','push')), 0) > 0
    then round(((coalesce(sum(s.net_units), 0) / sum(t.stake_units) filter (where s.result in ('won','lost','push'))) * 100)::numeric, 2)
    else null
  end as yield_percent,
  round(((coalesce(sum(s.net_units), 0) / (coalesce(sum(t.stake_units) filter (where s.result in ('won','lost','push')), 0) + 20)) * 100)::numeric, 2) as evidence_adjusted_yield_percent,
  array_agg(distinct t.sport) as sports_mix,
  array_agg(distinct t.market) as markets_mix,
  max(t.published_at) as latest_tip_at
from public.op_community_tips t
left join public.op_community_tip_settlements s on s.tip_id = t.id
group by t.author_id;

create view public.op_public_tipster_leaderboard
with (security_invoker = true) as
with gated as (
  select
    p.*,
    pr.username,
    pr.display_name,
    pr.account_type,
    (
      p.settled_tips >= 5
      and pr.account_type in ('organic','staff')
      and pr.integrity_flagged_at is null
      and pr.created_at <= now() - interval '7 days'
      and (p.deleted_tips * 4) <= greatest(p.tracked_tips, 1)
    ) as eligible
  from public.op_public_tipster_performance p
  join public.op_profiles pr on pr.id = p.author_id
)
select
  row_number() over (
    order by eligible desc, evidence_adjusted_yield_percent desc, net_units desc, settled_tips desc, username asc
  ) as rank_position,
  gated.*,
  evidence_adjusted_yield_percent as ranking_score
from gated;

grant select on public.op_public_tipster_performance to anon, authenticated;
grant select on public.op_public_tipster_leaderboard to anon, authenticated;

comment on view public.op_public_tipster_leaderboard is
  'Eligibility gates: >= 5 settled non-void tips, organic or labelled-staff account, no integrity flag, account older than 7 days, deleted tracked selections <= 25% of tracked tips. Post-start tips are structurally impossible (30-minute pre-kickoff lock in RLS + trigger). Ranking is evidence-adjusted yield (20-unit prior), never raw hit rate.';
```

(At execution, paste the real `op_consume_user_rate_limit` v3 body from `20260808130000_workspaces_and_shares.sql:130-142` with the four new VALUES rows — the commented block above marks exactly where.)

- [ ] **Step 4: Run to verify PASS** — `npx vitest run src/test/community-moderation.test.ts` (also rerun `community-prediction-contracts.test.ts`: its SQL assertions read the OLD migration file, which is untouched — they must still pass).
- [ ] **Step 5: Commit** — `git commit -m "feat(community): moderation schema, rate limits v4, eligibility-gated sample-aware leaderboard"`

---

### Task 7: Moderation API routes, staff queue page, meta-test lists

**Files:**
- Create: `src/app/api/community/reports/route.ts`, `src/app/api/community/blocks/route.ts`, `src/app/api/community/moderation/route.ts`, `src/app/api/community/appeals/route.ts`, `src/app/community/moderation/page.tsx`, `src/components/community/ModerationQueue.tsx` (client)
- Modify: `src/test/mutation-origin-security.test.ts` (add `community/tips`, `community/tips/revisions`, `community/polls`, plus the four new routes to its list), `src/test/user-rate-limit-security.test.ts` (add four new routes), `src/test/bounded-json-security.test.ts` (add reports/moderation/appeals POST routes), `src/test/route-canonical-contract.test.ts` `NOINDEX` list (add `/community/moderation`), `docs/route-map.md`
- Test: extend `src/test/community-moderation.test.ts` with the route group

**Interfaces:**
- Consumes: cookie client (`createSupabaseServerClient`), service client (`getSupabaseServerClient` from `@/lib/supabase/server`), tables from Task 6.
- Produces: `POST /api/community/reports` `{contentType, contentId, category, note?}` → 201 `{id}`; `GET/POST/DELETE /api/community/blocks` (`{blockedId}` / `?blockedId=`); `GET /api/community/moderation` → `{reports:[...]}` (admin-only), `POST /api/community/moderation` `{action, contentType?, contentId?, targetUserId?, reportId?, reason}` → 201 `{id}`; `GET /api/community/appeals` → `{actions:[...], appeals:[...]}`, `POST /api/community/appeals` `{actionId, body}` → 201 `{id}`.

- [ ] **Step 1: Failing route tests** — extend `src/test/community-moderation.test.ts` using the exact mock convention from `community-write-routes.test.ts` (hoisted `vi.mock` of `@/lib/supabase/serverAuthClient` and `@/lib/supabase/server`, chainable client factory, `rpc` resolving `[{allowed:true,remaining:10,retry_after_seconds:60}]`). Cases:

```ts
it("rejects unauthenticated reports", async () => { /* 401, from not called */ });
it("files a report", async () => { /* 201; insert called with reporter_id "user-1", category "spam" */ });
it("treats a duplicate report as already-filed", async () => { /* insert error code 23505 → 200 {ok:true} */ });
it("blocks and unblocks a user", async () => { /* POST 201; DELETE 200; self-block → 400 */ });
it("refuses the moderation queue to non-admins", async () => { /* profile is_admin=false → 403; service client never called */ });
it("hides content and writes one audit row", async () => {
  /* admin cookie profile; POST action=hide contentType=feed_post →
     service client update op_feed_posts.hidden_at AND insert op_moderation_actions */
});
it("locks a thread via lock_thread", async () => { /* update op_forum_threads is_locked=true */ });
it("moderates a tip without touching its tracked values", async () => { /* update sets only moderated_at/moderated_reason */ });
it("rejects an appeal for an action that did not target the caller", async () => { /* action lookup returns null → 404 */ });
it("files an appeal once", async () => { /* 201; second insert 23505 → 200 already-filed */ });
```

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement the four routes.** All follow the house pattern (`dynamic = "force-dynamic"`, origin guard on mutations, cookie auth, `enforceUserRateLimit`, `readBoundedJson`, `privateJson` everywhere). Moderation route skeleton:

```ts
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { isUuid } from "@/lib/security/inputValidation";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";

export const dynamic = "force-dynamic";

const CONTENT_TABLES: Record<string, { table: string; hide: "hidden" | "lock" | "moderate" | "flag" }> = {
  feed_post: { table: "op_feed_posts", hide: "hidden" },
  feed_comment: { table: "op_feed_comments", hide: "hidden" },
  forum_thread: { table: "op_forum_threads", hide: "hidden" },
  forum_reply: { table: "op_forum_replies", hide: "hidden" },
  community_tip: { table: "op_community_tips", hide: "moderate" },
  profile: { table: "op_profiles", hide: "flag" }
};

async function requireModerator() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: privateJson({ error: "Moderation is not enabled yet." }, { status: 503 }) } as const;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: privateJson({ error: "Sign in first." }, { status: 401 }) } as const;
  const { data: profile } = await supabase.from("op_profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return { error: privateJson({ error: "Moderator access required." }, { status: 403 }) } as const;
  return { supabase, user } as const;
}

export async function GET() {
  const gate = await requireModerator();
  if ("error" in gate) return gate.error;
  const admin = getSupabaseServerClient();
  if (!admin) return privateJson({ error: "Moderation is not enabled yet." }, { status: 503 });
  const { data, error } = await admin
    .from("op_content_reports")
    .select("id,reporter_id,content_type,content_id,category,note,status,created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return databaseUnavailable("moderation queue read", error, "Queue is temporarily unavailable.");
  return privateJson({ reports: data ?? [] });
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const gate = await requireModerator();
  if ("error" in gate) return gate.error;
  const rateLimit = await enforceUserRateLimit(gate.supabase, "community_moderation"); if (rateLimit) return rateLimit;
  const parsed = await readBoundedJson<unknown>(request, 4_096);
  if (!parsed.ok) return parsed.response;
  // validate action/contentType/contentId/targetUserId/reportId/reason,
  // apply the effect via the service client, then insert the audit row —
  // every successful action produces exactly one op_moderation_actions row.
  ...
}
```

Effect mapping in POST: `hide`/`unhide` → `hidden_at`/`hidden_reason` on the content table; `lock_thread`/`unlock_thread` → `is_locked` on `op_forum_threads`; `moderate_tip` → `moderated_at`/`moderated_reason` on `op_community_tips` (allowed by the freeze trigger — those columns are not frozen); `flag_account`/`unflag_account` → `integrity_flagged_at`/`integrity_flag_reason` on `op_profiles`; `dismiss_report` → report `status='dismissed'`; any action carrying `reportId` also marks that report `status='actioned'`, `resolved_at`, `resolved_by`. Audit row insert is unconditional on success.

Appeals route: cookie auth → service client verifies `op_moderation_actions.id = actionId AND target_user_id = user.id` → insert `op_moderation_appeals` via service client (23505 → `{ok:true, note:"Appeal already filed."}`); GET returns actions targeting the caller plus their appeals.

Reports route: cookie-client insert under RLS; `contentId` validated with `isUuid`; `category` against the seven-value union; 23505 → 200 `{ok:true}` (idempotent, like likes).

Blocks route: cookie-client; `blockedId` must be a uuid and ≠ caller.

- [ ] **Step 4: Queue page.** `src/app/community/moderation/page.tsx`: server component, `dynamic = "force-dynamic"`, metadata via `pageMetadata({ path: "/community/moderation", noIndex: true })` (mirror how `/my` declares noindex — copy its exact pattern); non-admin → gentle "Moderator access required" panel (no `notFound()`, honest copy); admin → render `<ModerationQueue />` client component that GETs `/api/community/moderation` and posts actions with reason input. Register the route in `docs/route-map.md`; add `/community/moderation` to `NOINDEX` in `route-canonical-contract.test.ts:38`.
- [ ] **Step 5: Extend the three meta-test lists** (`mutation-origin-security.test.ts` — also adding the three previously-missing community routes; `user-rate-limit-security.test.ts`; `bounded-json-security.test.ts`).
- [ ] **Step 6: Run** `npx vitest run src/test/community-moderation.test.ts src/test/mutation-origin-security.test.ts src/test/user-rate-limit-security.test.ts src/test/bounded-json-security.test.ts src/test/route-canonical-contract.test.ts src/test/product-shell-contract.test.tsx` → PASS.
- [ ] **Step 7: Commit** — `git commit -m "feat(community): reports, blocks, moderator queue with audit log, appeals"`

---

### Task 8: Enforce content safety in write routes; block-aware reads

**Files:**
- Modify: `src/app/api/community/posts/route.ts`, `comments/route.ts`, `threads/route.ts`, `replies/route.ts`, `tips/route.ts` (POST: `assessCommunityText` gate on body/title/rationale), `posts/route.ts` GET + `comments/route.ts` GET + `src/app/community/page.tsx` (filter authors the signed-in viewer blocked)
- Test: extend `src/test/community-write-routes.test.ts` and `src/test/community-moderation.test.ts`

- [ ] **Step 1: Failing tests** — in `community-write-routes.test.ts` add:

```ts
it.each([
  ["posts", () => createPost(jsonRequest({ body: "DM me for tips " + "x".repeat(40) }))],
  ["threads", () => createThread(jsonRequest({ categoryId: CATEGORY_ID, title: "Sure odds inside", body: "guaranteed win tonight" }))],
  ["replies", () => createReply(jsonRequest({ threadId: THREAD_ID, body: "join https://bit.ly/xyz" }))]
])("rejects unsafe %s content before any DB write", async (_label, run) => {
  const response = await run();
  expect(response.status).toBe(400);
  expect(insert).not.toHaveBeenCalled();
});
it("filters blocked authors out of the posts feed for the signed-in viewer", async () => {
  /* mock: op_user_blocks select → [{blocked_id: "user-2"}]; posts rows from user-1 and user-2 → response contains only user-1's */
});
```

(Reuse the file's existing request/client helpers; tips rationale gets the same gate via a case in `community-v2-routes.test.ts`.)

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement.** In each POST, after parsing/normalising and before insert:

```ts
const safety = assessCommunityText(body); // for threads: assess `${title}\n${body}`
if (!safety.allowed) return privateJson({ error: safety.reasons[0] }, { status: 400 });
```

In `posts/route.ts` GET and `comments/route.ts` GET, after fetching rows: if `auth.getUser()` returns a user, fetch `op_user_blocks` (`select("blocked_id").eq("blocker_id", user.id).limit(500)`) and filter rows whose `author_id` is blocked; same filter in the `/community` page server component (it already has the user for the composer).
- [ ] **Step 4: Run** the two test files → PASS. Also `npx vitest run src/test/community-v2-routes.test.ts`.
- [ ] **Step 5: Commit** — `git commit -m "feat(community): content-safety gates on writes; block-aware feed reads"`

---

### Task 9: Leaderboard v2 UI + accountable profile page

**Files:**
- Modify: `src/app/community/page.tsx` (leaderboard select: add `account_type,average_settled_odds,sports_mix,markets_mix,staked_units,tracked_tips,deleted_tips`), `src/components/community/TipsterLeaderboard.tsx`, `src/app/community/u/[handle]/page.tsx`
- Test: `src/test/community-leaderboard-view.test.tsx`

**Interfaces:**
- Consumes: view columns from Task 6, `wilsonInterval(successes, trials, z?)` from `src/lib/performance/ledgerMetrics.ts:83`, `communityTipStatus` from Task 4, `AccountBadge` from Task 3.

- [ ] **Step 1: Failing test** (`src/test/community-leaderboard-view.test.tsx`) — render `TipsterLeaderboard` via `renderToStaticMarkup` with two fixture rows (one eligible with 12 settled, one ineligible small sample) and assert: sample shown ("12 settled"), average odds shown, W-L-P record shown, a Wilson interval range rendered (compute expected with `wilsonInterval(7, 11)` and assert the formatted percents appear), sport/market mix chips, the ineligible row explains why ("needs 5 settled tips" copy), and no raw-hit-rate-only ranking claim.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement.** `TipsterLeaderboard` rows show: rank, handle + `AccountBadge`, `settled_tips` sample, record `W-L-P`, `average_settled_odds`, `yield_percent`, evidence-adjusted yield (labelled "evidence-adjusted"), 95% Wilson interval on hit rate (`wilsonInterval(wins, wins + losses)`, shown as "hit rate 41–78%" style, only when `wins + losses > 0`), mix chips (first 3 of `sports_mix`/`markets_mix`), and for ineligible rows a one-line reason. Keep the "open seat" honest empty state. Profile page: add badge to header; performance panel gains the same fields; tips list keeps deleted/moderated rows as tombstones — status chip via `communityTipStatus`, body replaced by "Deleted by the tipster — the settled result stays in the record." / "Removed by moderation — the settled result stays in the record."; profile query must NOT filter `deleted_at`/`moderated_at`.
- [ ] **Step 4: Run** the new test + `npx vitest run src/test/community-prediction-contracts.test.ts` (its UI-copy assertions on the profile page must still pass) → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(community): sample-aware leaderboard UI with Wilson intervals; accountable profile tombstones"`

---

### Task 10: Contextual community modules + match-page link fix

**Files:**
- Create: `src/components/community/CommunitySubjectPanel.tsx`, `src/lib/community/subjects.ts`
- Modify: `src/app/predictions/league/[slug]/table/page.tsx` (embed panel), `src/app/track-record/publication/[publicationId]/page.tsx` (embed panel), `src/app/season-outlooks/page.tsx` (static link module — no DB read, page stays ISR), `src/app/predictions/[matchId]/page.tsx:288` (fix `\community` href), `src/app/community/page.tsx` + `src/components/community/FeedComposer.tsx` (subject prefill + subject-filtered view), `src/app/api/community/posts/route.ts` (accept subject)
- Test: `src/test/community-context-panels.test.ts`

**Interfaces:**
- Produces: `COMMUNITY_SUBJECT_TYPES` const array + `CommunitySubjectType`, `parseCommunitySubject(raw: { subjectType?: unknown; subjectId?: unknown }): { subject_type: CommunitySubjectType; subject_id: string } | null`, `parseSubjectParam(raw: string | undefined): { subjectType, subjectId } | null` (parses `"type:id"`), `<CommunitySubjectPanel subjectType subjectId title />`.

- [ ] **Step 1: Failing tests** (`src/test/community-context-panels.test.ts`) — source-scanning group (convention of `product-navigation.test.ts`):

```ts
it("fixes the match-page discuss link (no backslash-relative path)", () => {
  const page = read("src/app/predictions/[matchId]/page.tsx");
  expect(page).not.toContain("`\\community");
  expect(page).toContain("/community?subject=");
});
it("embeds community context on the competition hub", () => {
  expect(read("src/app/predictions/league/[slug]/table/page.tsx")).toContain("CommunitySubjectPanel");
});
it("embeds community context on publication receipts", () => {
  expect(read("src/app/track-record/publication/[publicationId]/page.tsx")).toContain("CommunitySubjectPanel");
});
it("links season outlooks to discussion without a DB read", () => {
  const page = read("src/app/season-outlooks/page.tsx");
  expect(page).toContain("/community?subject=season_outlook");
  expect(page).not.toContain("CommunitySubjectPanel");
});
```

plus unit cases for `parseCommunitySubject` (valid fixture id via `cleanExternalIdentifier` shape, rejects unknown type, rejects 121-char id, `parseSubjectParam("fixture:api-football-1234")` round-trips).

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement `src/lib/community/subjects.ts`**

```ts
import { cleanExternalIdentifier } from "@/lib/security/inputValidation";

export const COMMUNITY_SUBJECT_TYPES = [
  "fixture", "competition", "team", "player",
  "publication", "season_outlook", "strategy", "product_feedback"
] as const;
export type CommunitySubjectType = (typeof COMMUNITY_SUBJECT_TYPES)[number];

const SLUG_PATTERN = /^[a-z0-9][a-z0-9:_\-.]{0,119}$/i;

export function parseCommunitySubject(raw: { subjectType?: unknown; subjectId?: unknown }): { subject_type: CommunitySubjectType; subject_id: string } | null {
  const type = raw.subjectType;
  if (typeof type !== "string" || !(COMMUNITY_SUBJECT_TYPES as readonly string[]).includes(type)) return null;
  if (type === "fixture") {
    const fixtureId = cleanExternalIdentifier(raw.subjectId);
    return fixtureId ? { subject_type: "fixture", subject_id: fixtureId } : null;
  }
  const id = typeof raw.subjectId === "string" ? raw.subjectId.trim() : "";
  return SLUG_PATTERN.test(id) ? { subject_type: type as CommunitySubjectType, subject_id: id } : null;
}

export function parseSubjectParam(raw: string | undefined): { subjectType: CommunitySubjectType; subjectId: string } | null {
  if (!raw) return null;
  const [type, ...rest] = raw.split(":");
  const parsed = parseCommunitySubject({ subjectType: type, subjectId: rest.join(":") });
  return parsed ? { subjectType: parsed.subject_type, subjectId: parsed.subject_id } : null;
}

export function subjectHref(subjectType: CommunitySubjectType, subjectId: string): string {
  return `/community?subject=${encodeURIComponent(`${subjectType}:${subjectId}`)}`;
}
```

- [ ] **Step 4: Implement `CommunitySubjectPanel`** (async server component): cookie client → `op_feed_posts` where `subject_type`/`subject_id` match, `.is("hidden_at", null)`, author embed with `account_type`, limit 5, newest first; renders heading (`title`), each post via `<CommunityBody>` + `AccountBadge` + `RelativeTime`; honest empty state: "No discussion yet. Be the first to post." with a link via `subjectHref(...)`; on any error render the link-only fallback (never fake activity). Embed on the competition hub (`subjectType="competition"`, `subjectId={league.slug}`, below the table) and the publication receipt (`subjectType="publication"`, `subjectId={publicationId}`, after the settlement history). Season outlooks: static `<a href={subjectHref("season_outlook", "premier-league-2026")}>` module only.
- [ ] **Step 5: Composer + page.** `/community/page.tsx`: read `searchParams.subject` → `parseSubjectParam` → pass `{subjectType, subjectId}` to `FeedComposer` (which posts them as `subjectType`/`subjectId` and shows a small "Posting about: …" chip) and, when present, additionally render a subject-filtered post list section above the main feed with a "Show all posts" link to `/community`. `posts/route.ts` POST: run `parseCommunitySubject` on the optional fields; when `subject_type === "fixture"` also set `match_id = subject_id` (back-compat with the existing desk feed filter). Match page :288: `href={subjectHref("fixture", match.id)}`.
- [ ] **Step 6: Run** `npx vitest run src/test/community-context-panels.test.ts src/test/route-canonical-contract.test.ts src/test/product-shell-contract.test.tsx src/test/product-navigation.test.ts` → PASS (no new routes, so contracts hold; the season-outlooks page keeps `revalidate`).
- [ ] **Step 7: Commit** — `git commit -m "feat(community): contextual discussion modules on competition, receipt and outlook surfaces; fix broken discuss link"`

---

### Task 11: Ops honesty — seed gating, canary fix, encoding repair + provenance audit

**Files:**
- Modify: `scripts/seed-community-posts.mjs`, `scripts/site-health.mjs` (community check), `docs/automations.md` (routine + persona sections), `package.json` (two new script entries)
- Create: `scripts/repair-community-encoding.ts`, `scripts/audit-community-provenance.ts` (both run via `vite-node --config scripts/vite-node.config.ts`, so they import `prepareCommunityText` from `src/lib/community/textContent.ts` directly)
- Test: extend `src/test/ops-scripts-contract.test.ts` coverage if it enumerates scripts (check at execution); `src/test/community-ops-honesty.test.ts`

- [ ] **Step 1: Failing test** (`src/test/community-ops-honesty.test.ts`, source-scanning):

```ts
it("seed script refuses to post without explicit demo acknowledgement", () => {
  const script = read("scripts/seed-community-posts.mjs");
  expect(script).toContain("--post");
  expect(script).toContain("account_type");
  expect(script).toMatch(/dry[- ]run/i);
});
it("site health accepts an honest empty community feed", () => {
  const script = read("scripts/site-health.mjs");
  expect(script).not.toMatch(/feed.*non-?empty|non-?empty.*feed/i); // adjust to the actual check found at execution
});
it("daily routine no longer instructs unconditional seeding", () => {
  expect(read("docs/automations.md")).not.toContain("keep the feed moving");
});
```

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement.**
  - `seed-community-posts.mjs`: add arg parsing (`--post` to write; default prints a dry-run table of what it *would* post and exits 0). Before any write: fetch the personas' `username, account_type` from `op_profiles`; if any persona is missing or `account_type !== 'demo'` (except `oddspadi_desk`, which must be `'staff'`), print the offending usernames and `process.exit(1)` — demo content may only be produced by accounts that are visibly labelled demo. Keep the 20-hour idempotency guard.
  - `site-health.mjs`: read the script, find the community-feed check, change it to require HTTP 200 + parseable response only — an empty feed is healthy ("Prefer honest empty states"). Keep failing on 5xx/timeouts.
  - `scripts/repair-community-encoding.ts`: service-role client from env (`SUPABASE_URL` + `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY`); scan `op_feed_posts.body`, `op_feed_comments.body`, `op_forum_threads.title+body`, `op_forum_replies.body`, `op_community_tips.rationale` in 500-row pages for the mojibake marker; default dry-run report (table of table → affected rows → sample before/after via `prepareCommunityText`); `--run` applies updates (for `op_community_tips` this touches only `rationale`, which the freeze trigger permits). Exit 1 on any error.
  - `scripts/audit-community-provenance.ts`: read-only. Reports: profiles per `account_type`; posts/comments/likes/tips counts grouped by author `account_type`; auth users on `@community.oddspadi.com` whose profile is not labelled demo/staff (via `admin.auth.admin.listUsers()`); count of `op_feed_posts` rows with mojibake markers. Prints a summary and exits 0 (1 on query failure). This is the "audit current community records" deliverable — runnable against production by the operator.
  - `package.json`: add `"ops:repair-community-encoding": "vite-node --config scripts/vite-node.config.ts scripts/repair-community-encoding.ts"` and `"ops:audit-community": "vite-node --config scripts/vite-node.config.ts scripts/audit-community-provenance.ts"`.
  - `docs/automations.md`: daily routine step 2 becomes "Optional: `node scripts/seed-community-posts.mjs` (dry-run). Demo posting requires `--post` and is labelled 'Demo account' on the site; prefer an honest quiet feed."; persona section documents the labelling.
- [ ] **Step 4: Run** `npx vitest run src/test/community-ops-honesty.test.ts src/test/ops-scripts-contract.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(ops): demo-gated seeding, canary accepts honest empty feed, encoding repair + provenance audit scripts"`

---

### Task 12: Documentation, full verification, closeout

**Files:**
- Create: `docs/community-system.md`, `docs/community-tip-ledger.md`, `docs/community-moderation.md`, `docs/demo-and-staff-content.md`
- Modify: `docs/route-map.md` (already done in Task 7 — verify), `docs/community-feature-plan.md` (add a pointer: superseded by `community-system.md`), `docs/improvements-log.md` (one entry, matching its existing format)

- [ ] **Step 1: Write the four docs.**
  - `community-system.md`: the two lanes (feed/forums vs accountable tips), canonical subjects table (the 8 types + id conventions: fixture = provider external id, competition = league slug, publication = publication id), contextual surfaces map (match desk, competition hub, receipt, outlooks), the truth-lane boundary (community never touches `op_publications`), read paths and rate limits.
  - `community-tip-ledger.md`: the tracked-selection record (all 10 fields incl. canonical market version), the 30-minute lock (contract + RLS + trigger, why post-start is impossible), immutability (grants + freeze trigger), edit boundary (commentary only), statuses (`pending/won/lost/push/void/corrected/moderated` with precedence), deletion tombstones (display vs statistics), settlement (grader, stored line, deleted tips still settle), leaderboard eligibility gates + evidence-adjusted ranking + Wilson intervals, and the explicit note that community settlement uses `decisionOutcomeSettlement` while official uses `settle()` — unification is a known follow-up.
  - `community-moderation.md`: report categories, block semantics, queue + actions + one-audit-row-per-action invariant, appeals, content-safety rules (unsafe links, solicitation, certainty claims, spam), impersonation protection (reserved handles), rate limits, why private messaging stays out until abuse controls mature.
  - `demo-and-staff-content.md`: the four account types, the eight personas and their labels, what demo content may never do (rank, count as engagement, masquerade), the seed script's demo gate, the canary's honest-empty-state stance, the provenance audit script.
- [ ] **Step 2: Full local proof stack** (from `docs/RELEASE.md`):

```powershell
npm run build
npm run typecheck
npm test
git diff --check
```

Fix anything that fails; the contract suites (route-canonical, product-shell, api-hardening, consumer-copy, product-vocabulary, server-rendered-timezone, env-example-coverage, cross-surface-consistency) are the likely biters.
- [ ] **Step 3: Commit docs** — `git commit -m "docs(community): system, tip ledger, moderation, demo/staff content"`
- [ ] **Step 4: Closeout report.** Summarise per AGENTS.md: commits on `claude/oddspadi-community-integrity-264454` (a worktree handoff, not a release); local quality proof (build/typecheck/test output); explicit handoffs: (a) the three migrations are files only — applying them needs the verified `supabase_oddspadi` connector, (b) `ops:audit-community` should be run against production after migration apply to complete the records audit, (c) `ops:repair-community-encoding --run` if the audit finds stored mojibake, (d) deploy via `npm run deploy:production` from clean `main`.

---

## Self-review (done at planning time)

- **Spec coverage:** canonical context → Tasks 3, 10; tipster selection fields → Task 4 (user, fixture, market, selection, line, odds, odds source, timestamp = `published_at`/`created_at`, scheduled start = `kickoff_at`, canonical market version); post-start rejection → pre-existing (30-min lock) + regression-tested in Task 4; ledger separation → global constraint + docs; statuses incl. corrected/moderated → Task 4 `tipStatus`; immutable posted values → Task 4 freeze trigger; commentary-only edit → Task 4 PATCH + grants; deletion tombstone/stats retention → Tasks 4, 5, 6, 9; seed/demo audit + marking → Tasks 3, 11; demo visibility/leaderboard/engagement exclusion → Tasks 3, 6, 11; leaderboard gates + sample-aware ranking + displayed fields → Tasks 6, 9; contextual UI on all four named surfaces → Task 10 (+ existing match desk); moderation (report/block/spam/rate-limit/links/scam/guarantee/solicitation/harassment(categories)/queue/appeal/audit) → Tasks 1, 6, 7, 8; no private messaging → confirmed absent, documented Task 12; encoding + one sanitised path + injection/embed prevention → Task 2 (+ repo scan found source clean; live-DB repair via Task 11 script); staff role → Tasks 3, 7 (is_admin moderators, labelled posts); tests → every task is TDD, all 15 named areas covered; docs → Task 12.
- **Known deliberate scope choices:** community settlement stays on `decisionOutcomeSettlement` (canonical identity is now *recorded* on every tip, so grader unification is a clean follow-up); harassment is handled via report category + moderator action rather than automated detection; engagement counts exclude demo accounts by stopping unlabelled generation + leaderboard exclusion (historical demo likes are surfaced by the audit script rather than destructively deleted).
- **Type consistency check:** `assessCommunityText`/`CONTENT_SAFETY_COPY` (T1) used in T8; `prepareCommunityText` (T2) used in T4 PATCH, T8, T11; `AccountBadge` (T3) used in T9, T10; `boundedCommunityText`, `communityTipStatus` (T4) used in T9; view columns (T6) match the T9 select string; `subjectHref`/`parseCommunitySubject` (T10) self-contained. `wilsonInterval` exists at `src/lib/performance/ledgerMetrics.ts:83`.
