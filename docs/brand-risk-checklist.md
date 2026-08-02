# Brand risk checklist

**This document is a code and copy review. It is not a trademark search, a
clearance opinion, or legal advice, and nothing in it should be read as a
conclusion that any name, mark or asset is available to use.** Items marked
*professional review* require a qualified trademark attorney in each target
jurisdiction.

---

## 1. Potential confusion points

Identified by inspecting the product's own naming, copy and visual system.
Whether any of these constitutes a legal risk is **not** assessed here.

| Area | Observation | Why it could confuse |
|---|---|---|
| Name construction | "OddsPadi" opens with the generic category word *Odds*, shared by many odds-comparison and tipping services | Category-leading prefixes are common and crowded; the distinctiveness rests almost entirely on *Padi* |
| Category adjacency | The product sits beside odds comparison, tipster platforms and prediction sites | Users may assume an affiliation with an established brand in the same space |
| "Padi" | Pidgin for *friend/companion*; carries the intended warmth for the West African audience | Phonetically close to unrelated marks in other sectors; meaning is not obvious outside the region |
| Colour | Green-forward palette | Green is heavily used across betting and odds brands; colour alone carries little distinctiveness |
| Terminology | "Value Pick", "Track Record", "Tips" | Descriptive industry terms, likely weak as distinguishing elements |
| Domain/social | `oddspadi.com` in use | Adjacent spellings and TLDs not enumerated — see §5 |

## 2. Distinctive assets worth strengthening

These are where OddsPadi's identity is genuinely its own, and where investment
compounds rather than competing on generic ground:

- **Honest abstention.** Publishing "Pass" and "Withheld", and showing seven
  promotion gates a model must clear before any pick is published, is unusual
  in this category. Most competitors publish something daily regardless.
- **A public, immutable ledger.** Every official pick carries its publication
  time, struck odds, model version and settlement, and corrections are
  append-only. The current honest state — zero official picks — is itself
  differentiating.
- **Forecast metrics separated from selection metrics.** Brier score and
  calibration presented apart from hit rate and yield.
- **African relevance as a first-class ranking factor**, not a localisation
  afterthought: regional competitions are weighted near top-five European
  leagues, and West Africa Time is the default.
- **"Padi" as a knowledgeable companion**, explicitly not a guarantee seller.
  The voice should keep resolving toward *what we know and how confident we
  are*, never *what will happen*.

## 3. Checks requiring professional review

*Not performed here, and not performable by reading this repository.*

- Trademark register searches — Nigeria (NIPC/Trademarks Registry), Ghana,
  Kenya, South Africa, plus EUIPO, UKIPO and USPTO if those markets are
  targeted. Both word mark and device/logo.
- Common-law and unregistered-rights use in each target market.
- Phonetic and transliteration similarity screening, not just exact-string.
- Classification advice — likely Nice classes 41 (entertainment/sporting
  information) and 42 (software/data services); the correct set is a legal
  question.
- Whether any competitor holds rights in "Padi"-formative marks in these
  classes.
- Gambling-advertising and affiliate-disclosure rules per jurisdiction, which
  can constrain naming and claims independently of trademark law.

## 4. Rename contingency considerations

Recorded so the cost is known rather than discovered under pressure:

- **Cheap to change:** wordmark, tagline, social handles, metadata, OG images,
  in-product copy.
- **Moderate:** domain migration with redirects, email addresses, PWA manifest
  and icons, push-notification identity, existing inbound links.
- **Expensive/irreversible:** the `oddspadi-*` prefix on published npm-adjacent
  artefacts, the `op_` database prefix (cosmetic but pervasive), and any
  audience trust attached to the public track record. **Do not rename the
  ledger tables in a rebrand** — a track record's value is continuity, and
  breaking the chain to change a prefix would cost more than it saves.
- The publication ledger is the asset most damaged by a rename, so brand
  decisions should be settled before it accumulates real published picks.

## 5. Third-party domains and handles to review

*A list of what to check — not the results of having checked.*

- Adjacent domains: `.ng`, `.com.ng`, `.africa`, `.bet`, `.app`, plus common
  misspellings (`oddspadi`/`oddspaddy`/`odspadi`/`oddpadi`).
- Social handles on X, Instagram, TikTok, Telegram, YouTube, Facebook —
  Telegram especially, since tipster impersonation there is a known pattern in
  this category and directly relevant to the community moderation work.
- App-store listings using similar names.
- Whether anyone is already impersonating OddsPadi on those channels.

## 6. Copy alignment

The terms position OddsPadi as informational analysis. Copy must not contradict
that. The product already enforces some of this in code:

- `src/lib/product/vocabulary.ts` is the single source of decision labels, with
  a test banning "No prediction", "Not generated" and similar synonyms.
- The Bet Workspace has a test asserting no "safe", "guaranteed", "sure" or
  "winning slip" language in leg notes, and no staking-recommendation API.
- Forecast and selection metrics are labelled as answering different questions.

**Not yet audited:** every remaining user-visible string across the site for
certainty language. That sweep is outstanding and is the largest open item from
the responsible-language brief.
