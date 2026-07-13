"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AccountIcon, BallIcon, CommunityIcon, HistoryIcon, HomeIcon, LiveIcon, MoreIcon } from "./NavIcons";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";

const desktopItems = [
  { href: "/", label: "Home" },
  { href: "/live-scores", label: "Live Scores", live: true, prefetch: false },
  { href: "/predictions", label: "Predictions", prefetch: false },
  { href: "/predictions/value-picks", label: "Value Picks", prefetch: false },
  { href: "/predictions/decision-engine", label: "AI Engine", prefetch: false },
  { href: "/community", label: "Community", prefetch: false },
  { href: "/predictions/history", label: "Results" },
  { href: "/season-outlooks", label: "Seasons" },
  { href: "/news", label: "News" },
  { href: "/forums", label: "Forums", prefetch: false }
];

const tabItems = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/live-scores", label: "Live", Icon: LiveIcon, prefetch: false },
  { href: "/predictions", label: "Predictions", Icon: BallIcon, prefetch: false },
  { href: "/community", label: "Community", Icon: CommunityIcon, prefetch: false },
  { href: "/predictions/history", label: "Results", Icon: HistoryIcon }
];

const moreSheetItems = [
  { href: "/predictions/value-picks", label: "Value Picks" },
  { href: "/predictions/decision-engine", label: "AI Engine" },
  { href: "/predictions/bet-slip", label: "Slip Check" },
  { href: "/season-outlooks", label: "Seasons" },
  { href: "/news", label: "News" },
  { href: "/forums", label: "Forums" },
  { href: "/account", label: "Account" },
  { href: "/about", label: "About OddsPadi" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/predictions") {
    return (
      pathname === "/predictions" ||
      (pathname.startsWith("/predictions/") &&
        !pathname.startsWith("/predictions/value-picks") &&
        !pathname.startsWith("/predictions/history") &&
        !pathname.startsWith("/predictions/decision-engine"))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True once we know a Supabase session exists; null while unknown (first paint
 *  stays deterministic for SSR). */
function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setSignedIn(false);
      return;
    }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSignedIn(Boolean(data.session));
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setSignedIn(Boolean(session));
    });
    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, []);
  return signedIn;
}

export function DesktopNavLinks() {
  const pathname = usePathname() ?? "/";
  const signedIn = useSignedIn();

  return (
    <div className="nav-links">
      {desktopItems.map((item) => (
        <Link
          href={item.href}
          key={item.href}
          prefetch={item.prefetch}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
        >
          {item.label}
          {item.live ? <span className="nav-live-dot" aria-hidden="true" /> : null}
        </Link>
      ))}
      <Link href="/account" prefetch={false} aria-current={isActive(pathname, "/account") ? "page" : undefined}>
        {signedIn ? "My account" : "Sign in"}
      </Link>
    </div>
  );
}

export function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreActive = moreSheetItems.some((item) => isActive(pathname, item.href));

  // Close the sheet whenever navigation happens.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moreOpen]);

  return (
    <>
      {moreOpen ? <div className="tabbar-sheet-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" /> : null}
      {moreOpen ? (
        <div className="tabbar-sheet" role="region" aria-label="More pages">
          {moreSheetItems.map((item) => (
            <Link
              href={item.href}
              key={item.href}
              prefetch={false}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
      <nav className="tabbar" aria-label="Quick navigation">
        {tabItems.map(({ href, label, Icon, prefetch }) => (
          <Link href={href} key={href} prefetch={prefetch} aria-current={isActive(pathname, href) ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
        <button
          className="tabbar-more"
          type="button"
          ref={moreButtonRef}
          aria-expanded={moreOpen}
          aria-current={!moreOpen && moreActive ? "true" : undefined}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <MoreIcon />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
