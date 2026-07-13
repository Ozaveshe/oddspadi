export default function CommunityLoading() {
  return (
    <main id="main" className="container" aria-busy="true" aria-live="polite">
      <div className="page-heading">
        <span className="section-kicker">Community</span>
        <h1>
          The <span className="accent">padi</span> feed
        </h1>
        <p>Loading the latest fan takes and matchday talk…</p>
      </div>
      <div className="feed-list" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="skeleton" key={index} style={{ height: 120 }} />
        ))}
      </div>
    </main>
  );
}
