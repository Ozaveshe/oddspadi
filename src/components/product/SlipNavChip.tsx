"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BET_SLIP_CHANGED_EVENT, readSlip } from "@/lib/sports/betSlip";

/**
 * Compact Bet Workspace entry point in the primary nav. Shows only once the
 * slip has legs — an empty chip would just be noise next to four tabs.
 */
export function SlipNavChip() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(readSlip().length);
    sync();
    window.addEventListener(BET_SLIP_CHANGED_EVENT, sync);
    return () => window.removeEventListener(BET_SLIP_CHANGED_EVENT, sync);
  }, []);

  if (!count) return null;
  return (
    <Link className="slip-nav-chip" href="/predictions/bet-slip" aria-label={`Bet workspace, ${count} selection${count === 1 ? "" : "s"}`}>
      Slip <span aria-hidden="true">{count}</span>
    </Link>
  );
}
