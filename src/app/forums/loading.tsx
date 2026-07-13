export default function ForumsLoading() {
  return (
    <main id="main" className="container" aria-busy="true" aria-live="polite">
      <div className="page-heading">
        <span className="section-kicker">Forums</span>
        <h1>
          Fan <span className="accent">forums</span>
        </h1>
        <p>Loading categories and the latest threads…</p>
      </div>
      <div className="match-list" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton" key={index} style={{ height: 96 }} />
        ))}
      </div>
    </main>
  );
}
