"use client";

import { useState } from "react";

function initialsOf(name: string): string {
  const letters = name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  return letters || "?";
}

/** Team/league crest that renders the provider logo and falls back to initials
 *  when there's no logo or the image fails to load. */
export function TeamCrest({ name, logo, size = 22 }: { name: string; logo?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const dimensions = { width: size, height: size } as const;

  if (logo && !failed) {
    return (
      <img
        className="team-crest"
        src={logo}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={dimensions}
      />
    );
  }

  return (
    <span
      className="team-crest team-crest--fallback"
      style={{ ...dimensions, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
