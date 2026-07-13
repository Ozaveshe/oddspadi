"use client";

import Link from "next/link";
import { useFollowedTeams } from "./FollowedTeamsProvider";

export type TeamMatch = { id: string; href: string; home: string; away: string; kickoff: string; sport: string };

export function YourTeamsStrip({ matches }: { matches: TeamMatch[] }) {
  const followed = useFollowedTeams();
  if (followed.status === "loading") return null;
  if (followed.status === "signed-out") return <section className="your-teams-strip"><div><span className="section-kicker">Your teams</span><strong>Make matchday yours.</strong></div><Link className="button small-btn" href="/account">Sign in to follow teams</Link></section>;
  if (followed.status !== "ready") return null;
  const relevant = matches.filter((match) => followed.isFollowed(match.home) || followed.isFollowed(match.away)).slice(0, 6);
  return <section className="your-teams-strip"><div><span className="section-kicker">Your teams</span><strong>{relevant.length ? "Matches on your watchlist" : "No followed-team matches in this slate"}</strong></div><div className="your-team-matches">{relevant.map((match) => <Link href={match.href} key={match.id}><span>{match.sport}</span><strong>{match.home} vs {match.away}</strong></Link>)}</div><Link className="button small-btn" href="/account">Manage teams</Link></section>;
}
