# Responsible use

Responsible-use copy is consistent across the product and never makes an
unsupported claim.

## The centre — `/responsible-use`

- **18+ and higher where local law sets it higher**, plus an explicit
  under-18 notice; betting law is local and the reader's responsibility.
- **Probability, not certainty** — "a 70% read is not a win; it should fail
  roughly three times in ten".
- **Loss-chasing warning** and the signs worth taking seriously (money you
  need, borrowing/hiding, betting to feel better, losing time).
- **Limit guidance** — decide the amount before looking at a card.
- **Tools that create distance** — deposit/loss/session limits, reality checks
  and cooling-off/take-a-break, **self-exclusion** (operator and national
  registers), and blocking software (Gamban / GamBlock / BetBlocker). Framed as
  living with the bookmaker/bank/national scheme, since OddsPadi holds no funds.
- **Self-assessment** pointer to the support organisations' free questionnaires.
- **Regional support** — International, South Africa, Nigeria, Ghana/Kenya, UK;
  links not phone numbers (numbers change); non-affiliation + emergency-services
  note.
- **Notification controls** — alerts opt-in from `/account`, device data
  clearable from `/my`, analytics consent optional.

## The boundary, kept accurate everywhere

**OddsPadi does not take bets and does not hold funds.** This exact boundary
appears on the responsible-use page, the footer ("does not take bets or hold
money"), the 18+ pill ("Analysis only — no betting, no payments"), and the
`ResponsibleUseNotice`. Predictions are "statistical opinions, not guarantees".

## Consistent linking

Every prediction surface renders `ResponsibleUseNotice` (links the centre), and
`PredictionDisclaimer` now links `/responsible-use` too; the footer links it on
every page.

## Prohibited claims

`guaranteed winner / safe bet / sure odds / risk free / guaranteed profit` and
the rest of the banned list are refused in source copy
(`consumer-copy-integrity.test.ts`, roots now include `src/lib/product` and
`src/lib/discovery`) **and** in AI-polished editorial output at runtime
(`makesProhibitedClaim`). Accurate language is used instead: model probability,
official published selection, analysis only, uncertain outcome, no qualifying
decision, stale evidence.
