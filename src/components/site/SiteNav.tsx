"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountIcon, BallIcon, CommunityIcon, HistoryIcon, HomeIcon, LiveIcon } from "./NavIcons";

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
  { href: "/forums", label: "Forums", prefetch: false },
  { href: "/account", label: "Sign in / Account", prefetch: false }
];

const tabItems = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/live-scores", label: "Live", Icon: LiveIcon, prefetch: false },
  { href: "/predictions", label: "Predictions", Icon: BallIcon, prefetch: false },
  { href: "/community", label: "Community", Icon: CommunityIcon, prefetch: false },
  { href: "/predictions/history", label: "Results", Icon: HistoryIcon },
  { href: "/account", label: "Account", Icon: AccountIcon, prefetch: false }
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

  return (
    <nav className="tabbar" aria-label="Quick navigation">
      {tabItems.map(({ href, label, Icon, prefetch }) => (
        <Link href={href} key={href} prefetch={prefetch} aria-current={isActive(pathname, href) ? "page" : undefined}>
          <Icon />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
