"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BallIcon, HistoryIcon, HomeIcon, LiveIcon, StarIcon } from "./NavIcons";

const desktopItems = [
  { href: "/", label: "Home" },
  { href: "/live-scores", label: "Live Scores", live: true },
  { href: "/predictions", label: "Predictions" },
  { href: "/predictions/value-picks", label: "Value Picks" },
  { href: "/predictions/decision-engine", label: "AI Engine" },
  { href: "/predictions/history", label: "Results" }
];

const tabItems = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/live-scores", label: "Live", Icon: LiveIcon },
  { href: "/predictions", label: "Predictions", Icon: BallIcon },
  { href: "/predictions/value-picks", label: "Picks", Icon: StarIcon },
  { href: "/predictions/history", label: "Results", Icon: HistoryIcon }
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

export function DesktopNavLinks() {
  const pathname = usePathname() ?? "/";

  return (
    <div className="nav-links">
      {desktopItems.map((item) => (
        <Link href={item.href} key={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
          {item.label}
          {item.live ? <span className="nav-live-dot" aria-hidden="true" /> : null}
        </Link>
      ))}
    </div>
  );
}

export function MobileTabBar() {
  const pathname = usePathname() ?? "/";

  return (
    <nav className="tabbar" aria-label="Quick navigation">
      {tabItems.map(({ href, label, Icon }) => (
        <Link href={href} key={href} aria-current={isActive(pathname, href) ? "page" : undefined}>
          <Icon />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
