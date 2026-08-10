import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static accessibility contract for the matchday interactions that matter most.
 *
 * This is a source-level gate, not a browser axe run (CI has no browser — the
 * real-DOM axe pass is a documented follow-up in docs/seo-and-accessibility.md).
 * It pins the properties a regression would most easily break: live-score
 * announcement, reduced-motion, accessible names, status/alert roles, and
 * touch-target sizing. It complements live-board-accessibility.test.ts.
 */
const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("live-score announcements", () => {
  it("routes score changes through one polite, atomic, sr-only announcer", () => {
    const announcer = read("src/components/live/ScoreAnnouncer.tsx");
    expect(announcer).toContain('aria-live="polite"');
    expect(announcer).toContain('aria-atomic="true"');
    expect(announcer).toContain('className="sr-only"');
    expect(announcer).toContain('role="status"');
  });
});

describe("reduced motion", () => {
  it("honours prefers-reduced-motion by neutralising animation and transition", () => {
    const css = read("src/app/globals.css");
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/scroll-behavior:\s*auto/);
  });
});

describe("touch targets", () => {
  it("primary controls meet the 44px minimum touch target", () => {
    const css = read("src/app/globals.css");
    const buttonBlock = css.slice(css.indexOf(".button {"), css.indexOf(".button {") + 400);
    const minHeight = /min-height:\s*(\d+)px/.exec(buttonBlock);
    expect(minHeight).not.toBeNull();
    expect(Number(minHeight![1])).toBeGreaterThanOrEqual(44);
    expect(css).toContain("touch-action: manipulation");
  });
});

describe("loading and error states carry a role", () => {
  it("the empty state announces via a live region and the moderation queue errors via alert", () => {
    expect(read("src/components/odds/EmptyState.tsx")).toContain('aria-live="polite"');
    expect(read("src/components/community/ModerationQueue.tsx")).toMatch(/role="alert"|role="status"/);
  });
});

describe("interactive controls have accessible names", () => {
  it("the icon-only feed buttons (like, comment) carry an aria-label", () => {
    // An emoji-only control ("♥ 5") reads as "black heart 5" to a screen
    // reader — an accessible name makes the action explicit. These are the
    // highest-traffic icon-only controls in the community feed.
    const source = read("src/components/community/CommunityFeed.tsx");
    // Match each <button>…</button> whose visible content leads with an emoji,
    // tolerating arrow functions in the tag by matching to the closing tag.
    const iconButtons = [...source.matchAll(/<button\b[\s\S]*?>[\s]*[☀-➿\uD83C-\uDBFF][\s\S]*?<\/button>/g)].map((m) => m[0]);
    expect(iconButtons.length).toBeGreaterThanOrEqual(2);
    for (const button of iconButtons) {
      expect(button, `an icon-only button lacks aria-label: ${button.slice(0, 60)}`).toMatch(/aria-label=/);
    }
  });
});
