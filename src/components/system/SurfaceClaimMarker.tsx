import { claimAttributes, countAttributes, type CountClaim, type SurfaceClaim } from "@/lib/domain/surfaceClaim";

/**
 * A surface's statement of what it believes, in the HTML it renders.
 *
 * Ten pages read the same fixture through nine modules. Their agreement was
 * previously unobservable — you could only find a contradiction by loading two
 * pages and reading them, which is how "kick-off in 2 hours" survived on Today
 * while the match page said full time.
 *
 * The marker is `hidden`, so it costs nothing visually and is skipped by
 * assistive technology. What it buys is that truth becomes checkable: the
 * contract test parses these out of rendered output, and the production
 * reconciliation job can fetch a live page and do the same. A surface that
 * renders a fixture without a marker is invisible to both, so the test also
 * asserts the marker is present.
 *
 * This is deliberately not a debug affordance. It carries no internals — no
 * model version, no run ID, no query — only the states already visible to any
 * reader of the page.
 */
export function SurfaceClaimMarker({ claim }: { claim: SurfaceClaim }) {
  return <div hidden {...claimAttributes(claim)} />;
}

/** The same, for a surface asserting "there are N of these". */
export function SurfaceCountMarker({ claim }: { claim: CountClaim }) {
  return <div hidden {...countAttributes(claim)} />;
}
