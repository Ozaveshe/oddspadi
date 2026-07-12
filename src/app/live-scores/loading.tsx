export default function LiveScoresLoading() {
  return (
    <main id="main" className="container" aria-busy="true" aria-live="polite">
      <div className="page-heading">
        <h1>
          Loading <span className="accent">live scores</span>
        </h1>
        <p>Connecting to today&apos;s match feed. Scores will appear here as soon as the first update lands.</p>
      </div>
      <div className="panel" aria-hidden="true">
        <div className="skeleton" style={{ height: 48, borderRadius: 0 }} />
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton" key={index} style={{ height: 62, marginTop: 8, borderRadius: 0 }} />
        ))}
      </div>
    </main>
  );
}
