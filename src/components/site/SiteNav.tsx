"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BallIcon, HistoryIcon, HomeIcon, LiveIcon, MoreIcon } from "./NavIcons";

const desktopItems = [
  { href: "/", label: "Home" },
  { href: "/predictions/today", label: "Tips", prefetch: false },
  { href: "/predictions", label: "Predictions", prefetch: false },
  { href: "/live-scores", label: "Live Scores", live: true, prefetch: false },
  { href: "/predictions/history", label: "Results" },
  { href: "/news", label: "News" },
  { href: "/predictions/decision-engine", label: "Engine", prefetch: false }
];

const tabItems = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/predictions/today", label: "Tips", Icon: BallIcon, prefetch: false },
  { href: "/live-scores", label: "Live", Icon: LiveIcon, prefetch: false },
  { href: "/predictions/history", label: "Results", Icon: HistoryIcon }
];

const moreSheetItems = [
  { href: "/predictions/week", label: "Weekly" },
  { href: "/predictions/value-picks", label: "Value Picks" },
  { href: "/predictions/league/premier-league/table", label: "Tables" },
  { href: "/forums", label: "Forums" },
  { href: "/news", label: "News" },
  { href: "/predictions/decision-engine", label: "Engine" },
  { href: "/predictions/bet-slip", label: "Slip Check" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/predictions/today") return pathname === "/tips" || pathname.startsWith("/predictions/today") || pathname.startsWith("/predictions/tomorrow");
  if (href === "/predictions") {
    return (
      pathname === "/predictions" ||
      (pathname.startsWith("/predictions/") &&
        !pathname.startsWith("/predictions/today") &&
        !pathname.startsWith("/predictions/tomorrow") &&
        !pathname.startsWith("/predictions/week") &&
        !pathname.startsWith("/predictions/value-picks") &&
        !pathname.startsWith("/predictions/history") &&
        !pathname.startsWith("/predictions/decision-engine"))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DesktopNavLinks() {
  const pathname = usePathname() ?? "/";

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
    </div>
  );
}

export function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreSheetRef = useRef<HTMLDivElement | null>(null);
  const moreActive = moreSheetItems.some((item) => isActive(pathname, item.href));

  // Close the sheet whenever navigation happens.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    moreSheetRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(moreSheetRef.current?.querySelectorAll<HTMLElement>("a, button") ?? []);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moreOpen]);

  return (
    <>
      {moreOpen ? <div className="tabbar-sheet-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" /> : null}
      {moreOpen ? (
        <div className="tabbar-sheet" id="mobile-more-menu" ref={moreSheetRef} role="dialog" aria-modal="true" aria-labelledby="mobile-more-title">
          <div className="tabbar-sheet-header"><strong id="mobile-more-title">More from OddsPadi</strong><button type="button" onClick={() => { setMoreOpen(false); moreButtonRef.current?.focus(); }} aria-label="Close more menu">Close</button></div>
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
          aria-controls="mobile-more-menu"
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
