import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Analytics } from "@/components/analytics/Analytics";
import { BrandWord, LogoMark } from "@/components/site/Logo";
import { TimezonePicker } from "@/components/odds/TimezonePicker";
import { SiteFooter } from "@/components/site/SiteFooter";
import { DesktopNavLinks, MobileTabBar } from "@/components/site/SiteNav";
import "./globals.css";
import { FollowedTeamsProvider } from "@/components/account/FollowedTeamsProvider";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { serializeJsonLd } from "@/lib/security/jsonLd";

import { siteUrl } from "@/lib/seo/pageMetadata";

const googleSiteVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "OddsPadi — Live Scores, Sports Predictions & Matchday News",
    template: "%s | OddsPadi"
  },
  description:
    "Live scores, football, basketball and tennis predictions, transparent results, and matchday news for sports fans across Africa and beyond.",
  applicationName: "OddsPadi",
  keywords: [
    "football predictions",
    "football predictions today",
    "live scores",
    "livescores today",
    "AI football predictions",
    "value bets",
    "football tips Nigeria",
    "soccer predictions Africa",
    "odds analysis",
    "EPL predictions",
    "match previews"
  ],
  authors: [{ name: "OddsPadi" }],
  creator: "OddsPadi",
  publisher: "OddsPadi",
  category: "sports",
  // No `url` here: Next merges metadata shallowly, so every page that does not
  // declare its own `openGraph` inherits this block verbatim. With a `url` set,
  // eleven routes told crawlers their `og:url` was the homepage. Pages now build
  // their own self-referencing card via `pageMetadata()`.
  openGraph: {
    type: "website",
    siteName: "OddsPadi",
    locale: "en_NG",
    title: "OddsPadi — Football Predictions, Live Scores & Model Analysis",
    description:
      "Model-led football predictions, real-time live scores, and honest value analysis. Your football padi for smarter matchday decisions."
  },
  twitter: {
    card: "summary_large_image",
    title: "OddsPadi — Football Predictions, Live Scores & Model Analysis",
    description:
      "Model-led football predictions, real-time live scores, and honest value analysis. Your football padi for smarter matchday decisions."
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1
    }
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
    apple: "/apple-icon"
  },
  ...(googleSiteVerification ? { verification: { google: googleSiteVerification } } : {})
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

const ORGANIZATION_ID = `${siteUrl}/#organization`;
const WEBSITE_ID = `${siteUrl}/#website`;

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  // A stable @id lets the WebSite node point at this Organization instead of
  // repeating it, so crawlers resolve one entity rather than two unlinked ones.
  "@id": ORGANIZATION_ID,
  name: "OddsPadi",
  url: siteUrl,
  // A raster logo is what the knowledge-panel and article rich results accept;
  // the SVG mark alone left the logo property effectively unusable.
  logo: {
    "@type": "ImageObject",
    url: `${siteUrl}/brand/oddspadi-icon-512-maskable.png`,
    width: 512,
    height: 512
  },
  description:
    "Model-led football predictions, live scores, and value analysis for fans across Africa and beyond."
  // `sameAs` is omitted rather than shipped empty: an empty array is not a
  // signal, it is just noise in the graph.
};

const webSiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  name: "OddsPadi",
  alternateName: "Odds Padi",
  url: siteUrl,
  inLanguage: "en",
  publisher: { "@id": ORGANIZATION_ID },
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${siteUrl}/predictions?q={search_term_string}`
    },
    "query-input": "required name=search_term_string"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        {/* Preload the primary UI + display fonts to cut first-paint FOUT / LCP. */}
        <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link
          rel="preload"
          href="/fonts/bricolage-grotesque-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/*
          Feed autodiscovery lives here rather than in `metadata.alternates`:
          Next replaces an inherited `alternates` block wholesale, and every page
          declares its own canonical, so the layout's feed links never reached a
          single rendered page.
        */}
        <link rel="alternate" type="application/rss+xml" title="OddsPadi Matchday Desk" href="/news/rss.xml" />
        <link rel="alternate" type="application/feed+json" title="OddsPadi Matchday Desk" href="/news/feed.json" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(organizationJsonLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(webSiteJsonLd) }} />
      </head>
      <body>
        <FollowedTeamsProvider>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="site-shell">
          <header className="site-header">
            <nav className="nav" aria-label="Primary navigation">
              <Link className="brand" href="/" aria-label="OddsPadi home">
                <LogoMark size={36} />
                <BrandWord />
              </Link>
              <DesktopNavLinks />
              <TimezonePicker />
            </nav>
          </header>
          {children}
          <SiteFooter />
        </div>
        <MobileTabBar />
        <Analytics />
        <ServiceWorkerRegistration />
        </FollowedTeamsProvider>
      </body>
    </html>
  );
}
