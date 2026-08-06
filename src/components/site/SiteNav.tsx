"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AccountIcon, CompassIcon, HistoryIcon, HomeIcon, MoreIcon } from "./NavIcons";
import { isSurfaceActive } from "@/lib/navigation/surfaces";

/**
 * Four surfaces, not eighteen destinations. Everything else stays reachable —
 * through the hubs (Explore/Track Record/My Padi) and the mobile More sheet —
 * but the top level answers the four questions a visitor actually has:
 * what's on today, where do I find a fixture, how honest is the model,
 * and what's mine. See docs/product-architecture.md and docs/route-map.md.
 */
const desktopItems = [
  { href: "/", label: "Today" },
  { href: "/explore", label: "Explore", prefetch: false },
  { href: "/track-record", label: "Track Record", prefetch: false },
  { href: "/my", label: "My Padi", prefetch: false }
];

const tabItems = [
  { href: "/", label: "Today", Icon: HomeIcon },
  { href: "/explore", label: "Explore", Icon: CompassIcon, prefetch: false },
  { href: "/track-record", label: "Record", Icon: HistoryIcon, prefetch: false },
  { href: "/my", label: "My Padi", Icon: AccountIcon, prefetch: false }
];

/** Deep links stay one tap away on mobile; the hubs carry them on desktop. */
const moreSheetItems = [
  { href: "/live-scores", label: "Live Scores" },
  { href: "/predictions/today", label: "Today's Tips" },
  { href: "/predictions", label: "All Predictions" },
  { href: "/predictions/week", label: "Weekly Radar" },
  { href: "/predictions/league/premier-league/table", label: "League Tables" },
  { href: "/news", label: "News" },
  { href: "/forums", label: "Forums" },
  { href: "/predictions/decision-engine", label: "Engine Status" },
  { href: "/predictions/bet-slip", label: "Bet Workspace" }
];

/**
 * Surface ownership and active-state resolution now live in
 * `@/lib/navigation/surfaces`, shared with analytics so the nav cannot
 * highlight one surface while a view reports another.
 */
const isActive = isSurfaceActive;

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
          // Only reference the sheet while it is in the DOM: a dangling
          // `aria-controls` IDREF is invalid and some screen readers announce
          // the relationship as broken rather than ignoring it.
          aria-controls={moreOpen ? "mobile-more-menu" : undefined}
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
