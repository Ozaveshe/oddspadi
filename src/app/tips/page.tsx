import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

// `/tips` is a legacy alias, not a temporary detour. `redirect()` emits a 307,
// which tells crawlers the original URL is still canonical and keeps the alias
// competing with `/predictions/today` in the index. A 308 consolidates it.
export const metadata: Metadata = { robots: { index: false, follow: true } };

export default function TipsAliasPage() {
  permanentRedirect("/predictions/today");
}
