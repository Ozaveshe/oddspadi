# OddsPadi analytics taxonomy

OddsPadi analytics are opt-in. `trackEvent()` returns before sending anything unless the visitor has granted analytics consent. Global Privacy Control defaults an undecided visitor to denied. Consent Mode v2 keeps advertising storage, user data and personalisation denied.

## Core product funnel

The canonical funnel is exported as `CORE_ANALYTICS_FUNNEL` from `src/lib/analytics/events.ts`:

1. `site_landed` — the consented visitor arrives on `/`.
2. `predictions_viewed` — the visitor reaches `/predictions`.
3. `match_detail_opened` — a match-detail route actually renders. Card clicks do not also emit this event, preventing double counts and preserving direct-entry attribution.
4. One or more meaningful actions:
   - `share_clicked`
   - `betslip_pick_added`
   - `team_followed`
   - `outbound_link_clicked`
   - `affiliate_outbound_clicked`

Match-scoped funnel events use `match_id`, `sport` and `league` when that context exists. All parameter names are snake_case. Events describe completed UI outcomes, not button impressions or failed requests.

## Event reference

| Event | Parameters | Fires at |
| --- | --- | --- |
| `site_landed` | `page_context` | Consented route arrival on the homepage, in `Analytics.tsx`. |
| `predictions_viewed` | `page_context`, `sport`, `league` | Consented route arrival on `/predictions`. |
| `match_detail_opened` | `page_context`, `match_id`, `sport`, `league` | Consented arrival on a real match-detail route. |
| `value_pick_clicked` | `match_id`, `sport`, `league`, `source` | “See why” on a value-pick card. This is diagnostic acquisition context; detail arrival remains the funnel step. |
| `betslip_pick_added` | `match_id`, `sport`, `league`, `selection`, `decimal_odds`, `source` | A priced leg is successfully written to the local Slip Check state. Removal does not emit it. |
| `share_clicked` | `channel`, `page_context`; optional `match_id`, `sport`, `league` | WhatsApp, Telegram, successful copy, or completed native-share invocation in `ShareBar`. Cancelled native shares and failed copies do not emit. |
| `team_followed` | `team_id`, `team_name`, `sport`, `country` | A new followed-team write succeeds. Idempotent repeat saves do not emit. |
| `team_unfollowed` | `team_id`, `team_name`, `sport`, `country` | An unfollow write succeeds. |
| `community_post_liked` | `post_id`; optional `match_id` | A community like write succeeds after optimistic UI. |
| `community_post_unliked` | `post_id`; optional `match_id` | A community unlike write succeeds. |
| `outbound_link_clicked` | `destination_host`; optional page/link `match_id`, `sport`, `league` | A click targets an external HTTP(S) origin. |
| `affiliate_outbound_clicked` | `bookmaker_id`, `bookmaker`, `destination_host`, `country`, `match_id`, `sport`, `league`, `placement` | A configured bookmaker affiliate link is clicked. It replaces the generic outbound event for that click, avoiding double counts. |
| `filter_used` | `source` plus submitted `filter_date`, `filter_sport`, `filter_league`, `filter_country`, `filter_confidence`, or control metadata | Prediction form submission and live-board filters. |
| `sport_selected` | `source`, `selected_value` | Sport selector changes. |
| `live_score_opened` | fixture metadata supplied by the live-score row | A linked live-score row opens its analysis. |
| `account_auth_completed` | `auth_mode`; optional `requires_email_confirmation` | Sign-in or sign-up request succeeds. |
| `account_signed_out` | none | Sign-out succeeds. |
| `community_post_created` | optional `match_id` | Feed post creation succeeds. |
| `forum_thread_created` | `category_id` | Forum thread creation succeeds. |
| `forum_reply_created` | `thread_id` | Forum reply creation succeeds. |
| `web_vital` | `metric_name`, `metric_value`, `metric_rating`, `navigation_type` | Next.js reports a Core Web Vital. |
| `client_error` | `error_kind` | An uncaught browser error or unhandled rejection occurs after consent. |

## Adding or changing events

- Add the name to `AnalyticsEvent`; do not send arbitrary strings.
- Fire at one completed user or route outcome. Avoid emitting both click and arrival for the same funnel step.
- Reuse `match_id`, `sport`, `league`, `page_context`, `source` and `channel` rather than inventing variants.
- Update this file and the analytics taxonomy test.
- Never bypass `trackEvent()`, because it owns consent gating, GPC behaviour, Google Analytics and the optional first-party beacon.
