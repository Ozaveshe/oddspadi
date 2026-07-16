import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Analytics } from "@/components/analytics/Analytics";
import { BrandWord, LogoMark } from "@/components/site/Logo";
import { SiteFooter } from "@/components/site/SiteFooter";
import { DesktopNavLinks, MobileTabBar } from "@/components/site/SiteNav";
import "./globals.css";
import "./product-shell.css";
import { FollowedTeamsProvider } from "@/components/account/FollowedTeamsProvider";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { serializeJsonLd } from "@/lib/security/jsonLd";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oddspadi.com";
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
  alternates: {
    types: {
      "application/rss+xml": [{ url: "/news/rss.xml", title: "OddsPadi Matchday Desk" }],
      "application/feed+json": [{ url: "/news/feed.json", title: "OddsPadi Matchday Desk" }]
    }
  },
  openGraph: {
    type: "website",
    url: siteUrl,
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
  themeColor: "#07170f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "OddsPadi",
  url: siteUrl,
  logo: `${siteUrl}/brand/oddspadi-mark.svg`,
  description:
    "Model-led football predictions, live scores, and value analysis for fans across Africa and beyond.",
  sameAs: []
};

const webSiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "OddsPadi",
  alternateName: "Odds Padi",
  url: siteUrl,
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
