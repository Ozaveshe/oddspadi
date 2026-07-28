import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { absoluteUrl, pageMetadata, siteUrl } from "@/lib/seo/pageMetadata";

const APP_ROOT = "src/app";
const IGNORED_DIRECTORIES = new Set(["_archived", "api"]);

async function collectPages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return IGNORED_DIRECTORIES.has(entry.name) ? [] : collectPages(path);
      return entry.name === "page.tsx" ? [path] : [];
    })
  );
  return files.flat();
}

describe("pageMetadata", () => {
  it("builds a self-referencing canonical and a matching og:url", () => {
    const metadata = pageMetadata({
      title: "Weekly predictions",
      description: "Seven days of fixtures.",
      path: "/predictions/week"
    });

    expect(metadata.alternates?.canonical).toBe(`${siteUrl}/predictions/week`);
    expect(metadata.openGraph?.url).toBe(`${siteUrl}/predictions/week`);
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("strips query strings, fragments and trailing slashes from canonicals", () => {
    expect(absoluteUrl("/predictions?sport=football")).toBe(`${siteUrl}/predictions`);
    expect(absoluteUrl("/predictions/week#top")).toBe(`${siteUrl}/predictions/week`);
    expect(absoluteUrl("/predictions/")).toBe(`${siteUrl}/predictions`);
    expect(absoluteUrl("/")).toBe(`${siteUrl}/`);
  });

  it("keeps an absolute URL untouched", () => {
    expect(absoluteUrl("https://example.test/x")).toBe("https://example.test/x");
  });
});

describe("route metadata", () => {
  it("gives every page a title and a canonical or an explicit noindex", async () => {
    const pages = await collectPages(APP_ROOT);
    expect(pages.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const page of pages) {
      const source = await readFile(page, "utf8");
      const declaresMetadata = /export (?:const metadata|async function generateMetadata)/.test(source);
      if (!declaresMetadata) {
        offenders.push(`${page}: no metadata export`);
        continue;
      }
      const hasCanonical = source.includes("canonical") || source.includes("pageMetadata(");
      const hasNoIndex = /robots:\s*\{\s*index:\s*false/.test(source);
      if (!hasCanonical && !hasNoIndex) offenders.push(`${page}: no canonical and not noindex`);
    }

    expect(offenders).toEqual([]);
  });

  it("gives every page that declares openGraph a self-referencing url", async () => {
    // A page that declares its own `openGraph` replaces the layout's block
    // wholesale, so omitting `url` there means the page emits no `og:url` at
    // all — crawlers and share cards fall back to the request URL, query string
    // and tracking parameters included.
    const pages = await collectPages(APP_ROOT);
    const offenders: string[] = [];

    for (const page of pages) {
      const source = await readFile(page, "utf8");
      if (!source.includes("openGraph")) continue;
      if (source.includes("pageMetadata(")) continue;
      const block = source.match(/openGraph:\s*\{[\s\S]{0,600}?\}/)?.[0] ?? "";
      if (!/\burl:/.test(block)) offenders.push(page);
    }

    expect(offenders).toEqual([]);
  });

  it("never lets a page inherit the root og:url and claim to be the homepage", async () => {
    // Next merges metadata shallowly: a page without its own `openGraph` takes
    // the layout's whole block. The layout must therefore not declare a `url`.
    const layout = await readFile("src/app/layout.tsx", "utf8");
    const openGraphBlock = layout.match(/openGraph:\s*\{[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(openGraphBlock).not.toBe("");
    expect(openGraphBlock).not.toMatch(/\burl:/);
  });
});

describe("origin configuration", () => {
  /**
   * Structured data, canonicals and feed URLs must all derive from one
   * configured origin. Hardcoded or locally re-derived copies meant preview and
   * staging deploys published URLs pointing at production, and a local copy
   * that skipped the trailing-slash strip produced `//path` in every URL built
   * from it.
   */
  it("derives every site URL from the shared constant", async () => {
    const roots = ["src/app", "src/lib", "src/components"];
    const offenders: string[] = [];

    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "_archived") await walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
        if (path.endsWith("lib/seo/pageMetadata.ts")) continue;
        const source = await readFile(path, "utf8");
        for (const [index, line] of source.split("\n").entries()) {
          // Deployment *documentation* may name the expected production domain;
          // building a URL from it is what this guards against.
          if (/https:\/\/oddspadi\.com/.test(line) && /`|url:|item:|href=|origin =/.test(line)) {
            offenders.push(`${path}:${index + 1}`);
          }
          if (/NEXT_PUBLIC_SITE_URL\s*\?\?/.test(line)) offenders.push(`${path}:${index + 1}`);
        }
      }
    }

    await Promise.all(roots.map(walk));
    expect(offenders).toEqual([]);
  });
});
