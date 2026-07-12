export default function MatchDetailLoading() {
  return (
    <main id="main" className="container" aria-busy="true" aria-live="polite">
      <div className="page-heading">
        <h1>
          Loading <span className="accent">match analysis</span>
        </h1>
        <p>Pulling the odds, probabilities and the full engine breakdown for this fixture.</p>
      </div>
      <section className="detail-grid">
        <div className="match-list" aria-hidden="true">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="skeleton" key={index} style={{ height: 190 }} />
          ))}
        </div>
        <aside className="match-list" aria-hidden="true">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="skeleton" key={index} style={{ height: 150 }} />
          ))}
        </aside>
      </section>
    </main>
  );
}
