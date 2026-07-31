# Component & state glossary

*The words and the components that render them. Source of truth:
`src/lib/product/vocabulary.ts` — enforced by `src/test/product-vocabulary.test.ts`.*

## Decision states (`publicStatus`)

| Internal value | The word | Meaning | Banned synonyms (pre-v1.7) |
|---|---|---|---|
| `value_pick` | **Value Pick** | Published selection; every gate passed | "Value pick" (lowercase p) |
| `lean` | **Lean** | Model preference below the publication bar | "Model lean" |
| `watchlist` | **Watch** | Tracked; something blocks publication | "Watchlist" |
| `no_clear_value` | **Pass** | Engine analysed and declined every market | "No Pick", "No pick", "No prediction" |
| `preliminary` | **Preliminary** | Early read before full odds/evidence | — |
| `ready` | **Ready** | Analysis complete and current | — |
| `stale` | **Stale** | Price/evidence aged out | "Price stale" |
| `needs_data` | **Withheld** | Evidence bar not met | "Needs data", "Not generated" |
| `suspended` | **Unavailable** | Provider-side gap | "Suspended", "Provider gap" |
| `settled` | **Settled** | Fixture finished, decision graded | — |
| `needs_review` | **Under review** | Grading needs a human look | "Needs review" |

Prose may still refer to "the watchlist" as the name of the list; the *state
label* is Watch.

## Settlement states

| Internal value | The word |
|---|---|
| `won` | Won |
| `lost` | Lost |
| `push` | Push |
| `void` | Void |
| `pending` | Pending |
| `needs_review` | Under review |

## Freshness

| State | The word | Rule |
|---|---|---|
| fresh | Fresh | decision generated within its market window |
| stale | Stale | quote older than 24h is hidden from odds tables; decision drops to Stale |
| waiting | Waiting | fixture known, evidence pending |

## Which components render what

| Component | Renders | Must use |
|---|---|---|
| `IntelligenceSlate` (SlateFixtureCard, boards) | decision status badge + counts | `DECISION_STATUS_LABELS`, `decisionStatusBadgeClass` |
| `MatchCard` | decision badge + withheld/pass notes | `decisionStatusLabel`, `DECISION_STATUS_DESCRIPTIONS` |
| `MatchPredictionTable` | decision badge per row | `publicWatchlistReason` (Watch-prefixed) |
| `prediction/presentation.ts` | `statusLabel` for all slate consumers | re-exports vocabulary labels |
| `publicationGatePresentation.ts` | receipt states on match page | shortLabel "Watch" / "Gates pending" |
| `StoredFixtureAnalysisView` | archived receipt render path | same presentation module |
| `OddsTable` | quote freshness | 24h stale rule + hidden-count note |
| `PromotionGateBoard` | gate pass/not-yet | its own gate copy ("Passing"/"Not yet") |
| `RecordStrip`, history page | settlement chips | `SETTLEMENT_LABELS` |

## Empty / error / stale surface rules

- An **empty state** says what would fill it and how ("No fixtures today —
  Explore has the weekly radar").
- An **unavailable state** names the read that failed, never fakes zeros
  (pattern set by ProviderRunStrip).
- A **stale state** shows the age and keeps the last honest value visible.
