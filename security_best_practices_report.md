# OddsPadi security best-practices audit

Audit date: 2026-07-17
Scope: Next.js 15 / React 19 application, Netlify Functions and the locked OddsPadi Supabase project (`wncwtzqipnoqwmqlznqn`).

## Executive summary

- Ten concrete application and database weaknesses were repaired on `codex/backend-security-hardening`.
- The authenticated Supabase RLS policies use ownership predicates and appropriate `WITH CHECK` clauses. Internal model tables are RLS-closed to public roles.
- The production dependency audit reports zero known vulnerabilities and no tracked secret was found.
- Two platform-level follow-ups remain: enable Supabase leaked-password protection and design a nonce-based `script-src` policy without destroying static-page performance.
- The two new migrations are committed but intentionally not applied remotely before their branch is merged.

## Resolved findings

### SEC-001 — Cookie-authenticated writes lacked CSRF enforcement

- Rule ID: NEXT-CSRF-001 / REACT-CSRF-001
- Severity: High
- Location: `src/lib/security/mutationOrigin.ts:19-46` and all `src/app/api/account/**` / `src/app/api/community/**` mutation handlers
- Evidence: every mutation now requires an exact same-origin `Origin` or `Sec-Fetch-Site: same-origin`; production requests without browser origin evidence fail closed.
- Impact: a hostile site could previously submit writes using a visitor's Supabase cookies.
- Fix: centralized same-origin mutation guard with route-wide regression coverage.
- Mitigation: Supabase RLS still enforces row ownership independently.
- False positive notes: these APIs are browser-only; rejecting headerless production clients is intentional.

### SEC-002 — Refreshed Supabase sessions could be cached

- Rule ID: NEXT-CACHE-001
- Severity: High
- Location: `src/middleware.ts:22-27,46-47`
- Evidence: `@supabase/ssr` response headers are now copied alongside refreshed cookies, and authenticated API routes are included in middleware coverage.
- Impact: a CDN-cached `Set-Cookie` response could sign another visitor into the wrong session.
- Fix: propagate the library's private/no-store headers and refresh API sessions in middleware.
- Mitigation: authenticated routes remain dynamic.
- False positive notes: the current Netlify cache may already avoid these responses; the application now enforces the invariant itself.

### SEC-003 — Service worker cached private pages and APIs

- Rule ID: REACT-SW-001 / NEXT-CACHE-001
- Severity: High
- Location: `public/sw.js:1-98`
- Evidence: runtime data caching was removed; only immutable assets are cached, and the cache version was rotated to purge prior private entries.
- Impact: a shared browser or account switch could replay another user's account/community response offline.
- Fix: network-only data/API behavior with an offline fallback for navigations.
- Mitigation: server responses also use private/no-store headers.
- False positive notes: public homepage shell caching remains intentional.

### SEC-004 — Web Push subscription endpoint SSRF

- Rule ID: NEXT-SSRF-001
- Severity: High
- Location: `src/lib/security/pushSubscription.ts:1-32`; `netlify/functions/push-notification-worker-background.ts:101-145`
- Evidence: subscription endpoints are restricted to known HTTPS browser push services and are revalidated before `webpush.sendNotification`.
- Impact: an authenticated user could previously store an arbitrary URL for a scheduled server-side request.
- Fix: destination allowlist, credential rejection, key bounds and legacy-row cleanup.
- Mitigation: worker source reads now fail explicitly instead of silently sending partial results.
- False positive notes: newly supported browser vendors must be added deliberately to the allowlist.

### SEC-005 — Internal errors were returned to public clients

- Rule ID: NEXT-ERROR-001 / NEXT-LOG-001
- Severity: Medium
- Location: `src/app/api/sports/_utils.ts:31-44`; `src/lib/security/databaseError.ts:1-25`
- Evidence: public 500s and account/community database failures now return generic messages; logs retain only bounded error codes where possible.
- Impact: provider URLs, relation names and operational details could aid reconnaissance.
- Fix: centralized redaction and operation-specific unavailable responses.
- Mitigation: server logs preserve enough code-level evidence for diagnosis.
- False positive notes: operator-only receipts may still intentionally contain diagnostic reasons.

### SEC-006 — Mutation inputs and bodies were insufficiently bounded

- Rule ID: NEXT-INPUT-001 / NEXT-LIMITS-001
- Severity: Medium
- Location: `src/lib/security/inputValidation.ts:1-30`; `src/lib/security/boundedJson.ts:1-39`
- Evidence: database IDs, cursors, provider identifiers and ILIKE input are validated; all authenticated JSON POST bodies enforce media type and byte limits.
- Impact: malformed IDs leaked database errors, wildcards broadened searches, and large JSON bodies consumed unnecessary resources.
- Fix: shared runtime validators and bounded JSON parser.
- Mitigation: Netlify also enforces a platform payload ceiling.
- False positive notes: provider identifiers intentionally allow only the characters currently used by supported providers.

