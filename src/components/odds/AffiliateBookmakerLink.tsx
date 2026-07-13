import React from "react";
import { affiliateBookmakerLink, bookmakerDisplayName } from "@/lib/affiliate/bookmakerLinks";

export function AffiliateBookmakerLink({ bookmaker, country, matchId, sport, league, placement }: {
  bookmaker: { id: string; name: string };
  country: string;
  matchId: string;
  sport: string;
  league: string;
  placement: "odds_table" | "value_pick_card";
}) {
  const href = affiliateBookmakerLink(bookmaker.id, country);
  if (!href) return null;
  const name = bookmakerDisplayName(bookmaker.id, bookmaker.name);

  return (
    <div className="affiliate-link-block">
      <a
        className="button small-btn"
        href={href}
        target="_blank"
        rel="sponsored noopener"
        data-analytics-event="affiliate_outbound_clicked"
        data-analytics-bookmaker-id={bookmaker.id}
        data-analytics-bookmaker={name}
        data-analytics-destination-host={new URL(href).hostname}
        data-analytics-country={country}
        data-analytics-match-id={matchId}
        data-analytics-sport={sport}
        data-analytics-league={league}
        data-analytics-placement={placement}
      >
        View at {name}
      </a>
      <span className="small muted">18+ only. Play responsibly; OddsPadi provides analysis, not a promise of returns.</span>
    </div>
  );
}
