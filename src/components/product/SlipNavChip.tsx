"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WORKSPACE_CHANGED_EVENT } from "@/lib/workspace/store";
import { countActiveLegs, readWorkspacesWithMigration } from "@/lib/workspace/clientState";
import { BET_SLIP_CHANGED_EVENT } from "@/lib/sports/betSlip";

/**
 * Compact Bet Workspace entry point in the primary nav. Shows only once a
 * workspace has legs — an empty chip would just be noise next to four tabs.
 */
export function SlipNavChip() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(countActiveLegs(readWorkspacesWithMigration(new Date().toISOString())));
    sync();
    window.addEventListener(WORKSPACE_CHANGED_EVENT, sync);
    // The legacy slip event still fires from older surfaces until they all
    // migrate; listening to both keeps the chip truthful either way.
    window.addEventListener(BET_SLIP_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, sync);
      window.removeEventListener(BET_SLIP_CHANGED_EVENT, sync);
    };
  }, []);

  if (!count) return null;
  return (
    <Link className="slip-nav-chip" href="/predictions/bet-slip" aria-label={`Bet workspace, ${count} selection${count === 1 ? "" : "s"}`}>
      Slip <span aria-hidden="true">{count}</span>
    </Link>
  );
}
