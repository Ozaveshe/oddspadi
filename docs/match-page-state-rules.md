# Match page state rules

What the match page may and may not say, by phase.

*Phases: `upcoming`, `live`, `finished`, `void`, `postponed`, `unknown`.
Continuity across them: [live-continuity.md](live-continuity.md).*

## Upcoming

- Show the current pre-match analysis and its freshness.
- Make expiry explicit: a price has a life, and the page says when it ends.
- **Remove the action if the gates fail.** A pick whose price expired is not a
  pick with a caveat.
- **Never imply an unavailable signal was checked.** Absent is absent; silence
  reads as "fine".

## Live

- Distinguish the original pre-match decision from the live state.
- **A pre-match probability is never called current.** It was true when it was
  made; the market has moved since.
- Show a live model only where an approved live run produced it. `ModelView`
  carries `basis`, and `live` is set only by an approved in-play run.
- **Never silently update the original publication.** The claim is immutable;
  only the verdict moves, and it moves in the ledger.

## Finished

- The final score and the settlement dominate.
- The pre-match analysis becomes historical and is labelled so.
- **Remove "refresh before kickoff" and every other action phrase.** Present
  tense about a closed market is the most common way a finished page reads as
  broken.
- Say whether there was an official pick.
- **Never create a retrospective pick.** A page that finds a winner after the
  fact and presents it as a call is the single most damaging thing this product
  could do.
- Link to the record row.

## Void, postponed, unknown

- No score, because there is none. A test asserts a score never appears for a
  fixture that produced none.
- No settlement without a publication behind it.
- `unknown` is a real state and is shown as one, not smoothed into `upcoming`.

## The rules that hold in every phase

| Rule | Why |
|---|---|
| Exactly one decision state | Two conclusions on one page is not a nuance, it is a defect |
| Odds are current, historical or absent — never two at once | The reader acts on this |
| Settlement implies a publication | A verdict with no claim is not a record |
| An official pick implies a publication timestamp | An untimed claim is not evidence |
| Consumer copy carries no engine vocabulary | Those strings are upstream; passing them through is the mistake |
| Readiness is the weakest dimension | An average lets a strong signal hide a missing one |
