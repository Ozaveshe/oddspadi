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
    for (const persona of [
      "kunle_lagos",
      "ama_kotoko",
      "tunde_united",
      "zainab_hoops",
      "chidi_naija",
      "mariam_casa",
      "sipho_amakhosi"
    ]) {
      expect(migration).toContain(persona);
    }
  });

  it("reserves staff-looking handles for non-organic accounts without breaking old rows", () => {
    expect(migration).toContain("op_profiles_reserved_handles");
    expect(migration).toMatch(/not valid/);
  });

  it("never grants account_type or integrity columns to authenticated", () => {
    expect(migration).not.toMatch(/grant (insert|update)[^;]*account_type/);
    expect(migration).not.toMatch(/grant (insert|update)[^;]*integrity_/);
  });

  it("adds canonical discussion subjects to feed posts and forum threads", () => {
    expect(migration).toContain(
      "'fixture','competition','team','player','publication','season_outlook','strategy','product_feedback'"
    );
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
    expect(renderToStaticMarkup(<AccountBadge accountType={undefined} />)).toBe("");
  });
});

describe("provenance is threaded through the read paths", () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

  it("author embeds select account_type", () => {
    expect(read("src/app/community/page.tsx")).toContain("account_type");
    expect(read("src/app/api/community/posts/route.ts")).toContain("account_type");
    expect(read("src/app/api/community/tips/route.ts")).toContain("account_type");
    expect(read("src/app/community/u/[handle]/page.tsx")).toContain("account_type");
  });

  it("feed, comments and tip cards render the badge", () => {
    expect(read("src/components/community/CommunityFeed.tsx")).toContain("AccountBadge");
    expect(read("src/components/community/PostComments.tsx")).toContain("AccountBadge");
    expect(read("src/components/community/MatchCommunityDesk.tsx")).toContain("AccountBadge");
    expect(read("src/app/community/u/[handle]/page.tsx")).toContain("AccountBadge");
  });
});
