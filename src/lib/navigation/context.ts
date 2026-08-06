/**
 * Carrying board context across a navigation.
 *
 * `/predictions?sport=tennis` filters the board. Following a fixture from it
 * and then taking an in-page link back — "All predictions", a breadcrumb —
 * lands on bare `/predictions`, and the filter is gone. The browser's own back
 * button restores the query, so the loop only breaks on *forward* links, which
 * is why it survived this long: it is invisible until someone uses the page
 * links instead of the back gesture.
 *
 * This is a pure function so the guarantee is testable without a browser. The
 * alternative — asserting it end-to-end — needs Playwright, a dev server and a
 * CI browser download for one property that is entirely decided by how a href
 * is built.
 */

/**
 * The only keys worth carrying.
 *
 * Deliberately a whitelist. Copying the whole query string would drag
 * `?cb=`, campaign tags and anything else a visitor arrived with into every
 * internal link, and each variant is a separate indexable URL.
 *
 * Both keys change *what the page is*, which is why they live in the URL at
 * all — see docs/navigation-context.md. Display preferences like timezone and
 * odds format deliberately do not appear here: they are in storage precisely
 * so they never fork a URL.
 */
export const CARRIED_CONTEXT_KEYS = ["sport", "date"] as const;
export type CarriedContextKey = (typeof CARRIED_CONTEXT_KEYS)[number];

export type NavigationContext = Partial<Record<CarriedContextKey, string>>;

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined> | undefined | null;

/** Reads the carried keys out of whatever shape the caller has to hand. */
export function readNavigationContext(source: SearchParamsLike): NavigationContext {
  if (!source) return {};
  const context: NavigationContext = {};
  for (const key of CARRIED_CONTEXT_KEYS) {
    const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && value.trim()) context[key] = value.trim();
  }
  return context;
}

/**
 * Appends the carried context to an internal href.
 *
 * Leaves the href alone when there is nothing to carry, so links stay clean on
 * an unfiltered board rather than growing an empty `?`. A key already present
 * on the href wins — an explicit destination is a deliberate choice and must
 * not be overwritten by ambient state.
 */
export function withNavigationContext(href: string, context: NavigationContext): string {
  const entries = CARRIED_CONTEXT_KEYS.filter((key) => context[key]);
  if (!entries.length) return href;

  // Never rewrite an external or protocol-relative link.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return href;

  const [pathAndQuery, fragment] = href.split("#");
  const [path, existingQuery] = pathAndQuery.split("?");
  const params = new URLSearchParams(existingQuery ?? "");
  for (const key of entries) {
    if (!params.has(key)) params.set(key, context[key] as string);
  }
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${fragment ? `#${fragment}` : ""}`;
}
