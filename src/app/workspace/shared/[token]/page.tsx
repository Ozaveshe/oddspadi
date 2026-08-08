import type { Metadata } from "next";
import { LocalTime } from "@/components/odds/LocalTime";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { shareSecret, verifyShareToken } from "@/lib/workspaceSync/shareToken";
import { analyseWorkspace } from "@/lib/workspace/analysis";
import type { CanonicalSelection } from "@/lib/workspace/selection";
import type { SharedWorkspacePayload } from "@/lib/workspaceSync/sanitize";

/**
 * Read-only shared workspace view.
 *
 * Reached only through a signed, expiring link. Never indexed, never cached,
 * and containing nothing about who shared it. Expired and revoked links get
 * the same plain explanation rather than an error page.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared workspace — OddsPadi",
  robots: { index: false, follow: false }
};

const percent = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;

function unavailable(message: string) {
  return (
    <main className="container section">
      <div className="empty-state">
        <h1>Shared workspace</h1>
        <p className="muted">{message}</p>
      </div>
    </main>
  );
}

export default async function SharedWorkspacePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const secret = shareSecret();
  const service = getSupabaseServerClient();
  if (!secret || !service) return unavailable("Sharing is not available on this deployment.");

  const verdict = verifyShareToken(token, secret, Date.now());
  if (!verdict.ok) {
    return unavailable(
      verdict.reason === "expired" ? "This share link has expired." : "This share link could not be verified."
    );
  }

  const { data } = await service
    .from("op_workspace_shares")
    .select("payload,expires_at,revoked_at")
    .eq("share_id", verdict.shareId)
    .maybeSingle();
  if (!data) return unavailable("This share no longer exists.");
  if (data.revoked_at) return unavailable("This share link has been revoked.");
  if (Date.parse(String(data.expires_at)) <= Date.now()) return unavailable("This share link has expired.");

  const shared = data.payload as SharedWorkspacePayload;
  const selections = (shared.selections ?? []) as unknown as CanonicalSelection[];
  const analysis = shared.snapshot ? shared.snapshot.analysis : analyseWorkspace(selections, Date.parse(shared.sharedAt));

  return (
    <main className="container section">
      <header className="section">
        <p className="section-kicker">Shared analysis · read-only</p>
        <h1>{shared.name || "Shared workspace"}</h1>
        <p className="muted small">
          Shared <LocalTime iso={shared.sharedAt} variant="datetime" />. This is a frozen copy of someone&apos;s own
          analysis — not OddsPadi picks, and not part of the official track record.
        </p>
      </header>

      <section className="slip-summary panel">
        <div><span className="metric-label">Combined odds</span><strong>{analysis.combinedBookmakerOdds?.toFixed(2) ?? "—"}</strong></div>
        <div><span className="metric-label">Priced chance</span><strong>{percent(analysis.naiveImpliedProbability)}</strong></div>
        <div><span className="metric-label">Market chance (no-vig)</span><strong>{percent(analysis.deViggedMarketProbability)}</strong></div>
        <div>
          <span className="metric-label">Model chance</span>
          <strong>
            {analysis.combinedModelProbability === null
              ? "Not available"
              : analysis.combinedModelRange
                ? `${percent(analysis.combinedModelRange.low)}–${percent(analysis.combinedModelRange.high)}`
                : percent(analysis.combinedModelProbability)}
          </strong>
        </div>
        <div><span className="metric-label">Evidence</span><strong style={{ textTransform: "capitalize" }}>{analysis.evidenceQuality}</strong></div>
      </section>

      <p className="slip-verdict">{analysis.combinationExplanation}</p>

      <div className="slip-legs">
        {analysis.legs.map((leg) => (
          <article className="panel slip-leg" key={leg.selection.legId}>
            <div>
              <span className="small muted">{leg.selection.competition}</span>
              <h2>{leg.selection.fixtureLabel}</h2>
              <p>
                <strong>{leg.selection.label}</strong> · {leg.selection.userOdds.toFixed(2)} ·{" "}
                {percent(leg.impliedProbability)} priced · {percent(leg.selection.modelProbability)} model
              </p>
              <p className="muted small">{leg.note}</p>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
