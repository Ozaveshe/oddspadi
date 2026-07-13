import Link from "next/link";
export default function OfflinePage() { return <main id="main" className="container"><div className="empty-state"><h1>You&apos;re offline, padi</h1><p className="muted">Saved OddsPadi pages are still available. Reconnect for live scores and fresh match data.</p><Link className="button primary" href="/">Try home again</Link></div></main>; }
