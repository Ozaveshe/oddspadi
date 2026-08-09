# Public methodology boundary

Public transparency shows how the system works; it never exposes secrets,
chain-of-thought, credentials, private endpoints, internal identifiers, or raw
operational logs.

## Public status may show

operational / delayed / partial / unavailable / last public update — via
`toPublicStatusLabel` and `/api/status` (`readmodel/publicStatus.ts`, which
drops provider names, run ids and raw errors by construction).

## Public status must NOT show

- **Raw SQL / DB / vendor errors** → collapsed by `toPublicReason`
  (`src/lib/security/publicErrorText.ts`). Applied to the provider strip,
  decision-engine page, `/engine/performance` `sourceReason`, prediction
  history, and stored-fixture reasons.
- **Private provider names** (`api-football`, `the-odds-api`, …) → rendered as a
  source **count**, never the slugs. `engineHealth.sourceCount` replaced
  `engineHealth.providers`.
- **Internal run IDs** → dropped from public receipts and the provider strip.
- **Documentation paths / internal table names** (`op_publications`,
  `docs/*.md`) → removed from the track-record and decision-engine pages.
- **Live gate thresholds** → the exact `minimumValueEdge` number is no longer
  printed; the page says a sport-specific threshold applies.

Guarded by `public-transparency-boundary.test.ts`.

## Public methodology may show

data categories, model family, calibration approach, decision policy,
publication rules, settlement rules, performance metrics
(`/track-record` methodology, `/engine/performance` methodology).

## Public methodology must NOT show

- **Secret prompts / chain-of-thought** — the editorial AI prompt is a module
  constant, never attached to a story; no CoT field is requested back. Model
  output is validated and **gated on the shared banned-claims list**
  (`makesProhibitedClaim`, `src/lib/editorial/bannedClaims.ts`) before it can be
  published — the prompt instruction is not trusted alone.
- **Internal engine tokens** — unmapped decision blockers are redacted by
  `presentBlockers` (a raw `calibration_support_missing`-style token never
  reaches a reader); `INTERNAL_MARKERS`/`isReaderFacing` guards the fixture card.
- **Credentials / private endpoints / raw logs** — never rendered; error text is
  logged by code only.

Guarded by `methodology-boundary.test.ts` and `consumer-copy-integrity.test.ts`
(now also scanning `src/lib/product` and `src/lib/discovery`).
