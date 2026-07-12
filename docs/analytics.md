# OddsPadi analytics runbook

OddsPadi uses consent-gated GA4 measurement. No Google Analytics script or
request is loaded until a visitor opts in. Advertising storage, Google Signals,
ad personalization, and ad-user-data sharing remain disabled.

## Required environment variables

- `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID`: GA4 web stream measurement ID (`G-...`).
- `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`: optional Search Console HTML-tag token.
- `NEXT_PUBLIC_ANALYTICS_ENDPOINT`: optional owned collector; leave empty until a
  first-party endpoint exists.

Set public build-time values in every Netlify context that should collect data,
then trigger a new deploy. Do not put measurement IDs directly in source files.

## GA4 stream settings

Use one web stream for `https://oddspadi.com`. Enhanced measurement may remain
enabled, but verify that page views are not doubled: the app sends one manual
`page_view` for each Next.js route change and disables the tag's automatic first
page view. Internal and developer traffic should be filtered in GA4 before using
reports for product decisions.

## Product events

- `prediction_viewed`
- `match_detail_opened`
- `value_pick_clicked`
- `live_score_opened`
- `filter_used`
- `sport_selected`
- `account_auth_completed`
- `account_signed_out`
- `community_post_created`
- `forum_thread_created`
- `forum_reply_created`
- `outbound_link_clicked`
- `web_vital`
- `client_error`

Event metadata must stay free of email addresses, passwords, post text, search
terms, payment information, and stake amounts. Mark genuinely important product
outcomes as GA4 key events only after enough clean production traffic exists.

## Verification

1. Open a clean browser profile and confirm no request to Google Analytics or
   Google Tag Manager occurs before consent.
2. Decline analytics and confirm navigation creates no analytics requests.
3. Allow analytics and confirm one `page_view` per route in GA4 DebugView.
4. Open a match, use prediction filters, and confirm the expected product events.
5. Reopen **Analytics choices**, turn analytics off, and confirm `_ga*` cookies
   are removed and new events stop.
