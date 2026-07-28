import type { Metadata } from "next";

export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://oddspadi.com").replace(/\/+$/, "");

/**
 * Resolves a site-relative path to an absolute URL.
 *
 * Query strings and fragments are dropped: they never belong in a canonical or
 * `og:url`, and several callers derive their path from a filtered route.
 */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const [pathname] = path.split(/[?#]/, 1);
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${siteUrl}${normalized === "/" ? "/" : normalized.replace(/\/+$/, "")}`;
}

type PageMetadataInput = {
  /** `<title>`; the root layout appends the " | OddsPadi" suffix. */
  title: string;
  description: string;
  /** Site-relative path. Drives both the canonical link and `og:url`. */
  path: string;
  /** Social title/description, when the on-page one reads badly as a share card. */
  socialTitle?: string;
  socialDescription?: string;
  type?: "website" | "article" | "profile";
  /** Absolute or site-relative image URL. Defaults to the route's own OG image. */
  image?: string;
  /** Excludes the page from search indexes while still following its links. */
  noIndex?: boolean;
  keywords?: string[];
  publishedTime?: string;
  modifiedTime?: string;
};

/**
 * Builds a page's metadata with a self-referencing canonical and a matching
 * `og:url`.
 *
 * Next merges metadata shallowly, so a page that omits `openGraph` inherits the
 * root layout's wholesale — including its `url`. Before this helper existed
 * eleven routes therefore advertised `og:url` as the homepage, telling every
 * social and search crawler that the shared page *was* `/`. Routing every page
 * through here keeps the canonical, `og:url` and Twitter card in agreement.
 */
export function pageMetadata({
  title,
  description,
  path,
  socialTitle,
  socialDescription,
  type = "website",
  image,
  noIndex = false,
  keywords,
  publishedTime,
  modifiedTime
}: PageMetadataInput): Metadata {
  const canonical = absoluteUrl(path);
  const shareTitle = socialTitle ?? title;
  const shareDescription = socialDescription ?? description;

  return {
    title,
    description,
    ...(keywords?.length ? { keywords } : {}),
    alternates: { canonical },
    openGraph: {
      type,
      url: canonical,
      siteName: "OddsPadi",
      locale: "en_NG",
      title: shareTitle,
      description: shareDescription,
      ...(image ? { images: [{ url: absoluteUrl(image) }] } : {}),
      ...(type === "article" && publishedTime ? { publishedTime } : {}),
      ...(type === "article" && modifiedTime ? { modifiedTime } : {})
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: shareDescription,
      ...(image ? { images: [absoluteUrl(image)] } : {})
    },
    ...(noIndex ? { robots: { index: false, follow: true } } : {})
  };
}
