import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { BrandWord, LogoMark } from "@/components/site/Logo";
import { SiteFooter } from "@/components/site/SiteFooter";
import { DesktopNavLinks, MobileTabBar } from "@/components/site/SiteNav";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oddspadi.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "OddsPadi — Football Predictions, Live Scores & AI Analysis",
    template: "%s | OddsPadi"
  },
  description:
    "OddsPadi is your football padi: AI-powered football predictions, live scores, value picks, and honest match analysis for fans across Africa and beyond. No fake 'sure odds' — just clear numbers.",
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
    canonical: "/"
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "OddsPadi",
    locale: "en_NG",
    title: "OddsPadi — Football Predictions, Live Scores & AI Analysis",
    description:
      "AI-powered football predictions, real-time live scores, and honest value analysis. Your football padi for smarter matchday decisions."
  },
  twitter: {
    card: "summary_large_image",
    title: "OddsPadi — Football Predictions, Live Scores & AI Analysis",
    description:
      "AI-powered football predictions, real-time live scores, and honest value analysis. Your football padi for smarter matchday decisions."
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
  }
};

export const viewport: Viewport = {
  themeColor: "#0a0e0c",
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
    "AI-powered football predictions, live scores, and value analysis for fans across Africa and beyond.",
  sameAs: []
};

const webSiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "OddsPadi",
  alternateName: "Odds Padi",
  url: siteUrl
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/manrope-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/bricolage-grotesque-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteJsonLd) }} />
      </head>
      <body>
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
      </body>
    </html>
  );
}