### SEC-007 — Authenticated writes had no durable rate limits

- Rule ID: NEXT-DOS-001
- Severity: Medium
- Location: `src/lib/security/userRateLimit.ts:20-50`; `supabase/migrations/20260716212537_add_authenticated_write_rate_limits.sql:1-106`
- Evidence: fixed per-action policies are consumed through an `auth.uid()`-bound RPC across every account/community mutation.
- Impact: users could spam posts, replies, follows, likes, push changes and profile writes across stateless function instances.
- Fix: RLS-closed counters and a pinned `SECURITY DEFINER` function callable only by authenticated/service roles.
- Mitigation: the application fails closed when the limiter is unavailable.
- False positive notes: the migration must land before the matching application commit is deployed.

### SEC-008 — JSON-LD allowed stored script termination

- Rule ID: NEXT-XSS-001 / REACT-XSS-001
- Severity: High
- Location: `src/lib/security/jsonLd.ts:1-13` and every JSON-LD script in `src/app`
- Evidence: `<`, `>`, `&`, U+2028 and U+2029 are escaped before insertion into `application/ld+json` scripts.
- Impact: persisted forum/provider/editorial text containing `</script>` could terminate JSON-LD and create stored XSS.
- Fix: one script-safe serializer replaces every raw `JSON.stringify` sink.
- Mitigation: the CSP also blocks inline event-handler attributes.
- False positive notes: JSON escaping alone is insufficient in an HTML script context; the additional character escaping is required.

### SEC-009 — Trigger functions had mutable search paths and public RPC grants

- Rule ID: Supabase database linter `0011_function_search_path_mutable`
- Severity: Medium
- Location: `supabase/migrations/20260716210929_harden_trigger_function_search_paths.sql:1-28`
- Evidence: all three governance trigger helpers pin `pg_catalog, public`; direct `public`, `anon` and `authenticated` execution is revoked.
- Impact: mutable namespace resolution and unnecessary RPC exposure increased database attack surface.
- Fix: pinned paths and least-privilege execute grants.
- Mitigation: the functions remain security-invoker trigger helpers.
- False positive notes: trigger execution itself does not require public RPC access.

### SEC-010 — Missing browser policy baseline

- Rule ID: NEXT-CSP-001 / REACT-CSP-001
- Severity: Medium
- Location: `netlify.toml:34-41`
- Evidence: production now blocks base-tag changes, object/frame embedding, cross-origin form submission, inline event attributes and insecure subresource upgrades.
- Impact: the application previously lacked browser-enforced defense in depth for these document sinks.
- Fix: a non-breaking CSP baseline with no `unsafe-inline` or `unsafe-eval` concession.
- Mitigation: JSON-LD sinks were removed independently rather than relying on CSP.
- False positive notes: `script-src-elem` is intentionally deferred to the nonce design below.

## Remaining platform actions

### SEC-R01 — Supabase leaked-password protection is disabled

- Rule ID: Supabase Auth password security
- Severity: Medium
- Location: Supabase project Auth settings (external configuration)
- Evidence: the live Supabase security advisor reports `auth_leaked_password_protection` as `WARN`.
- Impact: users can choose passwords known to be compromised.
- Fix: enable leaked-password protection in the OddsPadi Supabase Auth dashboard.
- Mitigation: keep email confirmation and existing password-strength rules enabled.
- False positive notes: this setting is not represented in repository SQL and requires project configuration authority.

### SEC-R02 — CSP does not yet restrict script elements

- Rule ID: NEXT-CSP-001
- Severity: Medium
- Location: `netlify.toml:41`, Next.js application shell
- Evidence: the baseline intentionally omits `script-src`/`script-src-elem` because Next.js emits inline bootstrap scripts for statically generated pages.
- Impact: CSP cannot yet fully contain a future script-injection bug.
- Fix: prototype nonce-based CSP in middleware, measure the loss of static rendering/CDN efficiency, then enforce after browser validation.
- Mitigation: all known raw HTML/JSON-LD sinks are escaped and `script-src-attr 'none'` is enforced.
- False positive notes: adding `'unsafe-inline'` would make the policy appear complete while materially weakening it, so it was not used.

## Verification evidence

- Full `vitest` suite: passed.
- `npm run typecheck`: passed.
- Production `npm run build`: passed on the repository's Node 22 build path.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- Supabase rate-limit migration: parsed successfully inside a transaction that was explicitly rolled back.
- Supabase target verified before live inspection: `https://wncwtzqipnoqwmqlznqn.supabase.co`.
