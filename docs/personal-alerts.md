# Personal alerts

How alerts are decided, what can actually be delivered, and the boundaries
that hold regardless of channel.

## The policy engine

Every alert passes through one pure gate — `decideAlert` in
`src/lib/personal/alertPolicy.ts` — before anything sends. The checks, in
order, all defaulting closed:

1. **Consent**: no `op_alert_preferences` row means no alerts. Saving the
   settings panel is the consent action. (One exception, documented in the
   worker: subscribers who granted the original push opt-in keep exactly
   what it promised — kickoff and full-time for followed teams — until they
   save preferences. Consent to the old thing is not consent to anything
   new.)
2. **Type enabled** by the user, from the closed vocabulary:
   `fixture_start`, `official_publication`, `watchlist_change`,
   `odds_movement`, `lineup_change`, `live_start`, `final_result`,
   `settlement`, `competition_update`.
3. **Canonical grounding**: fixture-shaped events must carry a canonical
   fixture external id; publication-shaped ones a publication id; every
   event the timestamp of the thing it announces. Ungrounded events are
   refused, not guessed.
4. **Per-sport / per-competition switches**.
5. **Daily cap** (user-set, 1–50, default 10).
6. **Quiet hours**, evaluated in the *user's* timezone, overnight windows
   included; a malformed window fails toward silence.
7. **Channel deliverability** — see below.

## The watchlist boundary

**A watchlist candidate never produces a pick notification.** The event
types are distinct, and the copy builders enforce it structurally: the pick
copy builder throws on watchlist input, and the watchlist builder's copy
says "being watched by the engine — not a pick". A test pins both
directions.

## Channels

| Channel | Status |
|---|---|
| Web push | **Live.** Existing VAPID plane; per-subscription dedupe ledger; invalid endpoints removed on 404/410 |
| Email | Preference recordable, **no delivery path exists** (no sending infrastructure). Refused at delivery with the reason |
| WhatsApp | Preference recordable, **no approved integration exists**. Same refusal. The spec permits WhatsApp only through an approved, consented integration — absence is the compliant state |

The settings panel says this in the same words. No channel pretends.

## Delivery mechanics

The existing ten-minute push sweep
(`netlify/functions/push-notification-worker-background.ts`) is the
delivery loop. It now loads `op_alert_preferences` once per sweep, counts
the last 24h of the delivery ledger once per sweep for cap accounting, and
runs every candidate (kickoff, full-time, and newly `official_publication`
events from the last 45 minutes) through `decideAlert` per subscriber.
Event keys are canonical (`publication:<id>`, `kickoff:<fixture>`), the
dedupe ledger guarantees at-most-once per subscription, and follower
matching stays on canonical team external ids.
