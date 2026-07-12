export default function PredictionsLoading() {
  return (
    <main id="main" className="container" aria-busy="true" aria-live="polite">
      <div className="page-heading">
        <h1>
          Loading <span className="accent">match analysis</span>
        </h1>
        <p>Getting the latest fixtures and market context. The page will stay usable while the live data arrives.</p>
      </div>
      <div className="match-list" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton" key={index} style={{ height: 210 }} />
        ))}
      </div>
    </main>
  );
}
