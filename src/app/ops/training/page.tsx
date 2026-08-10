import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { isStaffViewer } from "@/lib/ops/pageGate";
import { isTrainingMode } from "@/lib/ops/trainingMode";
import { TrainingSandbox } from "@/components/ops/TrainingSandbox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Operations training",
  description: "Synthetic training scenarios for new OddsPadi operations and community staff.",
  path: "/ops/training",
  noIndex: true
});

export default async function OpsTrainingPage() {
  const staff = await isStaffViewer();
  if (!staff) {
    return (
      <main id="main" className="container">
        <div className="page-heading">
          <span className="section-kicker">Operations</span>
          <h1>Training</h1>
        </div>
        <div className="notice">Staff access required.</div>
      </main>
    );
  }

  const training = isTrainingMode(process.env);

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Operations</span>
        <h1>Training sandbox</h1>
        <p>
          Practise the judgement calls — resolve a stale fixture, map a market, settle an edge case, approve content,
          moderate a report — on synthetic data that never touches production.
        </p>
      </div>

      {training ? (
        <p className="notice" role="status">
          Training mode is on for this environment, so real workspace actions also preview without writing.
        </p>
      ) : (
        <p className="muted">
          Tip: set ODDSPADI_OPS_TRAINING to run the real workspace in preview-only mode too. The sandbox below is
          synthetic and safe regardless.
        </p>
      )}

      <TrainingSandbox />
    </main>
  );
}
