# OddsPadi Prediction Agent Math

This MVP uses transparent deterministic sport models for football, basketball, and tennis. The models are designed to be replaceable by stronger data science later, but every current calculation can be inspected and tested.

## 1. Football Expected Goals, Poisson, And Dixon-Coles

For each football match, OddsPadi estimates home and away expected goals using:

- league goal-rate baseline
- team attack strength
- opponent defensive resistance
- goals for and goals against
- rating difference
- recent form
- home advantage
- data quality
- bounded context adjustment from provider-backed injuries, suspensions, lineups, standings, weather, news, and live events when available

The output is bounded so extreme mock inputs cannot create unrealistic goal expectations.

The model treats home goals and away goals as independent Poisson variables:

```txt
P(goals = k) = (e^-lambda * lambda^k) / k!
```

`lambda` is the expected goals estimate for that team.

The score matrix is built from 0-8 goals for each side, then normalized so the captured probability sums to 1.

The model then applies a Dixon-Coles low-score correction to the score cells that independent Poisson handles poorly:

```txt
tau(0,0) = 1 - homeLambda * awayLambda * rho
tau(0,1) = 1 + homeLambda * rho
tau(1,0) = 1 + awayLambda * rho
tau(1,1) = 1 - rho
```

`rho` is bounded and currently negative, which modestly adjusts the low-score draw and one-goal cells before the matrix is normalized again. The diagnostic signal `Dixon-Coles rho` records the exact value used for each fixture.

From the score matrix:

- Home win = sum of scores where home goals > away goals
- Draw = sum of scores where home goals = away goals
- Away win = sum of scores where away goals > home goals
- Over 2.5 = sum of scores where total goals > 2.5
- BTTS yes = sum of scores where both teams score at least 1
- Top correct scores = highest-probability cells in the score matrix

For live football fixtures with a current score and minute, the model switches to an in-play score matrix. It starts from the current score, scales remaining expected goals by time left, applies a bounded game-state chase adjustment, then projects final score probabilities:

```txt
remainingShare = (96 - currentMinute) / 96
remainingHomeXG = preMatchHomeXG * remainingShare * homeGameState * tempo
remainingAwayXG = preMatchAwayXG * remainingShare * awayGameState * tempo
finalScore = currentScore + poisson(remainingHomeXG, remainingAwayXG)
```

This makes match winner, over/under, BTTS, expected final score, and top scorelines score/minute-aware. It still needs live event feeds for cards, substitutions, injuries, shots, pressure, and momentum before a live edge should be trusted in production.

## 2. Basketball Rating, Pace, And Efficiency

For basketball, OddsPadi projects points rather than goals. The MVP model uses:

- team rating difference
- recent form difference
- home-court advantage
- pace proxy
- offensive efficiency proxy
- defensive resistance proxy
- rest-day margin
- availability and rotation proxy
- posted spread line
- posted total-points line
- data quality

The rating and form layer creates an expected margin:

```txt
expectedMargin = ratingDiff * 0.42 + formDiff * 5.5 + homeCourtAdvantage + restAdjustment + availabilityAdjustment
```

The scoring layer estimates a game total from offensive efficiency, defensive resistance, and pace:

```txt
expectedTotal = (homeOffense + awayOffense + homeDefenseResistance + awayDefenseResistance) / 2
expectedTotal = expectedTotal + (pace - 96) * 1.3 + rotationTotalAdjustment
```

Projected team points:

```txt
homePoints = (expectedTotal + expectedMargin) / 2
awayPoints = (expectedTotal - expectedMargin) / 2
```

The model converts margin and totals gaps into probabilities with a logistic curve:

```txt
homeMoneyline = 1 / (1 + e^(-expectedMargin / 7.2))
homeCover = 1 / (1 + e^-((expectedMargin - spreadLine) / 6.5))
overTotal = 1 / (1 + e^-((expectedTotal - totalLine) / 11.5))
```

The basketball MVP outputs moneyline, spread-cover, total-points, projected points, pace, margin, rest-day margin, availability margin, rotation total adjustment, and signal diagnostics. Rest and availability are deterministic MVP proxies until provider-backed injury reports, travel, minutes limits, and rotation feeds are connected.

## 3. Tennis Elo, Surface, And Match Shape

For tennis, OddsPadi projects player win probability, set handicap, and total games. The MVP model uses:

- player Elo or rating difference
- surface-specific strength proxy
- recent form difference
- fatigue proxy
- head-to-head proxy
- travel/load proxy
- tournament round pressure
- posted total-games line
- data quality

The player-one win probability is logistic:

```txt
playerOneWin = 1 / (1 + e^-(eloDiff * 1.15 + formDiff * 0.9 + surfaceAdjustment + fatigueAdjustment + h2hAdjustment + travelLoadAdjustment + roundAdjustment))
```

Match dominance then informs set handicap:

```txt
dominance = abs(playerOneWin - 0.5)
playerOneSetHandicap = playerOneWin + dominance * 0.28 - 0.12
```

Expected total games rise when the match is closer:

```txt
expectedGames = 22.6 + (0.5 - dominance) * 7 + abs(formDiff) * 1.2
overGames = 1 / (1 + e^-((expectedGames - totalGamesLine) / 2.6))
```

The tennis MVP outputs match winner, set handicap, total games, expected sets, projected games, head-to-head adjustment, travel/load adjustment, and signal diagnostics. Head-to-head and travel/load are deterministic MVP proxies until real match-history and player-status providers are connected.

## 4. Implied Probability And Edge

Decimal odds convert to raw implied probability. The engine removes bookmaker margin within each market by normalizing all raw implied probabilities:

```txt
rawImpliedProbability = 1 / decimalOdds
bookmakerMargin = sum(rawImpliedProbabilitiesForMarket) - 1
noVigImpliedProbability = rawImpliedProbability / sum(rawImpliedProbabilitiesForMarket)
valueEdge = modelProbability - noVigImpliedProbability
expectedValue = modelProbability * decimalOdds - 1
```

Before value-edge ranking, the live prediction pipeline applies a bounded market-prior blend when a model market matches priced bookmaker selections:

```txt
heuristicMarketPriorWeight = f(dataQuality, bookmakerMargin, selectionCount)
marketPriorWeight = max(heuristicMarketPriorWeight * learnedWeightScale, footballEvidenceFloor)
adjustedModelProbability = normalize(modelProbability * (1 - marketPriorWeight) + noVigImpliedProbability * marketPriorWeight)
```

The heuristic weight rises when model data quality is lower and falls when bookmaker margin is high. The scale is fit chronologically on priced training observations after probability-temperature calibration, accepted only when a strictly later validation window improves log loss without material Brier regression, and frozen before the outer holdout. A scale of `1` preserves the original heuristic, while football evidence floors still protect thin-history teams even if the learned scale is lower. Identical kickoff cohorts are never divided between evidence windows; when no strict timestamp boundary exists, training fails closed.

Example:

```txt
odds = 2.20
rawImpliedProbability = 45.45%
noVigImpliedProbability = 43.80%
modelProbability = 52.00%
valueEdge = +8.20%
expectedValue = +14.40%
```

### 4.1 Empirical value durability

A positive point estimate is necessary but no longer sufficient for a governed live pick. After temperature calibration and the learned market-prior blend, the engine groups every final-posterior training selection into canonical probability buckets of width `0.10`. A bucket is eligible only with at least 30 observations. Its conservative probability is the one-sided 95% Wilson lower bound:

```txt
z = 1.6448536269514722
denominator = 1 + z^2 / n
center = (observedRate + z^2 / (2n)) / denominator
margin = z * sqrt(observedRate * (1 - observedRate) / n + z^2 / (4n^2)) / denominator
probabilityFloor = max(0, center - margin)
```

The candidate survives only when value remains positive at that floor:

```txt
conservativeEdge = probabilityFloor - noVigImpliedProbability
conservativeExpectedValue = probabilityFloor * decimalOdds - 1
eligiblePick = conservativeEdge > 0 AND conservativeExpectedValue > 0
```

The policy is learned only from a strictly earlier final-posterior training-validation window and is frozen before the outer holdout. Missing, thin, malformed, or chronology-invalid buckets fail closed. Replay stores both the unguarded point-estimate pick metrics and the guarded metrics; promotion validates the exact pick-count delta and ROI/yield arithmetic before the policy can reach the live engine.

## 5. Fair Odds

The agent estimates model fair odds:

```txt
fairOdds = 1 / modelProbability
```

If market odds are meaningfully higher than fair odds and confidence is acceptable, the selection may become a value candidate.

## 5.5 Odds Intelligence Audit

The decision engine audits every available market and selection:

- raw implied probability from decimal odds
- no-vig probability after margin removal
- bookmaker margin by market
- model probability after sport model, context adjustment, and bounded market-prior calibration
- fair odds from model probability
- value edge
- expected value
- confidence and risk

A selection is `value` only when edge and EV are both positive and confidence is not low. A selection is `watch` when one signal is positive but the full guardrail does not clear. Everything else is `avoid`.

The audit returns top candidates, market-level summaries, high-margin warnings, avoid reasons, and counts for positive-edge, positive-EV, and actionable selections. This is the product's odds-intelligence layer: it explains why the agent favors one market, why alternatives are safer or weaker, and why a bet should be avoided.

### Explanation Quality Audit

`GET /api/sports/decision/explanation-audit` checks whether each generated decision explanation is complete enough for operator review. It scores:

- model thesis
- market edge or avoid logic
- risk disclosure
- news, lineup, weather, live-state, or missing-context caveats
- safer alternatives
- next checks before action
- no-action-overreach locks

The audit is read-only. It does not call OpenAI and does not write Supabase rows. A complete explanation can be used as a copy candidate, but publishing, persistence, training, staking, and public-action upgrades remain controlled by the separate authority and activation gates.

## 5.6 Data Coverage And Provenance Score

Before the agent trusts the value calculation, it audits the required production data checklist:

- fixtures for the day
- team/player historical results
- league standings
- home/away performance
- recent form
- injuries and suspensions
- lineups or starters
- bookmaker odds
- live scores and match events
- news signals
- weather where relevant
- historical training corpus

Each signal gets a status:

- `provider-backed` = real provider data is connected
- `computed` = derived from loaded model inputs
- `mock` = MVP/demo feed only
- `missing` = required source is not connected
- `stale` = source exists but is too old
- `not-applicable` = not relevant for that sport/state

The weighted score is:

```txt
dataCoverageScore = sum(signalStatusScore * signalWeight) / sum(signalWeight)
```

where provider-backed and not-applicable signals score `1.0`, computed signals score `0.72`, mock signals score `0.42`, stale signals score `0.22`, and missing signals score `0`. The output records `requiredBeforeTrust` so the product can explain why a model-backed edge is still not production-ready.

## 5.7 Data Intake Queue

The slate-level data intake queue rolls every match's coverage audit into an operator runbook. For each signal category it counts provider-backed, computed, mock, missing, and stale inputs, then maps the gap to:

- the provider needed
- the missing environment variables
- the safest local command to run first
- the expected evidence after the run
- the verification URL
- the decision impact

The queue treats provider dry-runs as the first step. Write-mode imports remain gated by `ODDSPADI_ADMIN_TOKEN`, the right provider keys, and Supabase server credentials. The football corpus path starts with capped API-Football and The Odds API dry-runs for 2016-2025, then writes normalized fixtures, teams, odds, events, standings, availability, lineups, news, weather, features, and ingestion audit rows only after the normalized counts look correct.

## 5.8 Slate AI Council

The slate council is the top-level decision posture check. It reviews the highest-ranked candidate with six roles:

- model chair
- market skeptic
- data steward
- risk officer
- learning analyst
- operations lead

Each role votes `consider`, `monitor`, or `avoid` from public engine evidence: model score, no-vig edge, EV, data coverage, self-audit findings, learning readiness, and runbook status. The final action is the safest role vote, so any role can lower trust when its evidence is blocking:

```txt
finalCouncilAction = minSafety(vote_model, vote_market, vote_data, vote_risk, vote_learning, vote_operations)
```

The optional OpenAI council critique reads the same public evidence docket and can agree, downgrade, abstain, or request more data. It cannot upgrade the deterministic council action. This keeps AI useful for critique and synthesis without letting generated text override the math or provider gates.

## 5.9 Model Ensemble Auditor

The model ensemble is a candidate-level cross-check. It does not train a new model; it audits whether the existing model evidence survives independent judges:

- sport model
- market model
- posterior belief
- data quality
- calibration and case memory
- risk and robustness
- actionability

Each judge returns a verdict: `support`, `watch`, `oppose`, or `block`. Verdicts map to conservative scores:

```txt
support = 100
watch   = 62
oppose  = 26
block   = 0
ensembleScore = sum(judgeScore * judgeWeight) / sum(judgeWeight)
```

The ensemble action only reaches `consider` when the weighted score is high and the base engine already chose `consider`. Any hard block forces `avoid`; split evidence becomes `monitor` or `avoid`. This makes disagreement inspectable instead of letting one attractive EV number hide weak data, memory, or robustness evidence.

## 5.10 Feature Matrix

The feature matrix turns a live prediction into a training-shaped vector. Each feature has:

- numeric value
- group
- source
- provenance status: `provider-backed`, `computed`, `mock`, or `missing`
- training-ready flag

The live matrix includes team strength, form, expected score, model probability, no-vig probability, value edge, EV, market-prior weight, context shifts, data-coverage counts, learning profile values, calibration reliability, case-memory sample size, uncertainty, robustness, and actionability.

```txt
featureVector = {
  home_rating,
  away_rating,
  rating_diff,
  expected_home_score,
  expected_away_score,
  model_probability,
  no_vig_probability,
  value_edge,
  expected_value,
  coverage_score,
  uncertainty_score,
  ...
}
```

For historical training, the same vector shape must later be paired with target labels: final result, final score, closing odds, closing-line value, and settlement outcome. Mock features are visible for MVP proof, but they are not counted as training-ready.

## 5.11 Model Math Proof

The model-math proof is a read-only slate audit over the deterministic sport engines:

```txt
model_math_proof = {
  sport,
  model_version,
  formulas,
  required_inputs,
  present_diagnostic_signals,
  proxy_or_missing_inputs,
  market_probabilities,
  normalized_winner_market_check,
  example_expected_score
}
```

The proof must show three real model families:

```txt
football   = expected goals + Poisson score matrix + Dixon-Coles low-score correction
basketball = rating margin + pace + offensive/defensive efficiency + rest/availability + spread/moneyline logic
tennis     = player Elo + surface rating + recent form + head-to-head + fatigue/load + tournament round
```

It also checks that match-winner probabilities normalize near 100%, that context and market-prior diagnostics are visible, and that the proof cannot train, persist, publish, use learned weights, or upgrade public action. Provider-backed data, calibration, and backtests are still required before learned guardrails can affect trust.

## 5.12 Model Governance And Drift Gate

Learned guardrails are not allowed to affect live decisions just because a feature vector exists. The governance gate checks:

- real finished fixture volume
- real odds volume
- historical feature snapshot volume
- live feature provenance
- live training-ready score
- target-label availability
- completed real-data backtest
- runtime training storage
- feature drift coverage

Each check receives a score and status:

```txt
governanceTrustScore = average(checkScore)
approved = no hard failures and governanceTrustScore >= 82
shadow = evidence exists but still has warnings or non-critical failures
blocked = corpus, target labels, runtime storage, or other hard gates fail
```

When governance is `blocked` or `shadow`, learned thresholds may be displayed for inspection but must not change live publish/avoid decisions. This prevents a small, mock-heavy, or drift-unknown sample from looking like a trained model.

## 5.12 Invalidation Monitor

The invalidation monitor is the slate-level freshness controller. It does not change model probabilities; it decides whether the current probability and value-edge snapshot can still be trusted.

It checks:

- belief expiry from the decision belief state
- snapshot expiry from prediction generation time plus TTL
- due monitoring tasks
- fragile or sensitive market movement
- missing or stale live-score/event state
- data-intake provider blockers
- model-governance blockers
- finished matches that need settlement and closing-line labels

Jobs are ranked by status, priority, then due time:

```txt
ready > blocked > waiting
critical > high > medium > low
oldestDueAt first
```

The monitor returns the next proof command, missing env, expected evidence, verification URL, and risk if ignored. This keeps the agent from treating a stale expected-value edge as actionable after odds, lineups, injuries, weather, live events, or governance evidence has changed.

## 5.13 Bounded Autopilot

The autopilot is the agent controller. It does not place bets, publish picks, or write data by itself. It ranks the next proof action from:

- model governance
- invalidation monitor
- AI council review
- action sandbox
- learning queue
- operating-cycle transition

Actions are sorted by readiness and priority:

```txt
ready > blocked > waiting
critical > high > medium > low
```

The autopilot can only auto-run commands that are read-only or explicitly `dryRun=1`. Write-gated commands, missing env, stale beliefs, blocked governance, or unverified Supabase schema force `blocked` or `supervised`.

```txt
canPublish =
  councilCanPublish
  and governanceApproved
  and invalidationClear
  and noSandboxWriteBlock
  and operatingCycleCanPublish
```

The ledger is public reasoning, not hidden chain-of-thought. It records what the agent observed, which bounded decision it made, and which evidence URL must verify the next state.

## 5.14 Research Agent

The research agent turns the active candidate into a cited investigation dossier. It does not fetch private facts by itself and it does not upgrade a decision. It asks:

- What is the primary model thesis?
- What is the strongest counter-thesis?
- Which supplied evidence supports, opposes, or is missing?
- Which contradictions block trust?
- Which provider command or verification URL answers the next question?

The verdict is conservative:

```txt
needsData if governance is blocked
needsData if invalidation is blocked
needsData if critical questions need missing env
reject    if the deterministic action is avoid
contested if high-priority research questions remain
supports  only when evidence and gates are clear
```

When `review=1` is used, OpenAI receives only the structured dossier and must cite supplied evidence IDs. Any claim that is not supported by supplied evidence remains an unsupported claim and cannot raise trust.

## 5.15 Trace Ledger

The trace ledger turns the current decision into a replayable audit record. It is not a hidden reasoning transcript. It is a structured proof map that says which bounded claims passed, which claims need watching, which claims block trust, and how an operator can replay the next verification step.

For each active target, the ledger records:

- a stable trace hash for the current audit path
- the same input hash shape used by `op_decision_runs`
- claim nodes for input snapshot, model belief, market edge, data coverage, governance, invalidation, research, council, autopilot, sandbox, learning, and persistence
- node status as `pass`, `watch`, or `block`
- read-only or `dryRun=1` replay commands
- verification URLs and expected evidence after each command
- whether the persistence payload contains the brain trace inside `model_snapshot.brain` and the replayable confidence trace inside `model_snapshot.thinkingTrace`

```txt
traceStatus =
  blocked  if any required claim node is block
  watching if no required block exists and at least one claim node is watch
  ready    if all claim nodes pass
```

The replay layer is intentionally conservative:

```txt
canReplay = command startsWith GET or command contains dryRun=1
```

This keeps the agent auditable before it becomes autonomous. A decision can look attractive only after its model, market, data, governance, invalidation, and persistence claims can be replayed without inventing evidence.

## 5.16 Activation Audit

The activation audit is the launch controller for live agent mode. It does not predict a match directly; it decides whether the engine is allowed to use live providers, persist memory, train on history, request OpenAI critique, run safe autopilot actions, or publish a slate.

Each gate has a status and score:

```txt
pass  = evidence is verified and the capability can be used
watch = partial evidence exists, but live proof or production smoke is still needed
block = required evidence is missing or unsafe for write/live mode
```

The audit score is the average of gate scores:

```txt
gateScore(pass)  = 100
gateScore(watch) = 50 unless a more specific coverage score exists
gateScore(block) = 0

activationScore = mean(gateScore_i)
```

Critical gates include:

- OddsPadi Supabase project target
- Supabase MCP project isolation
- expected `op_` schema verification
- decision-memory write mode
- live sports provider runtime
- bookmaker odds intelligence
- historical training governance
- guarded OpenAI critique
- brain trace persistence payload
- safe autopilot action loop
- Netlify runtime environment

The MCP isolation gate exists because using the wrong Supabase project is worse than being offline. The engine must not apply live migrations, persist production decisions, or backfill training rows through a global MCP target until the target is proven to be the OddsPadi project.

```txt
writeModeAllowed =
  supabaseProjectTarget.pass
  and mcpProjectIsolation.pass
  and supabaseSchema.pass
  and decisionMemoryWrites.pass
  and tracePayload.includesBrainAndThinkingTrace
```

This is also why `model_snapshot.brain` and `model_snapshot.thinkingTrace` can be payload-ready while persistence remains blocked: structural readiness and write permission are separate gates.

## 5.17 Proof Runner

The proof runner turns activation gates, trace nodes, replay steps, and autopilot actions into supervised receipts. It does not execute write-mode work. Its job is to say what is already verified, what needs a safe read-only or `dryRun=1` run, and what is blocked.

Receipt status is conservative:

```txt
verified     = observed evidence satisfies the claim now
needs-run    = a safe read-only or dry-run command can verify the next state
blocked      = required env, provider data, schema proof, or governance evidence is missing
contradicted = observed evidence conflicts with the expected state
```

Each receipt has a stable evidence hash:

```txt
evidenceHash = fnv1a(id, status, observedEvidence, expectedEvidence, verifyUrl)
```

The proof score is a coverage ratio over the current receipt set:

```txt
proofCoverage = verifiedReceipts / totalReceipts
```

The proof runner remains `blocked` if any receipt is blocked or contradicted. It is `partial` when no block exists but at least one safe proof still needs a run. It is `verified` only when every included receipt is already proven.

This layer is the bridge between a thinking dashboard and a supervised operating agent. It lets the system say, "I believe this," "this is the receipt," and "this is the next safe proof," without secretly running mutations or trusting unsupported text.

## 5.18 AI Orchestrator

The AI orchestrator is the controlled bridge from deterministic math to real OpenAI review. It does not replace the Poisson, Elo, market-prior, calibration, or proof layers. It chooses what the model is allowed to inspect and what the model is allowed to change.

Review targets are bounded:

```txt
targets = active match reviewer + slate council reviewer
safeTarget = curl GET command and not persist=1 and not POST
```

The orchestrator remains `needs-config` until `OPENAI_API_KEY` exists. When configured, `run=active-match`, `run=slate`, or `run=1` can call the existing structured OpenAI reviewers. Those calls are non-persistent; they return review evidence but do not store a decision run.

The core safety inequality is:

```txt
rank(ai_action) <= rank(deterministic_action)
avoid < monitor < consider
```

That means AI text can agree, downgrade, abstain, or request more data, but it cannot upgrade `avoid` or `monitor` into a stronger public recommendation.

Every AI review must obey the evidence contract:

- cite supplied evidence IDs
- return structured safety gates
- report unsupported claims
- avoid invented injuries, lineups, weather, news, odds, scores, or bookmaker moves
- leave persistence and publishing to separate activation/proof gates

## 5.19 AI Review Ledger

The AI review ledger is the append-only contract around every model review. It records what the AI is allowed to inspect, what it must return, what proof blocks review, and what secrets or claims are denied.

The ledger contains three important hashes:

```txt
entryHash = fnv1a(id, kind, status, inputScope, outputContract, verifyUrl)
promptManifestHash = fnv1a(model, allowedInputs, deniedInputs, requiredOutputs, schemas, safetyRules)
ledgerHash = fnv1a(date, sport, status, promptManifest, entryHashes)
```

The ledger does not make AI output authoritative. It makes the AI call replayable and auditable. A review can be submitted only when:

```txt
submitToOpenAIAllowed =
  OPENAI_API_KEY.configured
  and safeReviewCommand
  and proofRunner.status != blocked
```

Persistence remains separately blocked:

```txt
persistAllowed = false in the AI review ledger
```

This separation matters because the model may reason over supplied evidence, but storage, publishing, learning, and bankroll-facing actions must still pass activation audit, proof runner, governance, and operator/admin gates.

## 5.20 Counterfactual Lab

The counterfactual lab asks how the current decision behaves under plausible shocks. It is deterministic and read-only. It uses existing scenario matrix, market-movement scenarios, decision-boundary triggers, and robustness cases.

Each case records:

```txt
baselineAction
actionAfterShock
scoreDelta = projectedScore - decisionScore
survival = survives | downgrades | breaks
```

The action ranking stays conservative:

```txt
avoid < monitor < consider
```

So a shock survives only when:

```txt
rank(actionAfterShock) >= rank(baselineAction)
```

A downgrade or break does not automatically change stored memory. It creates a verification obligation:

```txt
requiredBeforeTrust = falsifier + mitigation
```

The lab never promotes, persists, or publishes:

```txt
canPromote = false
canPersist = false
canPublish = false
```

This gives the AI reviewer a safer thought surface: instead of asking the model to imagine hidden events, the engine provides explicit shocks, expected deltas, falsifiers, and read-only commands that can be checked against provider data.

## 5.21 Belief Revision

The belief revision layer decides whether a current belief should hold, weaken, wait for evidence, or retire. It combines counterfactual shocks, data gaps, proof state, and AI-review ledger state.

For each match:

```txt
shockPressure = f(breaking shocks, downgrade shocks, severity, negative score delta)
evidencePressure = f(requiredBeforeTrust, missingSignals, actionability blockers, control gates)
proofPressure = f(proofRunner.status, aiReviewLedger.status, aiProtocol.status)
```

The revision score is weighted:

```txt
revisionScore = 0.42 * shockPressure + 0.38 * evidencePressure + 0.20 * proofPressure
```

The status is conservative:

```txt
retiring       = blocked control policy or severe breaking shocks
needs-evidence = high evidence/proof pressure
weakening      = moderate shock/evidence/proof pressure or fragile belief grade
holding        = no material pressure
```

The action rank still only moves downward:

```txt
avoid < monitor < consider
rank(revisedAction) <= rank(baselineAction)
```

Belief revision is not persistence. It produces a revision hash and read-only command, but keeps:

```txt
canPromote = false
canPersist = false
canPublish = false
```

## 5.22 Information-Gain Planner

The information-gain planner answers a narrower operator question: which safe proof should the agent inspect next because it is most likely to change the decision state? It combines the evidence refresh scheduler, data-intake queue, hypothesis lab, counterfactual lab, and belief revision layer.

Each candidate receives component scores:

```txt
uncertaintyReduction = expected reduction in model, market, or data uncertainty
blockerReduction    = expected ability to clear a launch or trust blocker
actionFlipPotential = probability that the proof moves consider/monitor/avoid
learningValue       = usefulness for calibration, training, or future priors
costPenalty         = missing env, dry-run friction, or blocked execution cost
```

The planner uses a conservative weighted score:

```txt
informationGainScore =
  0.35 * uncertaintyReduction
+ 0.28 * blockerReduction
+ 0.22 * actionFlipPotential
+ 0.15 * learningValue
- 0.40 * costPenalty
```

It can select read-only `GET` proof commands and provider dry-runs only when required env is present. It cannot persist, publish, train, stake, or raise trust from one proof:

```txt
canPersist = false
canPublish = false
canTrain = false
canRaiseTrust = false
```

## 5.23 Reasoning Alignment Layer

The reasoning alignment layer checks whether the agent's public thought trace agrees with the information-gain planner. This prevents a narrative from sounding coherent while pointing at a lower-value or mismatched proof.

The AI executive consumes that alignment as a gating lane, so missing, blocked, or drifting reasoning alignment blocks trust in the executive thought trace before any public action can advance.

The executive policy synthesis then reduces phase status, conflicts, alignment, provider ingestion, memory isolation, and proof receipt into one governing rule:

```txt
policyScore = clamp(70 + sum(driverImpacts), 0, 100)
policyStatus = blocked | repair-first | approved-readonly | watch-proof
policyAction = block | repair-evidence | observe-proof | hold
```

This policy names the active vetoes and required proof before the engine can observe a route, ask for guarded AI review, or keep holding.

The executive feedback reducer closes the no-write loop after policy selection:

```txt
executive_policy -> proof_receipt -> feedback_state -> learning_queue -> memory_draft
```

It can mark the next turn as `observe-proof`, `record-shadow-feedback`, `repair-proof`, `queue-learning`, or `hold`. The reducer is deliberately weaker than persistence: it may produce a memory draft and learning questions, but `mayPersist`, `mayPublish`, `mayTrain`, `mayRaiseTrust`, and `mayUpgradePublicAction` remain false.

The executive cycle reducer sits one level higher and reports the current loop position:

```txt
perceive -> align -> decide -> act -> reduce -> learn -> halt
```

Its statuses are `awaiting-proof`, `proof-observed`, `learning-queued`, `repair-required`, and `halted`. The cycle owns the safe command queue and transition reason, but it still cannot execute commands or unlock write-side effects.

The layer scores six checks:

```txt
proofLanguageMatch = overlap(active thought evidence, highest information-gain proof)
sourceRecognition  = whether the mind names the same source family
commandAlignment   = whether both layers choose the same safe proof route
blockerConsistency = whether readiness and missing-env language match
actionImpactMatch  = whether the mind explains the planner's expected decision impact
safetyLocks        = whether promote/persist/publish/train/trust-raise locks remain false
```

The status is conservative:

```txt
aligned  = high score and no blocking checks
watching = medium score; keep proof explicit
drift    = thought trace and proof ranking disagree
blocked  = no candidate or safety lock drift
```

Alignment is audit-only:

```txt
canAskOpenAI = false
canPersist = false
canPublish = false
canTrain = false
canRaiseTrust = false
```

## 5.24 Metacognition Layer

The metacognition layer is the agent's read-only thought state. It does not run a model, fetch secret data, or write results. It composes the current brain slate, operating cycle, autopilot, counterfactual lab, belief revision, proof runner, and AI-review ledger.

It exposes eight stages:

```txt
observe -> believe -> doubt -> test -> revise -> decide -> verify -> learn
```

Each stage receives one of three statuses:

```txt
pass  = no visible blocker in that stage
watch = supervised attention or fresh evidence is needed
block = proof, revision, governance, or safety gates stop progress
```

The overall status is conservative:

```txt
blocked  = any stage is block
watching = no blocks but at least one stage is watch
clear    = all stages pass
```

Operating mode is derived from proof and review contracts:

```txt
proof-blocked          = proof runner, AI ledger, autopilot, or metacognition status is blocked
live-review-ready      = proof is verified and AI review submission is allowed
offline-deterministic  = OpenAI review is not configured or not allowed
supervised-review      = proof is not blocked but still needs operator-controlled review
```

The layer also publishes:

- `primaryDoubt`
- `changeMyMind[]`
- `activeBelief`
- `nextSafeCommand`
- `metacognitionHash`

The runbook is intentionally non-escalating:

```txt
canAskOpenAI = submitToOpenAIAllowed and status != blocked and beliefRevision.status != retiring
canPromote = false
canPersist = false
canPublish = false
```

This gives the product an inspectable thought loop without allowing a reasoning summary to become a bet recommendation, database write, or live publish action.

## 5.23 AI Handoff Packet

The AI handoff packet is the boundary between deterministic OddsPadi reasoning and a real model call. It builds a Responses API request preview, but does not submit it by default.

Inputs:

- active deterministic decision
- metacognition state
- AI orchestrator target
- AI review ledger contract
- bounded evidence docket with stable evidence IDs

The request preview is intentionally non-persistent:

```txt
store = false
reasoning.effort = medium
reasoning.summary = auto
text.format.type = json_schema
```

The model must return strict JSON with:

```txt
reviewVerdict
recommendedAction
confidenceAdjustment
riskAdjustment
summary
reasoningTrace
evidenceChecks
safetyGates
unsupportedClaims
dataGaps
saferAlternatives
checksBeforeAction
```

The same-or-safer rule still dominates the AI output:

```txt
maximumAllowedAction = deterministic baseline action
avoid < monitor < consider
rank(recommendedAction) <= rank(maximumAllowedAction)
```

Submission is allowed only when:

```txt
OPENAI_API_KEY is configured
AI review ledger allows submission
metacognition is not blocked
review command is read-only and does not include persist=1
```

The packet records both an `inputHash` and `packetHash`, so operators can prove exactly what was sent or why submission was held.

## 5.24 AI Citation Validator

The AI citation validator checks whether the model-review path is evidence-bound before any AI output can be trusted.

Inputs:

- AI handoff packet
- handoff evidence IDs
- response JSON schema
- system prompt
- AI firewall review metadata

Rules:

```txt
evidence-docket    = evidence IDs exist and are unique
citation-schema    = schema requires citedEvidenceIds in reasoningTrace and evidenceChecks
prompt-grounding   = system prompt says use supplied evidence only and do not invent facts
review-citations   = completed review cites supplied evidence IDs
no-persistence     = requestPreview.store is false and command is read-only
firewall-alignment = firewall is accepted before trust is allowed
```

Statuses:

```txt
valid          = citations verified against supplied IDs
pending-review = citation system is ready but no completed review exists
invalid        = schema, prompt, review citations, or no-persistence controls failed
blocked        = handoff or proof path is blocked
```

Trust stays locked down:

```txt
canTrustAIOutput = status == valid and firewall.status == accepted
canPersist = false
canPublish = false
```

This prevents a JSON-shaped AI answer from becoming trusted simply because it parsed correctly. It must cite supplied evidence IDs and pass the firewall.

## 5.25 AI Output Firewall

The AI output firewall is the acceptance layer after a model review. It decides whether AI text can affect an in-memory decision, must stay pending, should be quarantined, or is blocked by proof requirements.

Statuses:

```txt
accepted       = completed AI review passed every firewall rule
pending-review = no completed review is available yet
quarantined    = AI output completed but violated an action or persistence rule
blocked        = handoff, proof ledger, or metacognition is blocked
```

Firewall rules:

```txt
handoff-state       must not be blocked
review-completed    must have at least one reviewed item before acceptance
same-or-safer       appliedAction <= deterministic maximumAllowedAction
no-persistence      requestPreview.store = false and run item safeNoPersistence = true
proof-ledger        AI review ledger must not be blocked
metacognition-state must not be blocked
```

The firewall can allow in-memory application only:

```txt
canApplyToDecision = status == accepted
canPersist = false
canPublish = false
canUpgrade = false
```

This layer makes the real AI review path safer: a model can reason, critique, downgrade, or request data, but the product still has a deterministic gate before any AI output influences a visible decision.

## 5.26 Decision Authority

The decision authority layer answers the final product-control question:

```txt
Which action is authoritative right now?
```

Inputs:

- deterministic baseline action
- belief-revised action
- AI handoff packet
- AI output firewall
- proof runner
- AI review ledger
- metacognition state

Action choice stays same-or-safer:

```txt
revisedOrBaseline = minRank(baselineAction, beliefRevisedAction)

if proof or metacognition is blocked:
  authorizedAction = avoid
elif firewall accepted AI:
  authorizedAction = minRank(revisedOrBaseline, aiAppliedAction)
elif firewall quarantined AI:
  authorizedAction = minRank(revisedOrBaseline, monitor)
else:
  authorizedAction = revisedOrBaseline
```

Source labels:

```txt
proof-blocked  = proof runner, AI ledger, metacognition, or firewall is blocked
ai-reviewed    = firewall accepted same-or-safer AI output
ai-quarantined = AI output completed but failed firewall trust
deterministic  = no accepted AI output is available
```

Public posture is conservative:

```txt
public-candidate = status authorized and authorizedAction consider
watchlist-only   = supervised and authorizedAction is not avoid
internal-only    = blocked or authorizedAction avoid
```

Authority does not write:

```txt
canPersist = false
canPublish = false
canTrainFromResult = false
canApplyAI = source == ai-reviewed and firewall accepted
```

This gives the UI and API one final state to trust without letting any model output bypass proof, source provenance, or outcome-learning gates.

## 5.27 Agent Kernel

The agent kernel is the top-level turn wrapper for the decision agent. It does not create a new prediction; it composes the current reasoning stack into one auditable state:

```txt
observe   = metacognition state
reason    = active authority reason
challenge = OpenAI handoff readiness
cite      = evidence-citation validator
firewall  = AI output acceptance firewall
authorize = final product authority
act       = proof runner and AI-review ledger
learn     = persistence, publishing, and training gates
```

Kernel status is conservative:

```txt
if any phase blocks:
  status = blocked
elif any phase watches:
  status = supervised
else:
  status = ready
```

Kernel mode explains the safest operating posture:

```txt
safe-hold                = authority is blocked
ai-reviewed-authority    = accepted cited AI review can only apply same-or-safer
openai-review-ready      = handoff can be submitted but is not yet trusted
deterministic-supervised = local deterministic review remains the authority
```

The kernel exposes the active decision, phase evidence, a stable hash, a turn ID, and the next safe operation. Its permissions are intentionally hard-gated:

```txt
canAskOpenAI = handoff allows submit and citation validator allows submit
canTrustAI   = citation validator trusts output and firewall can apply it
canApplyAI   = decision authority allows AI application
canPersist   = false
canPublish   = false
canTrain     = false
```

This layer gives the UI one object that says what the agent currently thinks, what it is allowed to do, and what proof must clear before action.

## 5.28 Agent Runtime

The agent runtime converts the kernel into an operational state machine. It answers:

```txt
What can the agent safely do right now?
```

Runtime phases:

```txt
sense   = data intake and provider coverage
think   = agent kernel turn state
review  = guarded OpenAI orchestrator
decide  = active decision authority
execute = bounded autopilot/action sandbox
verify  = replayable trace ledger
learn   = activation, memory, training, and settlement gates
```

Runtime mode is chosen conservatively:

```txt
live-ready          = activation ready and kernel ready
openai-review       = OpenAI review can be requested through the guarded path
read-only-autopilot = a safe read-only/dry-run proof command can run
safe-hold           = kernel or activation is blocked
manual-proof        = human-supervised proof remains
```

Commands are runnable only when they are local `curl.exe` checks, read-only `GET`s, or explicit `dryRun=1` `POST`s:

```txt
blocked if command contains persist=1, persist=true, dryRun=0, or dryRun=false
blocked if POST does not include dryRun=1
blocked if required env is missing
```

The runtime exposes hard locks:

```txt
supabase-writes
public-publishing
outcome-learning
provider-backfill
openai-review
```

Even when a proof command is safe to run, the runtime keeps:

```txt
canPersist = false
canPublish = false
canTrain = false
```

This separates useful autonomous proof-gathering from dangerous product actions. The agent may inspect, verify, and ask for bounded AI critique, but writing memory, publishing picks, and training learned guardrails require separate activation proof.

## 5.29 Supabase Bootstrap

The Supabase bootstrap layer turns project setup into a machine-readable gate before the agent can collect the 10-year corpus.

Inputs:

- expected OddsPadi project ref
- local Supabase linked project metadata
- runtime Supabase preflight and schema checks
- local migration manifest
- 10-year football corpus plan
- agent runtime locks

Status:

```txt
blocked-wrong-target = configured ref or URL is not OddsPadi
needs-keys           = server/admin/provider env is missing
needs-mcp            = generic MCP is not proven project-scoped
needs-schema         = project and keys exist, but op_ tables are not verified
ready-dry-run        = dry-run provider sync can proceed under supervision
```

The bootstrap never enables writes by itself:

```txt
canRunWriteBackfill = false
canPersistDecisions = false
canTrainModel = false
```

The first safe corpus command stays `dryRun=1`. Write-mode provider backfills require all of these to pass first:

- OddsPadi project ref and URL proof
- project-scoped Supabase MCP or server schema verification
- expected `op_` table verification
- admin token and provider keys
- reviewed dry-run counts
- runtime locks clear

This prevents the agent from accidentally applying OddsPadi migrations or training data to AfroTools, LATMtools, or any other Supabase project.

### Project Isolation State Machine

`/api/sports/decision/supabase-project-isolation` is the sharper wrong-project guard beside the bootstrap layer. It reduces detected refs, key proof, MCP proof, and schema proof into one status:

```txt
blocked-cross-project = known AfroTools or LATMtools ref is detected
blocked-wrong-target  = configured ref, URL ref, CLI link, or MCP ref is non-OddsPadi
needs-project-env     = project ref or URL is missing
needs-keys            = target is OddsPadi, but publishable/server keys are missing or unverified
needs-mcp-proof       = keys exist, but MCP scope is not proven with ODDSPADI_SUPABASE_MCP_PROJECT_REF
needs-schema-proof    = MCP is scoped, but op_ tables are not verified
ready-isolated        = target, keys, MCP, and schema proof all agree
```

The guard exposes separate locks:

```txt
canExposeClientRead    = target is OddsPadi and publishable key is present
canReadDecisionMemory  = schema is verified with a valid server key
canWriteDecisionMemory = ready-isolated
canApplyMigrations     = target is OddsPadi, MCP is scoped, and server key is not rejected
canRunWriteBackfill    = false
canTrainModel          = false
canPublishPicks        = false
```

So even a green isolation state is not a full launch permission. It only says the database target is safe enough for the dedicated persistence, backfill, training, and publishing gates to make their own decisions.

## 5.30 Netlify Deployment Readiness

The Netlify readiness layer makes deployment an explicit agent gate instead of an assumption.

Inputs:

- `netlify.toml` build settings
- Next.js runtime expectation
- production URL env
- Supabase bootstrap state
- agent runtime state
- required production env groups

Status:

```txt
needs-config   = netlify.toml is missing or build/publish config is wrong
needs-env      = production env is missing required keys
needs-site-url = build/env is close, but production URL proof is missing
blocked        = Supabase bootstrap or project targeting blocks deployment trust
ready-smoke    = local build and production route smoke commands are ready
```

The committed `netlify.toml` may contain only non-secret settings such as:

```txt
build command = npm run build
publish       = .next
node version  = 22
```

Secrets must stay in Netlify environment variables:

- Supabase service role and publishable key
- provider keys
- OpenAI key
- OddsPadi admin token

Even when Netlify can deploy, this layer keeps:

```txt
canEnableScheduledBackfill = false
canPublishPicks = false
```

Scheduled provider ingestion and public pick publishing require separate Supabase bootstrap, provider dry-run, agent runtime, authority, and activation proof.

## 5.31 MVP Requirement Audit

The MVP audit is the top-level proof object for the product plan. It does not calculate new probabilities. It checks whether the existing layers satisfy the required operating surface:

- data layer: fixtures, historical results, standings, home/away, recent form, injuries, suspensions, lineups, odds, live scores, match events, news, weather, and training corpus
- prediction models: football Poisson/Elo-style team strength, basketball efficiency/pace, tennis surface Elo, and learned-guardrail governance
- odds intelligence: implied probability, no-vig margin removal, EV, value edge, ranking, safer alternatives, and avoid explanations
- AI explanation: public reasoning, evidence IDs, news/risk awareness, no-upgrade firewall, and agent runtime phases
- Supabase/training: project ref, MCP scope, expected `op_` schema, 10-year corpus plan, real corpus volume, and backtests
- Netlify: config, production env readiness, and local/production smoke routes
- responsible controls: analysis-only posture plus hard no-persist, no-publish, and no-train locks

Each check is scored as:

```txt
pass  = implemented and backed by current proof
watch = implemented but still proxy, partial, or provider-dependent
block = missing, unsafe, or not proven against the right project/runtime
```

Overall status is intentionally conservative:

```txt
ready   = no watch or block checks
partial = at least one watch check and no block checks
blocked = at least one block check
```

The audit returns launch blockers, watch items, proof URLs, and the next safe command. It keeps production controls false until Supabase project isolation, provider data, real training corpus, Netlify env, and agent proof all agree.

## 5.31.1 Original Brief Coverage

The original brief coverage receipt is the product-facing checklist for the first MVP request. It uses the same proof artifacts as the compact dashboard and reports each requested item as:

```txt
real    = implemented and inspectable in the current runtime
shadow  = implementation path exists, but provider, corpus, Supabase, Netlify, or OpenAI proof is still missing
blocked = external key, schema, corpus, safety, or project proof currently prevents launch readiness
```

Sections mirror the brief directly: data layer, prediction engine, odds intelligence, AI explanation, 10-year training corpus, Supabase/Netlify, and safety controls. The receipt never fetches providers, writes secrets, persists decisions, trains models, publishes picks, or upgrades public action. It only names evidence, blockers, proof URLs, and the next safe read-only command.

## 5.31.2 Requirement Pulse

The requirement pulse is the compact first-screen projection of the MVP audit. It is intentionally lighter than the full audit route, but it maps the same original brief to artifacts already built for the default dashboard:

```txt
data-layer           = data authority
prediction-engine    = football, basketball, tennis model cards
odds-intelligence    = cross-sport market audits, EV, edge, risk notes
ai-review            = OpenAI review readiness contracts plus public cognitive proof receipt, evidence graph, and thinking introspection
training-data        = multi-sport training blueprint
responsible-controls = world critic locks
```

Pulse status is conservative:

```txt
blocked if any group is blocked
watch   if no group is blocked but at least one group needs proof/env/data
ready   only when every group is ready
```

The pulse cannot run providers, call OpenAI, persist, publish, train, or upgrade a public action. It keeps the first screen honest by showing which parts of the original MVP plan are real, which are shadow-ready, and which still need proof.

## 5.31.3 Data Gap Resolver

The data gap resolver turns the current top data-layer gap into ranked proof actions. It reads data authority and provider-ingestion evidence, then produces one ordered queue:

```txt
proof-gate      = Supabase target, MCP, credential, or schema proof
provider-feed   = fixture, odds, lineup, injury, news, weather, live, or event dry-run
training-corpus = historical-result and feature-corpus dry-run
```

Each action carries:

```txt
safeToRun
missingEnv
blockers
expectedEvidence
modelImpact
oddsImpact
trainingImpact
aiReviewImpact
storageTables
```

The resolver never writes provider rows, persists decisions, trains models, publishes picks, calls OpenAI, or upgrades public action. Commands must remain `curl.exe` read-only or explicit dry-runs and must not include `persist=1`, `dryRun=0`, or production deploy flags.

## 5.32 Supabase Proof Binder

The Supabase proof binder is the read-only database activation packet. It is not a migration runner and does not call MCP from the Next.js route. It combines:

- expected OddsPadi project ref and URL
- configured project ref, URL ref, linked CLI ref, repo MCP ref, and live MCP proof env
- expected `op_` table list, verified table count, missing/inaccessible tables, and credential status
- local migration files and whether they declare every expected table
- foreign project refs and foreign schema sentinel tables
- proof URLs and a safe next read-only command

The binder status is conservative:

```txt
blocked-cross-project = wrong ref or foreign schema signal exists
blocked-invalid-key   = server key was rejected
needs-project-env     = OddsPadi project env is incomplete
needs-mcp-proof       = repo config may be scoped, but live MCP proof is not recorded
needs-schema-proof    = expected op_ tables are not verified
ready-proof           = target, MCP proof, credentials, schema, and migrations agree
```

Even `ready-proof` is not write-mode permission. It only unlocks schema-confidence for later gates. Provider writes, decision persistence, model training, public pick publishing, and public-action upgrades remain false until their own gates pass.

## 5.33 Training Corpus Proof

The training corpus proof is the executive artifact for the user's "last 10 years of scores and data" requirement. It does not fetch providers or write rows. It binds:

- the multi-sport 2016-2025 corpus plan
- football, basketball, and tennis provider adapters and backtest runners
- expected historical match and odds-snapshot volumes
- current real fixture, odds, feature, and backtest counts
- sport-specific signal coverage for fixtures, historical results, standings, home/away, form, injuries/suspensions, lineups, events, news, weather, pace/efficiency, player Elo, surface rating, fatigue, and tournament context
- Supabase proof binder state
- next safe read-only or dry-run command

Corpus proof statuses are:

```txt
blocked-supabase = project, key, MCP, schema, or foreign-schema proof blocks storage
waiting-env      = provider/admin/server env is missing
ready-dry-run    = the next provider dry-run can be inspected
waiting-corpus   = real fixture, odds, feature, or backtest rows are still missing
shadow-ready     = the corpus can be reviewed for shadow learning
```

`shadow-ready` still does not mean live training. Learned weights, provider writes, training-row persistence, public publishing, and public-action upgrades stay false until model governance, calibration, drift, activation, and operator approval pass.

### Training readiness receipt

`GET /api/sports/decision/training/readiness` is the stricter trainability receipt for the 10-year corpus. It composes the data blueprint and corpus proof, then answers:

- which sports are trainable only in shadow mode
- which model families are blocked by missing real fixtures, odds, feature snapshots, labels, CLV, or backtests
- whether the next useful step is a capped provider dry-run, a corpus write review, or a real-data backtest review
- why learned weights still cannot affect public decisions

The receipt keeps every write and launch control false:

```txt
canWriteProviderRows      = false
canPersistTrainingRows    = false
canTrainModels            = false
canUseLearnedWeights      = false
canPublishPicks           = false
canUpgradePublicAction    = false
```

### Shadow training candidates

`GET /api/sports/decision/training/shadow-candidates` inspects the learned-weight payloads produced by completed historical backtests. It is the bridge between real backtest math and future model tuning, but it is still quarantine-only.

For each sport it reports:

- the stored backtest id and model key
- sample, train, test, and pick counts
- Brier score, log loss, ROI units, yield, and closing-line value
- learned weights such as `minimumEdge`, `valueEdgeWeight`, `dataQualityWeight`, `marketAdjustmentWeight`, `homeAdvantageElo`, `paceWeight`, `homeCourtPoints`, `surfaceWeight`, or `eloKFactor`
- promotion blockers such as demo data, missing corpus readiness, weak sample size, missing backtests, or missing learned-weight payloads

Even a `ready-shadow` candidate cannot apply learned weights to public picks. Promotion still requires model governance, calibration, drift, operator approval, and independent publish/write gates.

### Learned-weight promotion governor

`GET /api/sports/decision/training/promotion-governor` is the hard no-write gate between shadow learned-weight candidates and any future model influence. It compares:

- `training/shadow-candidates`
- `model-cards`
- per-sport model governance
- sample-size, Brier, log-loss, ROI/yield, and CLV evidence
- the permanent promotion lock for the current MVP

The governor may report `eligible-shadow` when a sport is ready for read-only comparison against deterministic picks. That still does not apply weights to predictions:

```txt
canRunShadowComparison             = true only when every sport is eligible
canApplyLearnedWeightsToPredictions = false
canPromoteLearnedWeights            = false
canTrainModels                      = false
canPublishPicks                     = false
```

### Learned-weight shadow comparison

`GET /api/sports/decision/training/shadow-comparison` simulates learned weights against the current odds board without mutating the prediction output. It combines:

- the odds board edge and expected-value selections
- shadow learned-weight candidates
- the promotion governor
- learned thresholds such as `minimumEdge`, `valueEdgeWeight`, `dataQualityWeight`, and sport-specific weights

The comparison can label a row as `would-pass-shadow`, `would-downgrade`, `watch-only`, or `blocked`. These labels are diagnostic only. The route cannot apply learned weights, promote picks, persist the comparison, train models, publish, or upgrade public action.

### Training activation runbook

`GET /api/sports/decision/training/activation-runbook` is the ordered no-write checklist for moving from corpus setup to future learned-weight activation review. It composes the 10-year corpus proof, training readiness, shadow candidates, promotion governor, and learned-weight shadow comparison into one sequence:

```txt
prove-supabase
run-provider-dry-run
write-corpus-review
generate-feature-snapshots
run-real-backtests
inspect-shadow-candidates
inspect-promotion-governor
run-shadow-comparison
operator-activation-review
```

The runbook selects the first unfinished gate as the next step, so the operator does not skip from missing corpus proof into later model-promotion checks. Commands are limited to read-only `GET` receipts or explicit provider dry-runs. It cannot write provider rows, persist training rows, train models, apply learned weights, promote learned weights, publish picks, or upgrade public action.

## 5.34 Launch Commander

The launch commander is the compact first-screen operator queue. It does not replace the detailed activation runbook; it chooses the next blocker class to inspect first. It composes:

- Supabase proof binder
- 10-year corpus proof
- data gap resolver
- AI review readiness
- MVP requirement pulse
- responsible-control locks

The commander ranks blockers before ready proof commands:

```txt
blocked > ready > waiting > watch > pass
critical > high > medium > low
```

Every surfaced command must be read-only or an explicit dry-run. The commander cannot write provider rows, persist decisions, persist training rows, train models, publish picks, or upgrade public action. Its job is to stop the operator from chasing a later-stage task while an earlier launch gate, such as invalid Supabase credentials or a missing OpenAI key, still owns the path.

## 5.35 Environment Activation Matrix

The environment activation matrix is the safe key-name checklist for local and Netlify setup. It never returns secret values and cannot write `.env.local` or Netlify variables. It classifies rows by:

- category: Supabase, MCP, admin, provider, OpenAI, or Netlify
- destination: local, Netlify, local-and-Netlify, or MCP session
- exposure: public, server secret, server config, or MCP proof
- status: configured, missing, invalid, needs-proof, or optional
- required proof URL and next action

The matrix treats `SUPABASE_SERVICE_ROLE_KEY`, provider keys, `ODDSPADI_ADMIN_TOKEN`, and `OPENAI_API_KEY` as server secrets. `NEXT_PUBLIC_*` rows can be public but must not be combined with server secrets in client code. Even when every row is configured, writes, persistence, training, publishing, and public-action upgrades stay locked until their proof routes pass.

The OpenAI key diagnostic is the sharper no-secret explanation for live review issues:

```txt
missing-key       = OPENAI_API_KEY is not loaded in the server runtime
suspicious-key    = a runtime value exists but does not look like an OpenAI key
contract-waiting  = key shape looks configured, but review contracts still need proof
ready-to-request  = guarded review routes can be requested with explicit run=1
blocked           = safety or contract checks block review
```

It never prints the key, creates a key, writes env files, or calls OpenAI. It only reports runtime presence, key-shape class, model override state, review-lane counts, safe next command, and the locks that prevent persistence, publishing, training, and public-action upgrades.

### AI review contract audit

`GET /api/sports/decision/ai-contract-audit` is the no-write acceptance contract for model-reviewed reasoning. It does not call OpenAI. It combines:

- OpenAI key readiness and review-lane contracts
- `store=false` Responses API request proof
- the append-only AI review ledger
- the JSON-schema handoff packet
- the output firewall
- citation validation
- the same-or-safer action rule

The contract can only permit a guarded review request or accept a shadow review when every gate passes. Even then, it cannot apply AI to the public decision, persist, publish, train, raise trust, or upgrade public action.

## 5.36 Supervised Activation Runbook

The activation runbook turns the MVP audit into an ordered operator sequence. It is not a prediction model and does not change probabilities. It answers a narrower control question: what can safely run next without accidentally enabling writes, public publishing, or learned model behavior?

The runbook phases are:

```txt
supabase-project-proof
environment-secrets
schema-verification
provider-dry-run
openai-review
local-build-smoke
netlify-env
production-smoke
training-corpus
write-mode-approval
```

Each phase is scored as:

```txt
done    = proof already exists
ready   = a safe command can run now
waiting = configuration or evidence is missing
blocked = running would be unsafe or premature
```

Only read-only `curl.exe -sS`, explicit `dryRun=1` provider calls, `npm run build`, `npx netlify status`, and `npx netlify env:list` can be surfaced as runnable commands. Commands containing `persist=1`, `dryRun=0`, or `deploy --prod` are rejected.

The runbook keeps four hard locks true until every gate is manually cleared:

```txt
persist = locked
publish = locked
train = locked
writeBackfill = locked
```

This lets the product start real activation work against Supabase, providers, OpenAI, and Netlify while preserving the same safety boundary as the deterministic agent runtime.

## 5.37 Decision Mind

The decision mind is the consolidated read-only packet for the active decision. It does not fetch providers, submit OpenAI requests, write Supabase rows, train models, or publish picks. It composes:

- brain slate
- research agent
- metacognition
- AI orchestrator
- AI handoff
- AI firewall
- decision authority
- activation runbook

Active decision selection is deterministic:

```txt
authority.activeDecision.matchId
else metacognition.activeBelief.matchId
else brainSlate.topBrains[0]
else researchAgent.target
else highest decisionScore row
```

The status is conservative:

```txt
blocked              = authority, firewall, or activation runbook has a blocking gate
review-ready         = OpenAI review is configured, handoff is ready, and activation has a safe command
waiting-for-evidence = research or metacognition still needs evidence
thinking             = read-only reasoning can continue
```

The mind exposes public thought checks only:

```txt
model-market-belief
market-skepticism
data-coverage-doubt
research-agent
metacognition
ai-firewall
authority
activation-runbook
```

Each thought has a public claim, supporting evidence labels, uncertainty, and the next check. It is not hidden chain-of-thought. It is the visible audit layer operators can inspect before running a safe command.

The thinking trace turns those public thought checks into a compact operator receipt:

```txt
supporting      = count(thought.status == supports)
questioning     = count(thought.status == questions)
needsEvidence   = count(thought.status == needs-evidence)
blocking        = count(thought.status == blocks)
netScore        = supports * 2 - questions - needsEvidence * 2 - blocks * 4

trace status:
blocked    if blocking > 0
unproven   if needsEvidence > 0
contested  if questioning > supporting or netScore < 0
supportive otherwise
```

The confidence budget is weighted from model-market edge, data quality, thought consensus, authority action, and AI-review readiness. It produces a 0-100 score plus `high`, `medium`, or `low` grade. The same trace carries thesis, counter-thesis, synthesis, falsifiers, evidence gaps, next evidence action, and a short audit trail. This is public reasoning, not hidden chain-of-thought.

Safe commands remain bounded:

```txt
allowed: curl.exe -sS read-only checks
allowed: explicit dryRun=1 POST checks
allowed: npm run build
allowed: npx netlify status
allowed: npx netlify env:list
blocked: persist=1, dryRun=0, deploy --prod, or service role strings
```

The mind keeps hard locks:

```txt
canPromote = false
canPersist = false
canPublish = false
canTrain = false
```

This gives the product one inspectable answer to "what does the agent currently believe, doubt, and need next?" while preserving the no-write safety boundary.

## 5.33.1 Operator Turn

The operator turn is the single read-only action packet for the current slate. It composes the decision mind, capability contract, evidence transition, agent runtime, and authority into one visible turn.

The turn trace is fixed:

```txt
observe
frame
hypothesize
challenge
decide
execute
verify
learn
```

Each phase is marked `pass`, `watch`, or `block` with public evidence labels and the next check. The turn chooses one operation in this order:

```txt
capabilityContract.nextSafeCommand
else decisionMind.nextSafeAction
else evidenceTransition.nextTransition
else agentRuntime.nextCommand
```

Command safety is intentionally narrow:

```txt
read-only   = curl.exe without write flags
dry-run     = curl.exe POST with explicit dryRun=1
manual-only = any command with persist=1, dryRun=0, deploy, or non-curl execution
```

The status is conservative:

```txt
review-ready = OpenAI can be asked and the capability contract allows review
ready-to-run = selected operation is safe and not manual-only
blocked      = blocking trace or blocked capability contract
waiting      = no safe operation yet
```

The turn returns success criteria, failure signals, fallback action, confidence/trust patch, authorized action, public posture, and hard locks:

```txt
canPersist = false
canPublish = false
canTrain = false
```

This is the operator answer to "what should the agent do next?" It does not run the command, write Supabase rows, publish picks, or train a model.

## 5.33.2 Operator Receipt

The operator receipt turns the selected operator turn into observed proof. It does not execute the command string. It only resolves the turn's `verifyUrl` when all of these are true:

```txt
path starts with /api/sports/decision/
method is GET
host is local or relative
query does not include persist=1, dryRun=0, run=1, review=1, agent=1, or enhance=1
target is not operator-receipt itself
```

When `run=1` is requested, the receipt route fetches the approved proof URL, reads the JSON wrapper, and records:

```txt
HTTP status
content type
response hash
response byte length
success flag
status label
summary
signals
```

Receipt status is conservative:

```txt
verified         = proof route fetched successfully and returned success=true
observed-warning = proof route fetched but did not return a clean success
failed           = fetch failed or returned a non-2xx status
blocked          = target is unsafe, missing, or unapproved
not-run          = target is approved but run=1 was not requested
```

The receipt keeps the same side-effect locks as the turn:

```txt
canExecuteShell = false
canPersist = false
canPublish = false
canTrain = false
```

This gives the agent a real observe/verify step while keeping the execution boundary narrow and auditable.

## 5.33.3 Operator State Transition

The operator state transition reduces an operator receipt into a read-only state patch. It is the bridge between observed proof and the next turn.

State status:

```txt
pending-proof   = receipt target is approved but not observed
proof-observed  = proof was observed, but blockers or watch signals remain
advance-shadow  = proof was observed without blocker/watch pressure
needs-repair    = proof route failed or returned a warning
blocked         = proof target is unsafe or unavailable
```

The reducer looks only at the receipt, not at hidden chain-of-thought:

```txt
receipt.status
receipt.observation.statusLabel
receipt.observation.signals
receipt.observation.responseHash
receipt.permissions
```

Patch rules:

```txt
advance-shadow  -> keep receipt trust/confidence patch, mayAdvanceReadOnly=true
proof-observed  -> confidence=keep-capped, trust=hold
pending-proof   -> confidence=keep-capped, trust=hold
needs-repair    -> confidence=cap-low, trust=reduce
blocked         -> confidence=cap-low, trust=reduce
```

State gates:

```txt
proof-target
proof-observation
blocker-pressure
side-effects
state-advance
```

The state layer can draft memory content, but cannot persist it:

```txt
memoryDraft.canPersist = false
mayPersist = false
mayPublish = false
mayTrain = false
```

This makes the agent loop concrete:

```txt
operator turn -> operator receipt -> operator state -> next operator turn
```

The loop can keep thinking and verifying, but it cannot silently mutate production data or public picks.

## 5.33.4 Operator Episode

The operator episode is the replayable record of one agent loop. It bundles:

```txt
operator turn
operator receipt
operator state
```

The episode timeline is fixed:

```txt
turn    = selected bounded operation
receipt = proof route observation
state   = proof-to-state reduction
memory  = unpersisted memory draft
next    = next bounded move
```

Episode status:

```txt
ready-to-observe = receipt is approved but not yet observed
observed         = proof was observed and state was reduced, but trust remains capped
advance-shadow   = proof permits read-only shadow advance
needs-repair     = proof failed or returned warning
blocked          = unsafe or unavailable proof path
```

The final patch is still non-mutating:

```txt
canAdvanceReadOnly = state.mayAdvanceReadOnly
canPersist = false
canPublish = false
canTrain = false
```

The replay commands are read-only:

```txt
GET operator-turn
GET operator-receipt?run=1
GET operator-state?run=1
```

This gives operators and future automation a stable episode artifact without claiming live autonomy before Supabase, provider, OpenAI, outcome, and training gates pass.

## 5.33.5 AI Reasoning Gateway

The AI reasoning gateway is the first model-backed operator brain over the whole episode. It submits only the replayable operator episode and supplied evidence IDs to the Responses API with `store=false` and a strict JSON schema.

The output is public reasoning, not hidden chain-of-thought:

```txt
observe   = what proof was seen
frame     = what objective and final patch are active
challenge = what could make the state wrong
decide    = hold, repair, block, or advance-read-only
verify    = next read-only proof command
learn     = draft memory candidate
```

The gateway action set is narrower than user-facing prediction actions:

```txt
advance-read-only = allow the next shadow proof turn only
hold              = keep trust capped
repair            = route to blocker repair
block             = stop the current operator path
```

It cannot create live picks or training state:

```txt
canPersist = false
canPublish = false
canTrain = false
canUpgradePublicAction = false
```

When OpenAI is not configured or the response fails schema validation, the deterministic fallback emits the same output shape and keeps the episode safe:

```txt
fallbackAction =
  advance-read-only if episode.status=advance-shadow and canAdvanceReadOnly
  block             if episode.status=blocked
  repair            if episode.status=needs-repair
  hold              otherwise
```

This makes the AI layer real and callable without letting a model hallucinate injuries, lineups, odds moves, scores, weather, news, persistence, publishing, or training.

## 5.33.6 AI Cognitive Loop

The AI cognitive loop is the controller that turns the operator episode plus AI reasoning review into one bounded next move. It is deliberately narrower than the full product because it is allowed to think, but not mutate:

```txt
sense      = read proof and episode evidence
interpret  = classify the current operator state
deliberate = inspect risks, gaps, and falsifiers
arbitrate  = choose hold, repair, block, or advance-read-only
act        = expose one safe read-only command
verify     = define the proof expected after the command
learn      = draft memory without persistence
```

Status is derived from the active review and command safety:

```txt
blocked        if episode is blocked or review action is block
repair         if review action is repair
needs-config   if OpenAI is missing and no run was requested
ready-shadow   if action is advance-read-only and command is safe
thinking       if OpenAI is configured and review is ready
needs-evidence otherwise
```

The command guard remains simple and conservative:

```txt
safeToRun =
  command contains curl.exe
  and command is not POST
  and command does not contain persist=1
  and command does not contain dryRun=0
```

The loop locks are invariant:

```txt
canPersist = false
canPublish = false
canTrain = false
canUpgradePublicAction = false
```

This gives the agent a real cognitive cycle while keeping every state change proof-gated and operator-visible.

## 5.33.7 AI Cognitive Proof

The AI cognitive proof is the public receipt for the whole thinking stack. It does not expose hidden chain-of-thought and it does not call OpenAI by itself. It composes existing public/replayable artifacts:

```txt
cognitive loop     = sense, interpret, deliberate, arbitrate, act, verify, learn
deliberation       = role panel, hypotheses, decision questions, final stance
control packet     = authorization, next bounded move, forbidden actions
thought episode    = private replay draft and proof commands
thought memory     = audit-only recall and recurring blocker pressure
experiment state   = proof observation reducer and state patch
executive decision = final same-or-safer public stance and proof policy
governor           = selected next intent and autonomy boundary
```

Status is intentionally conservative:

```txt
blocked        if any proof check blocks
needs-provider if OpenAI/provider/memory/proof gaps remain or any check watches
ready-shadow   only when checks pass and OpenAI/provider gates are configured
```

The proof checks are:

```txt
loop-complete              = seven cognitive stages are present
deliberation-panel         = role panel and decision questions exist
control-safety             = persistence, publish, train, trust raise, and public upgrade are false
openai-gate                = OpenAI review is configured, otherwise watch
memory-audit-only          = memory can audit but cannot raise trust
experiment-no-side-effects = experiment reducer cannot ask AI, persist, publish, train, or raise trust
executive-boundary         = governor and executive agree on a supervised read-only boundary
```

The reducer exposes a proof hash, stage/check counts, the selected next bounded move, and links back to the underlying proof routes. It is useful for proving that the engine thinks through a slate without pretending provider data, Supabase memory, or OpenAI review are already production-ready.

The deterministic self-test also summarizes the evidence graph and thinking introspection receipts. `/api/sports/decision/self-test` reports their hashes, counts, focus, proof URLs, and no-write/no-publish/no-train/no-trust-raise controls so one health route can prove the public thinking stack is present without making an OpenAI call.

## 5.33.8 AI Context Dossier

The AI context dossier is the model-review input packet. It does not decide a pick by itself; it makes the exact review context inspectable before any OpenAI call:

```txt
target     = highest-pressure active decision from ensemble/ranking
model      = model version, expected score, base/posterior probabilities
market     = no-vig probability, edge, EV, margin, market movement
data       = coverage score, mock/missing/stale signals, next provider task
training   = feature readiness, governance status, real fixture count
agent      = ensemble action, cognitive-loop status, next safe operation
```

AI readiness is a bounded score:

```txt
readiness =
  0.24 * decision_score
  + 0.22 * data_coverage_score
  + 0.16 * actionability_score
  + 0.14 * (100 - uncertainty_score)
  + 0.12 * feature_training_ready_score
  + 0.12 * governance_trust_score
  - hard_gate_penalties
```

The dossier evidence IDs become the only IDs the reviewer may cite. The request preview uses strict JSON schema and keeps these permissions invariant:

```txt
store = false
canPersist = false
canPublish = false
canTrain = false
canUpgradePublicAction = false
```

When `run=1` is requested, the route submits the strict dossier payload to the configured OpenAI Responses model. The returned review is accepted only when it matches the schema, keeps `publishPermission`, `persistencePermission`, and `trainingPermission` at `never`, and cites evidence IDs that exist in the dossier. Missing keys, provider errors, invalid JSON, or unsupported citations fall back to the deterministic review, which can agree, request more evidence, downgrade, or block, but still cannot write state, publish a pick, train, or upgrade a public action.

That makes the AI layer less magical: the model sees one public, replayable context bundle rather than scattered UI state or hidden assumptions.

## 5.33.7.1 AI Review Readiness

The AI review readiness layer is a no-call contract check over the OpenAI reviewer lanes and links the public cognitive proof receipt. It does not ask a model, train, persist, publish, or fetch providers. It answers whether the existing review routes are ready to be requested later through explicit `run=1`:

The decision evidence graph is the slate-level connective proof between deterministic match reasoning and the agent proof stack. It links:

```text
objective -> slate-thinking -> match reasoning nodes -> action boundary
```

When the deep decision lab has already computed them, the graph also attaches trace-ledger, world-model, and cognitive-proof nodes. The graph can select the next read-only observation, but it cannot persist, publish, train, raise trust, or upgrade public action.

The thinking introspection audit wraps the public thinking stack into one self-check:

```text
slate thinking -> working memory -> reflection -> rehearsal -> evidence graph
```

It selects the weakest layer, states the current belief and primary doubt, and exposes one safe proof command. The audit is not hidden chain-of-thought; it is a public inspection receipt and cannot persist, publish, train, raise trust, or upgrade public action.

```txt
lanes =
  operator-reasoning -> OddsPadiOperatorAIReasoningReview
  context-dossier    -> OddsPadiAIContextDossierReview
  decision-session   -> OddsPadiAISessionReview
  executive-review   -> OddsPadiAIExecutiveReview
```

Each lane must keep the same invariants as the live reviewer payload:

```txt
store = false
deterministicFallback = true
canPersist = false
canPublish = false
canTrain = false
canUpgradePublicAction = false
canRaiseTrust = false
```

Readiness is intentionally conservative:

```txt
ready-to-run if OPENAI_API_KEY exists and every lane contract is ready
needs-key    if the contracts are wired but OPENAI_API_KEY is missing
blocked      if any lane loses a required contract invariant
```

This gives the operator a concrete answer for why the AI reviewer is or is not live without exposing secrets or making an accidental provider call.

## 5.33.8 AI Decision Session

The AI decision session is the combined no-write thinking pass over the current slate. It does not replace authority; it composes the strongest review lanes and lowers the action when any lane demands more caution:

```txt
session_action =
  min_by_action_rank(
    authority_action,
    slate_council_action,
    context_review_action,
    operator_reasoning_action
  )

action_rank:
  avoid   = 0
  monitor = 1
  consider = 2
```

Context review maps `block -> avoid`, `downgrade/needs-evidence -> monitor`, and `agree -> target baseline`. Operator reasoning maps `block/repair -> avoid` and `hold/advance-read-only -> monitor`. That means the combined AI session can only preserve or lower the product action; it cannot upgrade a weak or blocked decision.

The route `/api/sports/decision/ai-decision-session?run=1` requests the configured context, reasoning, and council review lanes together, then returns:

```txt
sessionHash
activeDecision
runs[]        = context dossier, operator reasoning, slate council
trace[]       = observe, model, market, data, challenge, decide, verify, learn
metareasoning = consensus, evidence debt, contradictions, action pressure, trust ceiling
evidencePacket = active decision, controls, blockers, runs, trace, and thought evidence IDs
review        = top-level strict Responses API session critique or deterministic fallback
controls      = no persist, no publish, no train, no public-action upgrade
```

The metareasoning scorecard turns the session from a merger into a bounded thinking loop:

```txt
consensus_score =
  clamp((lanes_matching_session_action / total_lanes) * 100
        - 8 * blocked_trace_phases
        - 12 * invalid_or_provider_error_runs, 0, 100)

evidence_debt =
  clamp(
    16 * launch_blocks
  +  5 * launch_watches
  +  8 * missing_data_signals
  +  4 * mock_signals
  +  6 * stale_signals
  +  3 * missing_env_keys
  +  5 * ai_readiness_blockers
  +  4 * session_blockers
  +  review_run_penalties
  +  authority_block_penalty
  +  openai_missing_penalty,
  0, 100)

contradiction_count =
  action_lane_spread
  + blocked_trace_phases
  + invalid_or_provider_error_runs
  + authority_downgrade_pressure
```

The trust ceiling is deliberately conservative:

```txt
none      when authority is blocked, launch audit blocks, trace blocks, or session_action = avoid
shadow    when OpenAI review is not configured or no review lane has returned reviewed
monitor   when reviewed lanes exist but the session action is monitor
candidate when reviewed lanes exist and the session action remains consider
```

`canAdvanceReadOnly` can only become true when metareasoning is `ready-shadow`, the trust ceiling is not `none`, and the selected next command is a safe local `GET` proof command. It still does not allow persistence, publishing, training, or public-action upgrades.

When the route runs the top-level session reviewer, the model receives only the session evidence packet and output rules:

```txt
allowed_evidence_ids = evidencePacket[].id
current_session_action = activeDecision.sessionAction
action_rank = avoid:0, monitor:1, consider:2
```

The accepted review must satisfy:

```txt
recommended_action =
  min_by_action_rank(current_session_action, model_recommended_action)

publishPermission = never
persistencePermission = never
trainingPermission = never
publicActionUpgradePermission = never
```

Evidence findings that cite IDs outside `allowed_evidence_ids` are discarded. If the model is missing, the provider fails, JSON is invalid, schema validation fails, or all evidence findings are unsupported, the deterministic fallback review is used. This makes the top-level AI review a critic of the current decision session, not a hidden authority that can invent data or promote a pick.

## 5.33.9 AI Deliberation Packet

The deliberation packet is the public reasoning surface above the AI session. It does not expose hidden chain-of-thought. It converts the session and shadow evaluation into a concise decision debate:

```txt
deliberation_input =
  ai_decision_session
  + ai_session_shadow_evaluation
```

The panel uses six public roles:

```txt
model-chair      = model trace and posterior-quality case
market-skeptic   = no-vig edge, EV, and market refresh case
data-steward     = provider-backed, mock, stale, and missing signal case
safety-reviewer  = metareasoning, trust ceiling, controls, and blockers
operator         = top-level session-review gate
learning-analyst = outcome, calibration, backtest, corpus, and training gates
```

Each role takes one same-or-safer position:

```txt
pass  -> current session action may remain
watch -> monitor
block -> avoid
```

The deliberation also pre-registers four hypotheses:

```txt
value-thesis         = model + market + data still imply value
review-thesis        = AI reviewer can critique only supplied evidence
learning-thesis      = the session can be graded later
public-action-thesis = the public action can rise above avoid
```

Hypothesis score is the average mapped role/gate score plus small modifiers:

```txt
pass  = 100
watch = 56
block = 14

hypothesis_score = clamp(average(status_scores) + modifier, 0, 100)

hypothesis_status =
  pass  when score >= 72
  watch when 38 <= score < 72
  block when score < 38
```

The overall deliberation stays conservative:

```txt
blocked =
  session_action = avoid
  OR shadow_evaluation = blocked
  OR any panel role blocks
  OR any hypothesis blocks

needs-proof =
  any panel role watches
  OR any hypothesis watches
  OR shadow_evaluation = waiting

ready-shadow =
  no blocks and no watches
```

Final stance is always same-or-safer:

```txt
avoid           = blocked OR session_action = avoid
monitor-shadow  = needs-proof
consider-shadow = ready-shadow AND panel action remains consider
```

Hard controls remain invariant:

```txt
canPersist = false
canPublish = false
canTrain = false
canUpgradePublicAction = false
canUseHiddenChainOfThought = false
```

This lets the product say what the agent thinks in public terms: thesis, counter-thesis, falsifiers, missing evidence, next proof, and a final safe stance.

## 5.33.10 AI Control Packet

The control packet turns deliberation into an executable control state. It does not run shell commands and it does not write data. It chooses the safest next move from four already-auditable sources:

```txt
control_input =
  ai_deliberation
  + agent_runtime
  + capability_contract
  + operator_turn
```

Move selection prefers the first runnable option in this order:

```txt
operator_turn.nextOperation
agent_runtime.nextCommand
capability_contract.nextSafeCommand
ai_deliberation.nextProof
```

Every command is classified before it can be shown as runnable:

```txt
read-only   = curl.exe GET-style command with no persist, publish, write, or dryRun=0 flags
dry-run     = curl.exe POST command only when dryRun=1 or dryRun=true is present
manual-only = missing command, non-curl command, write command, publish/persist command, or unsafe POST
```

Placeholder secrets such as `<ODDSPADI_ADMIN_TOKEN>` make the move held even when the run mode is otherwise safe:

```txt
canRunNow =
  command exists
  AND runMode in { read-only, dry-run }
  AND missingEnv.length = 0
```

The control stages are:

```txt
sense       = runtime state and selected runtime command
deliberate  = public deliberation stance and next proof
authorize   = capability contract and live-readiness gates
execute     = chosen bounded move and missing env
verify      = operator-turn receipt criteria
learn       = training lock and learning readiness
```

Overall status remains same-or-safer:

```txt
live-ready      = capability + runtime live-ready and deliberation ready-shadow
ready-ai-review = runtime may ask OpenAI and operator turn is review-ready
ready-readonly  = next move can run now in read-only mode
manual-proof    = a dry-run/read-only/manual proof path exists but needs operator/config proof
blocked         = no safe move can advance
```

Hard controls are invariant:

```txt
canPersist = false
canPublish = false
canTrain = false
canUpgradePublicAction = false
```

This is the layer that prevents the agent from confusing "I have a theory" with "I may act." It must name the bounded move, why it is held or runnable, which evidence would unlock it, and which actions remain forbidden.

## 5.33.11 AI Thought Episode

The thought episode is the private audit/replay packet for one AI control state. It is not hidden chain-of-thought and it is not a public recommendation. It compresses the AI control packet and the operator episode into auditable public steps:

```txt
thought_episode_input =
  ai_control_packet
  + operator_episode
```

The thought chain has six steps:

```txt
observe    = current control state and selected proof move
challenge  = blocked/watch stages and forbidden actions
decide     = same-or-safer public action and trust ceiling
authorize  = run-mode classification and missing env
replay     = safe proof replay commands and receipt hash
store      = private memory draft gate
```

The private payload hash is computed from compact control, operator, thought-chain, forbidden-action, and proof-URL snapshots:

```txt
payloadHash = stableHash(compact_private_trace)
thoughtHash = stableHash(date, sport, controlHash, operatorEpisodeHash, payloadHash, persistenceStatus)
```

`GET /api/sports/decision/ai-thought-episode` is read-only. `POST /api/sports/decision/ai-thought-episode` may store only the private trace when all write gates are true:

```txt
canStorePrivateTrace =
  ODDSPADI_ADMIN_TOKEN header matches
  AND Supabase server writes target OddsPadi project wncwtzqipnoqwmqlznqn
  AND op_ai_thought_episodes exists
  AND control/operator state is not blocked
```

The storage table is `op_ai_thought_episodes`. It keeps RLS enabled, revokes `anon` and `authenticated`, and grants writes only to `service_role`. Storing a thought episode does not change the public pick and does not unlock learning:

```txt
canPublish = false
canTrain = false
canUpgradePublicAction = false
```

This gives the agent memory scaffolding without pretending that memory equals truth. Later calibration can compare stored thought episodes against settled outcomes, but learned guardrails stay inactive until outcome, backtest, corpus, and governance gates clear.

## 5.33.12 AI Thought Memory

The thought-memory layer is private recall over `op_ai_thought_episodes`. It asks whether the current control state resembles stored private thought episodes, then returns audit-only lessons.

```txt
thought_memory_input =
  current_thought_episode
  + recent op_ai_thought_episodes rows
```

Similarity is bounded to `0..1` and combines:

```txt
same thought hash          +0.20
same control hash          +0.18
same operator episode      +0.12
same active match          +0.18
same public action         +0.10
same public posture        +0.06
same run mode              +0.10
similar stage blocks       up to +0.12
similar replay count       up to +0.06
publish/train both locked  +0.08
```

Only episodes with similarity at or above `0.35` are returned as similar memory. The recall recommendation is deliberately one-way safe:

```txt
no memory / not configured -> capture-current-trace, influence none
similar avoid or blockers  -> hold-public-action, influence reduce-trust
otherwise similar memory   -> replay-similar-proof, influence audit-only
```

Hard controls stay locked:

```txt
canRaiseTrust = false
canPublish = false
canTrain = false
canUpgradePublicAction = false
```

This gives the AI a usable memory sense without letting memory become authority. A similar past thought can tell the agent which proof to replay or why to stay cautious; it cannot make a public pick stronger.

## 5.33.13 AI Experiment Planner

The experiment planner chooses exactly one bounded proof experiment after the AI control packet, private thought episode, and thought memory are available. It does not run shell commands, ask OpenAI, write Supabase rows, publish picks, or train models.

```txt
experiment_planner_input =
  ai_control_packet
  + ai_thought_episode
  + ai_thought_memory
```

Candidate experiments come from four safe sources:

```txt
thought_memory.recommendation = hold-public-action -> replay memory blockers
thought_memory.recommendation = replay-similar-proof -> replay similar proof
thought_memory.recommendation = capture-current-trace -> capture current thought trace
ai_control.nextMove -> selected bounded control proof
ai_thought_episode.replay.commands -> safe read-only replay command
ai_session_shadow_evaluation -> no-write learning-readiness check
```

The planner ranks candidates by one-way safety:

```txt
read-only and runnable     highest priority
dry-run and runnable       manual proof priority
non-manual no missing env  fallback priority
manual-only or missing env held
```

Status is deliberately conservative:

```txt
memory unavailable                    -> needs-memory
selected read-only and runnable       -> ready-readonly
selected dry-run or manual proof path -> manual-proof
no bounded experiment                 -> blocked
```

Every candidate must state:

```txt
objective
hypothesis
falsifier
command or verification route
expected evidence
run mode
missing env
risk
source
```

Hard controls stay locked:

```txt
canAskOpenAI = false
canPersist = false
canPublish = false
canTrain = false
canRaiseTrust = false
canUpgradePublicAction = false
```

This gives the AI a real experimental next step without letting the planner become an executor. The output can tell an operator which read-only proof to run and why, but it cannot change trust, public action, persistence, or training state.

## 5.33.14 AI Experiment Observer

The experiment observer turns the selected experiment into a no-write receipt. It does not execute shell commands. It fetches only an approved local GET proof URL when `run=1` is requested.

```txt
experiment_observer_input =
  ai_experiment_planner
  + optional selected local GET proof response
```

Target approval is conservative:

```txt
selected experiment exists
canRunNow = true
runMode != manual-only
verifyUrl is local localhost/127.0.0.1 or path
path starts with /api/sports/decision/
path is not /api/sports/decision/ai-experiment-observer
query does not include persist, publish, review, agent, enhance, or unsafe dry-run flags
```

Observation status is derived from the target and response:

```txt
target not allowed       -> blocked
run not requested        -> not-run
fetch attempted + 2xx    -> observed
fetch attempted + success=false -> observed-warning
fetch error or non-2xx   -> failed
```

The receipt records:

```txt
target path
HTTP status
content type
body byte count
response hash
success flag
status label
summary
signals
```

Hard controls stay locked:

```txt
canExecuteShell = false
canAskOpenAI = false
canPersist = false
canPublish = false
canTrain = false
canRaiseTrust = false
canUpgradePublicAction = false
```

This closes the first safe plan-observe receipt. The AI can now choose a bounded experiment and observe its proof receipt, but the receipt must still pass through a same-or-safer reducer before it affects state.

## 5.33.15 AI Experiment State Reducer

The experiment state reducer converts the planner plus observer receipt into a conservative state patch. It is the first local plan-observe-reduce loop for the AI experiment path.

```txt
experiment_state_input =
  ai_experiment_planner
  + ai_experiment_observer
```

State status is derived from the observer:

```txt
observer not run                         -> pending-observation
observer blocked                         -> blocked
observer failed or observed-warning      -> retry-experiment
observer observed with watch pressure    -> hold-trust
observer observed without watch pressure -> proof-observed
```

Watch pressure is triggered by visible blocker, waiting, memory-failed, needs-data, or locked-state signals. This makes the reducer conservative when a proof route responds successfully but still says the engine is not ready.

The patch is one-way:

```txt
proof-observed       -> record-shadow-proof, trust hold, confidence keep-capped
pending-observation  -> observe-proof, trust hold, confidence keep-capped
retry-experiment     -> retry-proof, trust reduce, confidence cap-low
hold-trust           -> hold, trust hold, confidence keep-capped
blocked              -> reduce-trust, trust reduce, confidence cap-low
```

Hard controls stay locked:

```txt
mayAskAI = false
mayPersist = false
mayPublish = false
mayTrain = false
mayRaiseTrust = false
publicAction = no-upgrade
memory = draft-only
```

The reducer can produce a memory draft, but the draft is not persisted. It can record a shadow proof only when the observer produced a clean response without watch pressure. A single experiment receipt can never raise trust; it can only keep the current state capped, request another proof, or reduce trust.

## 5.33.16 AI Experiment Episode

The experiment episode is the replayable record of one local AI experiment loop.

```txt
experiment_episode_input =
  ai_experiment_observer
  + ai_experiment_state
```

It emits a five-step timeline:

```txt
plan    = selected experiment, hypothesis, and expected evidence
observe = target approval, response hash, and status signal
reduce  = state patch and gate result
memory  = draft-only memory note
next    = next safe read-only experiment command
```

When `run=1` is requested, the episode route can stabilize the observer receipt:

```txt
if observer.status in {failed, observed-warning}
or observer.requested = true and response_hash is missing:
  wait briefly
  repeat the same approved local GET observer once
  select the attempt with the strongest status/hash score

if the observed replay exceeds the bounded timeout:
  fetch the approved no-run observer receipt
  return ready-to-observe with stability reason = observer-timeout fallback
```

The stability packet records:

```txt
attempts
selected_attempt
selected_observer_hash
selected_response_hash
observed_statuses
reason
can_retry_again
can_raise_trust = false
```

Episode status is derived from the state reducer:

```txt
pending-observation -> ready-to-observe
proof-observed      -> shadow-recorded
hold-trust          -> hold-trust
retry-experiment    -> retry-experiment
blocked             -> blocked
```

The final patch is still one-way:

```txt
canPersist = false
canPublish = false
canTrain = false
canRaiseTrust = false
```

This gives the AI a replayable local memory object: it can say what it planned, what it observed, how it reduced the state, what risk remains, and what proof should run next. It still cannot make the public decision stronger or write to Supabase.

## 5.33.16a AI Executive Decision Reducer

The executive reducer is the top-level no-write decision layer for one AI turn. It takes the full thinking stack and reduces it to one public stance, one same-or-safer action, one selected proof command, and one set of locks.

```txt
ai_executive_input =
  decision_mind
  + ai_cognitive_loop
  + ai_decision_session
  + ai_deliberation
  + ai_control_packet
  + ai_experiment_episode
  + capability_contract
  + supabase_project_isolation
```

The reducer always walks seven phases:

```txt
observe    = active mind and current belief pressure
orient     = session metareasoning, evidence debt, and contradictions
deliberate = public debate stance and next proof
decide     = control packet and escalation reason
act        = selected bounded read-only or dry-run proof
verify     = experiment episode and stability result
remember   = draft-only memory state gated by OddsPadi Supabase isolation
```

It also keeps a conflict register:

```txt
stance-vs-authority
metareasoning-pressure
capability-lock
experiment-proof
database-memory
control-side-effects
```

The executive also produces a strict review packet:

```txt
executive_review_packet =
  executive_summary
  + active_decision
  + lane_states
  + phases
  + conflicts
  + final_directive
  + controls
  + evidence_packet
  + output_rules
```

When `run=1` is requested, the OpenAI reviewer can only return:

```txt
reviewVerdict in {agree, downgrade, needs-evidence, repair, block}
recommendedAction <= current_executive_action
recommendedDirective <= current_directive
publishPermission = never
persistencePermission = never
trainingPermission = never
publicActionUpgradePermission = never
```

If the key is missing, the provider fails, or the response does not match the strict schema, the deterministic fallback review is used.

The executive action is same-or-safer across authority, session, and public deliberation:

```txt
if any input action = avoid   -> executive_action = avoid
else if any input = monitor   -> executive_action = monitor
else                          -> executive_action = consider
```

The selected command is deliberately bounded:

```txt
prefer safe read-only curl proof
else safe explicit dry-run proof
else non-manual verification route
else hold/manual-only
```

Hard controls stay locked:

```txt
canPersist = false
canPublish = false
canTrain = false
canRaiseTrust = false
canUpgradePublicAction = false
memoryDraft.canPersist = false
```

This is the agent's executive function for the MVP: it can decide what proof should happen next and explain the blockers, but it cannot create a pick, write memory, train, publish, stake, or upgrade a public action.

## 5.33.17 AI Session Shadow Evaluation

The shadow evaluator grades whether a completed AI decision session is ready to become a learning candidate. It is not a trainer and it does not write outcome rows. It joins four already-auditable artifacts:

```txt
shadow_input =
  ai_decision_session
  + learning_queue
  + calibration_snapshot
  + historical_training_snapshot
```

The evaluator has six gates:

```txt
session_review       = top-level AI session review status and evidence debt
outcome_ticket       = pending or settled outcome record availability
calibration          = settled sample size and Brier score availability
historical_backtest  = latest real-data backtest sample and metrics
real_corpus          = real finished fixtures plus real odds snapshots
learning_permission  = final no-train permission check
```

Each gate scores `0..100` and maps to `pass`, `watch`, or `block`:

```txt
pass  = score >= 72
watch = 38 <= score < 72
block = score < 38
```

The readiness score is the gate average minus penalties for evidence debt, contradictions, and forced avoid actions:

```txt
learning_readiness_score =
  clamp(
    average(gate_scores)
    - min(24, session_evidence_debt * 0.18)
    - min(18, session_contradictions * 3)
    - action_penalty,
    0,
    100
  )

action_penalty =
  10 when session_action = avoid
   4 when session_action = monitor
   0 when session_action = consider
```

The status remains conservative:

```txt
blocked      = session_action = avoid OR any gate blocks OR score < 35
waiting      = any gate watches OR score < 75
ready-shadow = all gates pass and score >= 75
```

Even when `ready-shadow`, hard controls remain false:

```txt
canPersist = false
canPublish = false
canTrain = false
canOpenOutcome = false
canApplyLearnedGuardrails = false
```

The output also includes a shadow grade plan. It records the active selection, the settlement market when available, success criteria, failure criteria, safe proof URLs, and the next learning task from the queue. This makes the system capable of saying, "we can observe and later grade this session," without pretending it is already safe to learn from it or publish it.

## 5.34 Working Memory Blackboard

The working-memory blackboard is the shared short-term memory for the slate. It converts match decisions and the slate-thinking queue into public cells:

```txt
fact
assumption
doubt
blocker
next-action
learning
guardrail
```

The status is conservative:

```txt
blocked        = any blocker cell exists, or no cells exist
needs-evidence = any doubt, assumption, or next-action cell exists
ready          = facts and guardrails exist without blockers or open evidence items
```

The blackboard does not promote a selection. It only focuses attention:

```txt
focus = slateThinking.nextThought
currentBelief = first fact cell
primaryDoubt = first doubt cell
decisiveUnknown = first next-action or assumption cell
safestNextAction = focus.nextEvidenceAction
```

Hard locks remain:

```txt
canPromote = false
canPersist = false
canPublish = false
canTrain = false
```

## 5.35 Reflection Layer

The reflection layer is the red-team pass over working memory. It does not create new picks. It asks whether the current slate is trying to trust itself too early.

It scores seven risk classes:

```txt
overconfidence
data-gap
action-drift
memory-gap
market-fragility
provider-missing
guardrail-lock
```

The status is conservative:

```txt
blocked  = any reflection item blocks
watching = no block, but at least one watch item exists
clear    = every item passes
```

The score is an operator-facing trust budget:

```txt
score = 100
  - block_items * 12
  - watch_items * 5
  - blocker_cells * 4
  - assumption_cells * 2
  - doubt_cells * 2
```

The score is bounded from 0 to 100. The next reflection item becomes the first block item, then the first watch item, then the first pass item. This gives the agent one question to answer before trust can rise.

Hard locks remain:

```txt
canPromote = false
canPersist = false
canPublish = false
canTrain = false
```

## 5.36 Decision Rehearsal

Decision rehearsal converts the top reflection item into a simulated next proof turn. It does not execute writes or promote picks. It gives the agent an explicit next turn before any trust change:

```txt
observe  = load the active doubt and current belief
challenge = run the targeted read-only proof route
verify   = check authority and same-or-safer posture
revise   = update belief only after proof
learn    = keep storage/training queued until trusted
```

The rehearsal status is:

```txt
blocked     = reflection or working memory is blocked
needs-proof = reflection is watching or working memory needs evidence
ready       = no open reflection or working-memory evidence item owns the slate
```

Risk routes are deterministic:

```txt
guardrail-lock   -> /api/sports/decision/authority
action-drift     -> focused match decision
data-gap         -> /api/sports/decision/data-intake
provider-missing -> /api/sports/decision/data-intake
market-fragility -> /api/sports/decision/counterfactual-lab
memory-gap       -> /api/sports/decision/memory
overconfidence   -> /api/sports/decision/model-ensemble
```

The only executable command it exposes is a read-only `curl.exe -sS` proof command. Commands containing `persist=1` or `dryRun=0` are not considered safe rehearsal commands.

Hard locks remain:

```txt
canPromote = false
canPersist = false
canPublish = false
canTrain = false
```

## 5.37 Multi-Sport Thinking

Multi-sport thinking runs the attention stack across the three active sports:

```txt
football
basketball
tennis
```

For each sport it builds:

```txt
slateThinking
workingMemory
reflection
rehearsal
```

Then it records:

```txt
match count
positive value candidates
monitor and avoid counts
average data quality
model versions
learning profile status
blocker and watch pressure
next read-only proof command
```

The sport status is:

```txt
blocked     = no matches, blocked reflection, blocked rehearsal, or blocked working memory
needs-proof = watching reflection, needs-proof rehearsal, or open working-memory evidence
ready       = no blocking or proof-needed state
```

Priority is intentionally conservative:

```txt
priority = status_weight
  + blocker_count * 5
  + watch_count * 2
  + value_candidates * 3
  + learning_inactive_weight
  + data_quality_penalty
```

This lets basketball or tennis own the next proof turn even while the detailed dashboard still shows the deeper football workspace.

Hard locks remain:

```txt
canPromote = false
canPersist = false
canPublish = false
canTrain = false
```

## 5.38 Cross-Sport Odds Board

The odds board is a slate-level value ranking across football, basketball, and tennis. It does not create new probabilities; it consumes each decision's audited market selections:

```txt
selection_audit = {
  decimal_odds,
  raw_implied_probability,
  no_vig_implied_probability,
  bookmaker_margin,
  model_probability,
  fair_odds,
  edge,
  expected_value,
  action
}
```

For every selection:

```txt
raw_implied_probability = 1 / decimal_odds
no_vig_implied_probability = raw_implied_probability / sum(raw_implied_probabilities_in_market)
bookmaker_margin = sum(raw_implied_probabilities_in_market) - 1
edge = model_probability - no_vig_implied_probability
expected_value = model_probability * decimal_odds - 1
fair_odds = 1 / model_probability
```

The board score is intentionally not a bet trigger. It ranks attention:

```txt
value_score =
  action_weight
  + max(0, expected_value) * 95
  + max(0, edge) * 75
  + data_quality_score * 0.18
  + confidence_weight
  - risk_penalty
  - control_policy_penalty
  - actionability_penalty
  - learning_inactive_penalty
```

Status is conservative:

```txt
value-found = at least one value selection with positive EV
watchlist   = no value selection, but a watch or positive edge exists
blocked     = no priced selections or only avoid/no-value rows
```

Every row must explain:

- why the model likes or rejects the selection
- the raw and no-vig implied probability comparison
- expected value and edge
- bookmaker margin
- market, control, and actionability risks
- safer alternative
- avoid reason where applicable
- read-only proof URL

Hard locks remain:

```txt
canPromote = false
canPersist = false
canPublish = false
canTrain = false
```

## 5.39 Odds Intelligence Proof

The odds-intelligence proof is the audit bridge between the value board and any downstream portfolio-risk math. It consumes the odds-board selections and reprints the money-feature calculation in a compact, route-testable packet:

```txt
proof_row = {
  decimal_odds,
  implied_probability,
  no_vig_probability,
  model_probability,
  edge,
  expected_value,
  bookmaker_margin,
  fair_odds,
  risk,
  safer_alternative,
  avoid_reason
}
```

The proof checks are deliberately mechanical:

```txt
implied-probability       = every priced row has 1 / decimal_odds
no-vig-margin-removal    = market implied probabilities are normalized before edge
model-vs-market-edge     = edge = model_probability - no_vig_probability
expected-value           = expected_value = model_probability * decimal_odds - 1
risk-and-alternatives    = rows include risk notes plus safer alternatives or avoid reasons
no-publish-lock          = stake, publish, persist, train, and upgrade controls are false
```

Status is conservative:

```txt
ready-proof = selections exist, proof checks pass, and at least one positive-value row exists
watch       = selections exist but only partial value signals are present
blocked     = priced selections or required proof checks are missing
```

The proof can explain why the model favors a selection, what risks remain, which alternatives are safer, and why a row should be avoided. It cannot place, publish, persist, train, or upgrade anything:

```txt
canInspectReadOnly = true
canPersist = false
canPublish = false
canTrain = false
canStake = false
canUpgradePublicAction = false
```

## 5.39.1 Adversarial Decision Panel

The adversarial panel is the final deterministic challenge layer before a value candidate can even remain on the watchlist. It composes:

```txt
model_ensemble
odds_intelligence_proof
evidence_graph
```

For each candidate, six reviewers vote:

```txt
model-advocate  = ensemble score, base action, and model consensus
market-skeptic  = no-vig edge, expected value, market margin, avoid reason
data-skeptic    = data coverage score and hard blockers
risk-manager    = robustness, uncertainty, conflict, and blocker text
evidence-auditor = match-level evidence graph nodes
final-arbiter   = conservative synthesis of the first five reviewers
```

The panel action is intentionally conservative:

```txt
avoid    if any reviewer blocks
consider if support >= 5, opposition == 0, and the base action is consider
monitor  if support >= 3 and opposition <= 1
avoid    otherwise
```

The receipt carries support/watch/oppose/block counts, safer alternatives, avoid reasons, evidence-node counts, and a stable panel hash. It does not expose hidden chain-of-thought and cannot publish, stake, persist, train, or upgrade public action.

## 5.39.2 Decision Briefing

The decision briefing is the operator-facing synthesis layer. It does not introduce a new probability model; it reduces existing proof receipts into one readable answer:

```txt
briefing_inputs =
  model_math_proof
  odds_intelligence_proof
  adversarial_panel
  openai_key_diagnostic
```

The brief emits:

```txt
headline
posture
action
target match/selection
model probability
market probability
posterior probability
edge
expected value
thesis
counter-thesis
decision
risks
safer alternatives
next evidence
proof chain
```

Status is conservative:

```txt
no-candidates     = no panel case exists
blocked           = the top panel case is blocked
needs-review      = the panel is watch-only or OpenAI live review is not ready
ready-watchlist   = the panel clears the case and OpenAI review gate is ready
```

Even `ready-watchlist` remains monitor-only. The briefing can lower or hold posture, but it cannot call OpenAI, publish, stake, persist, train, or upgrade public action.

Persistence is separate from the read-only brief. The local migration `op_decision_briefings` stores a compact server-only audit row:

```txt
briefing_hash
status
posture
action
target match/selection
model/market/posterior probabilities
edge
expected value
headline
thesis
counter_thesis
decision
risks
safer_alternatives
next_evidence
proof_chain
payload
```

The table revokes `anon` and `authenticated`, grants only `service_role`, and enables RLS. `/api/sports/decision/briefing` only attempts the write on `POST` with `ODDSPADI_ADMIN_TOKEN`; `GET` is always read-only.

## 5.40 Paper Portfolio Risk

Portfolio risk starts after the odds board. It does not create a betting instruction. It measures paper exposure pressure when multiple positive-EV candidates appear at the same time.

For decimal odds:

```txt
net_odds = decimal_odds - 1
kelly_fraction = ((net_odds * model_probability) - (1 - model_probability)) / net_odds
paper_kelly_fraction = max(0, kelly_fraction) * 0.25
```

The agent then applies conservative haircuts:

```txt
adjusted_kelly =
  paper_kelly_fraction
  * confidence_multiplier
  * risk_multiplier
  * control_policy_multiplier
  * actionability_multiplier
  * data_quality_multiplier
```

Paper units use a 100-unit imaginary bankroll:

```txt
raw_paper_units = 100 * adjusted_kelly
suggested_paper_units = min(
  raw_paper_units,
  max_candidate_units,
  remaining_sport_cap,
  remaining_market_cap,
  remaining_match_cap
)
```

Default caps:

```txt
max_candidate_units = 1.00
max_sport_units     = 2.50
max_market_units    = 2.00
max_match_units     = 1.25
```

Candidates are excluded or watched when:

- board action is not value
- EV or edge is not positive
- confidence is low
- the paper unit estimate falls below the visible minimum

Blocked control policy or actionability does not erase the paper simulation. It applies a heavy haircut and cap reason, while the hard no-stake/no-promote/no-publish locks remain active.

Hard locks remain:

```txt
canStake = false
canPromote = false
canPersist = false
canPublish = false
canTrain = false
```

## 5.40 Model Trust Governor

Model trust is the confidence governor after governance, odds-board, and portfolio-risk checks. It asks whether the model has earned the right to trust its own probabilities.

Inputs:

```txt
model_governance
calibration_snapshot
historical_training_snapshot
odds_board
portfolio_risk
runtime_storage_state
```

Calibration sample score:

```txt
calibration_sample_score = min(100, settled_outcomes / 30 * 100)
```

Calibration accuracy score:

```txt
calibration_accuracy_score = 100 - brier_score * 220
```

Historical corpus score:

```txt
corpus_score =
  min(55, real_finished_fixtures / minimum_recommended_fixtures * 55)
  + min(25, real_odds_snapshots / (real_finished_fixtures * 2) * 25)
  + backtest_score
```

Market quality score:

```txt
market_score =
  margin_score * 0.65
  + value_selection_ratio * 0.35
  - avoid_selection_ratio * 30
```

Portfolio pressure score:

```txt
portfolio_score =
  100
  - risk_budget_used * 600
  - capped_candidate_ratio * 35
```

The final trust score is the average of governance, calibration, corpus, market, portfolio, and runtime gates:

```txt
trust_score = average(gate_scores)
```

Status:

```txt
blocked         = calibration, training, or runtime gate blocks
trusted-shadow  = score >= 75 and no gate blocks
needs-evidence  = any other state
```

Confidence cap:

```txt
low    = blocked or score < 45
medium = score < 80
high   = score >= 80
```

Hard locks remain:

```txt
canRaiseConfidence = false
canUseLearnedWeights = false
canStake = false
canPersist = false
canPublish = false
canTrain = false
```

## 5.41 Signal Reliability

Signal reliability is the slate-level freshness board for the requested data layer:

```txt
fixtures
historical results
standings
home/away performance
recent form
injuries
suspensions
lineups
odds
live scores
match events
news
weather
training corpus
```

Each match already produces data-coverage signals. The reliability layer groups those signals by feed and combines:

```txt
status_score:
  provider-backed or not-applicable = 100
  computed                         = 74
  mock                             = 42
  stale                            = 20
  missing                          = 0

freshness_score:
  current        = 100
  pre-match      = 82
  historical     = 78
  mock           = 36
  missing        = 0
  not-applicable = 100
```

Feed reliability:

```txt
reliability_score =
  weighted_status_score * 0.62
  + weighted_freshness_score * 0.23
  + provider_backed_ratio * 15
  - required_gap_count * 3
  - missing_env_count * 4
```

Feed status:

```txt
blocked  = required gaps with missing env, or score < 35
degraded = required gaps, missing/stale/mock evidence, or score < 75
usable   = score < 90
fresh    = score >= 90
```

Slate status:

```txt
blocked  = any feed blocked or average score < 45
degraded = any feed degraded or average score < 80
ready    = no blocked/degraded feed
```

Hard locks remain:

```txt
canRaiseTrust = false
canPromote = false
canPersist = false
canPublish = false
canTrain = false
```

## 5.42 Evidence Refresh Scheduler

The refresh scheduler turns weak evidence into the next proof queue. It consumes:

- signal reliability feed states
- data-intake provider tasks
- model-trust gates
- odds-board state
- portfolio concentration state

Task ranking is conservative:

```txt
ready proof tasks first
then blocked critical tasks
then waiting tasks
then lower-priority work
```

Within the same status, critical tasks outrank high, medium, and low tasks. Signal reliability and model-trust proof outrank lower-level board checks because they decide whether trust can rise.

Command safety:

```txt
read-only GET command  = safe proof command
POST with dryRun=1    = safe only when required env is configured
POST without dryRun=1 = blocked
persist=1 or dryRun=0 = blocked
```

The scheduler can expose expected evidence, missing environment keys, unlocks, and risk if skipped. It cannot mark evidence as received, write to Supabase, persist decisions, publish picks, or train models. Trust only changes when the verification routes change after real provider or schema proof.

Evidence refresh verification compares each scheduled task against current proof state:

```txt
verified       = current evidence satisfies the task condition
ready-to-check = command is safe, but proof has not changed yet
blocked        = missing env, unsafe command, or blocked scheduler task
waiting        = operator or external-provider state is still pending
```

The verifier can name the current evidence, expected evidence, next check, and missing keys. It still cannot raise trust. A model-trust or signal-reliability score can only improve when the underlying route recomputes from stronger provider, Supabase, calibration, odds, or portfolio evidence.

Evidence transition control chooses the next state after verification:

```txt
advance-ready = all visible proof gates pass; advance only to read-only shadow proof
retry-proof   = a safe read-only or dryRun=1 proof command can run now
hold          = proof is waiting on operator or external-provider state
blocked       = no safe command can clear the current proof blocker
```

The transition action is intentionally conservative:

```txt
advance      -> no confidence change, no write
retry-proof  -> rerun the named safe proof, keep trust capped
hold         -> wait without changing the decision state
reduce-trust -> cap confidence low until proof clears
```

The transition controller can expose a next command, pass/watch/block gates, and a verification URL. It cannot raise trust, write to Supabase, persist decisions, publish picks, or train models. Those changes only become legal when the underlying proof, provider, Supabase, and model-trust gates recompute to passing states.

Capability contract maps low-level proof to product capability levels:

```txt
active      = usable now as a live capability
shadow      = usable for inspection, but not live promotion
proof-ready = a safe proof command or manual proof step exists
locked      = missing keys, provider proof, Supabase proof, AI guardrails, or responsible controls
```

The contract produces a live-readiness score from these capability levels and chooses one next safe command from the evidence transition, runtime, or Supabase bootstrap layers. It is an operator contract, not a permission grant: persistence, publishing, write backfills, and training stay locked unless the dedicated lower-level gates explicitly open.

## 6. Confidence And Risk

Confidence is not just edge size. It also considers:

- value edge
- expected value
- model probability
- data quality

Low data quality reduces confidence. High odds with a weak edge do not automatically become high confidence.

Risk considers:

- confidence
- odds level
- sport variance
- missing context
- live-state risk

Before edge ranking, the context layer can apply bounded shifts:

```txt
sideShift = signalWeight * signalConfidence
adjustedProbability = normalize(baseProbability + sideShift)
```

Context signals can affect side markets, totals/tempo markets, and data quality. The MVP feed is marked as mock context when providers are absent; provider-backed football runtime can now replace parts of that feed with API-Football injuries, suspensions, lineups, standings, and live-event data, NewsAPI team-news scans, plus weather forecasts. Production should continue replacing the remaining mock rest/rotation and surface signals with provider-backed data.

The context-signal proof route audits that layer across the full active slate:

```txt
context_proof = {
  coverage_categories,
  provider_backed_count,
  computed_count,
  mock_count,
  missing_count,
  bounded_probability_shifts,
  risk_flags,
  required_provider_actions
}
```

Required coverage categories are:

```txt
fixtures, historical-results, standings, home-away, recent-form,
injuries, suspensions, lineups, odds, live-scores, match-events,
news, weather, training
```

Proof checks are conservative:

```txt
coverage-categories       = every requested data family is represented
probability-shifts        = context can show side/draw/total shifts before edge ranking
injury-news-risk          = injuries, suspensions, lineups, and news are separated
lineup-weather-live-gaps  = lineups, weather, live scores, and events expose gaps
provider-before-trust     = mock/missing production feeds block trust increases
no-action-upgrade         = context proof cannot persist, publish, train, raise trust, or upgrade action
```

After context signals, the market-prior layer can nudge priced selections toward the no-vig market probability before EV ranking. Its diagnostics report adjusted markets, selection count, average weight, and average bookmaker margin so stored decisions can later be backtested against closing-line value.

## 7. Agent Verdicts

The prediction agent can return:

- `value-found` - positive edge with high confidence
- `watchlist` - positive edge with medium confidence
- `no-clear-value` - no acceptable edge

The decision engine can also abstain with `avoid` or `insufficient-data`. The agent should never force a pick. If edge and expected value are not both positive with acceptable confidence, the product says `No clear value found`.

Each decision also carries a structured deliberation object. It turns the math into an auditable thesis loop:

- primary thesis: the selection or abstention the model is testing
- dissenting thesis: the strongest reason the market or missing context may be right instead
- hypotheses: value thesis, market counter-thesis, context-risk thesis, and final arbitration
- watch items: odds, lineups, injuries, weather, live state, or training data that would change the decision
- synthesis: the final product-facing interpretation of the score, calibration, and guardrails

This is public audit text generated from model evidence and guardrails, not hidden chain-of-thought.

The belief state records the current probability view of the best available selection:

- `baseModelProbability`: model probability after the current model/context pipeline
- `marketImpliedProbability`: no-vig bookmaker probability
- `probabilityEdge`: model probability minus no-vig market probability
- `expectedValue`: model probability times decimal odds minus 1
- `confidenceInterval`: a conservative band widened by uncertainty and confidence
- `uncertaintyScore`: data-quality, missing-signal, contradiction, memory, and live-state penalty
- `expiresAt`: when the current belief should be refreshed before it is trusted again
- `invalidationTriggers`: odds, lineups, injuries, weather, live events, or memory conditions that should throw the belief away

The monitoring plan turns the belief expiry into an operating loop:

- `status`: `active`, `watching`, `blocked`, or `expired`
- `priority`: urgency derived from live state, belief grade, committee consensus, missing signals, and abstention gates
- `reviewCadenceMinutes`: how often the agent should refresh the decision before trusting it again
- `tasks`: odds, lineup, injury, weather, live-state, case-memory, or training checks with due times and actions
- `stopConditions`: market, context, memory, or calibration conditions that should remove the recommendation
- `escalationRules`: when unresolved tasks or adverse signals should downgrade to monitor or avoid

The actionability audit then answers whether the recommendation is ready to show:

- `status`: `actionable`, `watch-only`, or `blocked`
- `posture`: `show-value-candidate`, `keep-on-watchlist`, or `avoid-recommendation`
- `score`: weighted gate score from 0 to 100
- `gates`: value/EV, confidence/risk, data quality, context coverage, belief freshness, committee arbitration, monitoring state, case memory, and historical learning
- `blockers`: failed gates or abstention conditions that prevent a public recommendation
- `requiredBeforeAction`: odds/context/model checks that must run before trusting the edge again

The review loop is the final agent QA pass:

- `thesis-builder`: restates the model-market thesis being tested
- `red-team`: attacks the thesis with blockers, warnings, and committee objections
- `data-gap-checker`: reviews missing context and monitoring tasks
- `repair-planner`: lists checks required before the decision can remain visible
- `final-reviewer`: recommends clear, repair, downgrade, or block with release criteria

The research brief condenses the final post-review state into a product-facing analyst note: headline, executive summary, model thesis, market thesis, risk thesis, evidence trail, data gaps, required checks, analyst posture, and decision clock. It is deterministic public audit text, not hidden chain-of-thought.

The decision notebook turns the brief into a visible working memory for the current recommendation. It records:

- assumptions the model is currently leaning on
- falsifiers that should kill or downgrade the thesis
- refresh triggers with due times
- operator checklist items before public trust
- audit trail entries explaining how the notebook state was opened

This notebook is persisted with the decision snapshot and can be supplied to the guarded AI reviewer as evidence.

## Probability Trace

The probability trace is the public evidence-fusion layer. It starts from the no-vig bookmaker probability and updates that prior in log-odds space, which keeps probability movement bounded and easier to audit than raw additive jumps.

```text
logit(p) = ln(p / (1 - p))
p = 1 / (1 + exp(-logit))
```

For the selected market:

```text
marketPrior = noVigImpliedProbability
modelDelta = logit(modelProbability) - logit(marketPrior)
posteriorLogOdds = logit(marketPrior) + modelDelta * modelWeight
```

The trace then applies smaller weighted updates for:

- context signals from injuries, lineups, weather, news, rest, live events, or sport-specific factors
- market-calibration pull back toward the no-vig prior
- data-quality reliability
- similar-case memory
- calibration health
- triggered abstention gates

Every step records prior probability, posterior probability, probability delta, log-odds delta, weight, confidence, and whether the update was applied, skipped, or clamped. The final posterior produces:

```text
posteriorEdge = posteriorProbability - noVigImpliedProbability
posteriorExpectedValue = posteriorProbability * decimalOdds - 1
```

The posterior is clamped to a conservative range so the engine cannot imply certainty. The trace also cannot upgrade the final action beyond the deterministic guardrails; it is an audit layer for how the agent fused evidence, not a shortcut around abstention rules.

## Decision Attribution

The attribution layer converts the decision artifacts into a ranked explanation of what moved the final action. It does not introduce a hidden second model; it scores visible objects that already exist in the report.

Primary attribution sources:

- probability-trace steps and their probability deltas
- no-vig edge and expected value for the selected price
- odds-intelligence candidate count
- market-movement resilience or fragility
- data-coverage gaps and missing production signals
- actionability and review-loop status
- calibration health
- case-memory adjustment
- triggered abstention gates

Each driver records:

```text
direction = positive | negative | neutral
impactScore = bounded score from probability movement, value strength, risk pressure, or missing-data severity
probabilityImpact = probability delta where available
```

The final attribution object reports:

```text
netProbabilityMovement = posteriorProbability - marketPrior
modelMarketGap = modelProbability - noVigImpliedProbability
valueScore = bounded score from edge, EV, actionable markets, and price resilience
riskScore = bounded score from missing data, stale data, abstention gates, price fragility, actionability, review loop, and case memory
```

The decisive factor is the highest-impact driver after the final action guardrails are applied. This gives operators a compact answer to "why this action?" while preserving the full trace for audit.

## Uncertainty Decomposition

The uncertainty decomposition layer turns broad uncertainty into a weighted budget. It does not replace the model probability; it explains which unknowns are preventing higher trust.

Uncertainty buckets:

- model uncertainty from diagnostics and model data quality
- market disagreement from model probability versus no-vig market probability
- data coverage gaps from missing or stale production signals
- context gaps from missing lineups, injuries, suspensions, weather, news, or live events
- price execution uncertainty from market-movement resilience or fragility
- timing freshness from monitoring priority and review cadence
- memory/calibration uncertainty from similar cases and calibration health
- robustness/review uncertainty from stress tests and review-loop status

Each component is scored from `0` to `100`, weighted, and converted into a contribution:

```text
componentContribution = componentScore * componentWeight
uncertaintyScore = sum(componentContribution) / sum(componentWeight)
confidencePenalty = min(0.28, uncertaintyScore / 100 * 0.22 + abstentionGateCount * 0.03)
```

The highest contribution becomes the primary uncertainty. The status is:

- `controlled` when uncertainty is low enough to keep the current action
- `watchlist` when trust depends on reducing the top uncertainty bucket
- `high-risk` when uncertainty or an active gate should downgrade or block public trust

The output includes mitigations so the agent can say what data would lower uncertainty instead of merely saying that risk exists.

## Decision Boundary

The decision boundary layer converts the recommendation into explicit flip thresholds. It does not create a second opinion; it measures how far the current decision is from the floors and ceilings already used by the model, market, data, actionability, and robustness layers.

For the selected side:

```text
probabilityFloor = 1 / quotedOdds
posteriorFairOdds = 1 / posteriorProbability
probabilityMargin = posteriorProbability - probabilityFloor
oddsMargin = quotedOdds - posteriorFairOdds
edgeMargin = posteriorEdge - learnedMinimumEdge
evMargin = posteriorExpectedValue - 0
scoreMargin = decisionScore - 24
dataQualityMargin = dataQualityScore - 62
uncertaintyMargin = 66 - uncertaintyScore
contextShockMargin = min(edgeAfterWorstShock, expectedValueAfterWorstShock)
priceShorteningMargin = maxShorteningBeforeNoValue - 3%
```

Positive margins mean the current state still clears the boundary. A zero or negative margin breaches the boundary. Thin positive margins become `near` so the UI can keep the decision on watch even before the hard rule fails.

The boundary status is:

- `comfortable` when all margins are clear and uncertainty/data coverage are healthy
- `near-flip` when one or more margins are close to failure
- `at-risk` when the action still survives but data coverage or uncertainty needs watchlist treatment
- `blocked` when a boundary is breached, a hard abstention gate triggers, or the current action is avoid

The output includes the nearest flip, flip triggers, required conditions to stay considerable, and next action.

## AI Protocol

The AI protocol is a public review contract, not hidden chain-of-thought. It packages the deterministic decision into:

- questions the agent answered or could not answer
- pass/watch/fail audit checks
- evidence references that the OpenAI reviewer may cite
- tool/data requests that would reduce uncertainty
- guardrails that prevent invented facts or upward promotion
- reviewer instructions for the guarded AI audit

Protocol status is:

- `ready` when the public questions are answered and no required tool/data gap blocks trust
- `needs-data` when watch checks or missing provider/tool requests remain
- `blocked` when a hard boundary, guardrail, abstention gate, or avoid action prevents public trust
- `reviewed` after the OpenAI reviewer returns a cited structured audit

The OpenAI reviewer receives this protocol plus the evidence packet and must return structured public audit notes. The local engine filters citations to supplied evidence IDs and still owns the final action.

## Reasoning Graph

The reasoning graph turns the public decision state into linked nodes and edges. It is not hidden chain-of-thought; it is a compact audit graph assembled from already-visible artifacts.

Node types include objective, model, market, data, uncertainty, boundary, review, risk, tool, and final action. Each node has:

- status: `supporting`, `watch`, `blocking`, or `neutral`
- strength: bounded `0` to `100`
- evidence IDs that back the claim
- a public detail string

Edges connect the nodes with one of:

- `supports`
- `challenges`
- `requires`
- `blocks`
- `updates`

Graph status is:

- `coherent` when supporting nodes connect to the final action without blockers
- `contested` when watch nodes remain but no blocking path owns the decision
- `blocked` when an avoid action, blocking node, or blocking edge controls the final action

The graph returns strongest path, blocking path, and unresolved nodes so the UI can show why the agent is leaning, waiting, or abstaining.

## Tool Orchestration

The tool-orchestration layer converts data and review gaps into executable agent tasks. It does not change probabilities directly. It decides what the agent should fetch next and how stale each input can become before the decision needs another run.

Each task records:

- category, provider, dependencies, and priority
- status: `ready`, `missing-config`, `waiting`, `blocked`, or `complete`
- freshness window in minutes where applicable
- what the task unlocks and how it can affect the decision

The readiness score is a weighted task score:

```text
taskScore =
  1.00 for ready or complete
  0.55 for waiting
  0.12 for missing-config
  0.00 for blocked

readinessScore =
  round(sum(priorityWeight * taskScore) / sum(priorityWeight) * 100)
```

Priority weights are `critical = 4`, `high = 3`, `medium = 2`, and `low = 1`. High-priority missing or blocked tasks become blocking task IDs; the highest-priority incomplete task becomes `nextTaskId`.

## Tool Execution Audit

The execution audit converts the orchestration plan into a run trace for the current decision. In the MVP this is a deterministic local audit: it does not invent provider success, and it does not claim OpenAI review ran unless the guarded reviewer actually returned.

Attempt status is:

- `executed` when the task's artifact is present in the current decision
- `blocked` when provider config or required data is missing
- `waiting` when a task is not applicable yet, such as live events before kickoff
- `skipped` when a runnable external review was not requested in this run

Each attempt records observed record counts where they are knowable from the current artifact: one fixture, odds selections, context signals, form rows, training sample size, or decision-memory sample size. The audit status is `blocked` when high-priority attempts are blocked, `partial` when any task is blocked/waiting/skipped, and `complete` only when every task executed.

## Control Policy

The control policy is the final operating layer. It does not recalculate probabilities. It combines value selection, market movement, data coverage, tool execution, decision boundary, AI protocol, reasoning graph, actionability, review loop, robustness, and uncertainty into one permission state.

Policy status is:

- `publishable` when no gate blocks or watches and the action remains a value candidate
- `monitor-only` when no hard blocker remains but the decision should not be shown as actionable
- `needs-rerun` when watch gates remain, tools are partial, or the decision boundary needs fresh evidence
- `blocked` when any hard gate owns the decision

Visibility follows status: `public-candidate` for publishable decisions, `watchlist-only` for monitor/rerun decisions, and `internal-only` for blocked decisions. The policy also returns allowed actions, forbidden actions, primary blocker, next best action, and release criteria.

## Supervisor Queue

The supervisor queue ranks the next operational work across all matches in a slate. It consumes already-built decisions and emits queue items for:

- publishable candidates
- blocked or watched control gates
- next tool tasks
- guarded AI-review work
- active monitoring tasks

Items are sorted by priority, blocker severity, then kickoff time. This gives the agent one slate-level answer: what to do first across all fixtures, instead of only inside one match report.

The queue also emits a runbook for the top actionable item. Runbooks prefer read-only or dry-run endpoints, list required env keys, include a verification request back to `/api/sports/decision/supervisor`, and block write-gated actions until dry-run/provider evidence is available. Each runbook includes a preflight object that checks env alternatives, admin-token requirements, dry-run safety, local command targeting, missing keys, warnings, and whether the primary command can run now.

## Agent Loop

The agent loop binds the match-level brain and slate-level supervisor into a closed operating cycle:

- observe: inspect fixtures, odds, live state, context, and data coverage
- orient: test the model thesis against market, context, risk, memory, and dissent
- decide: apply actionability, robustness, and control-policy gates
- act: execute only the safe read-only, dry-run, or write-gated runbook command
- learn: persist decisions, settle outcomes, measure closing-line value, and update calibration/case memory

The loop exposes phase status, active match focus, autonomy mode, missing environment requirements, an evidence ledger, an action contract, and a verification URL. This makes the agent operational without hiding private chain-of-thought: the product sees public reasoning artifacts, allowed/forbidden actions, and the exact proof needed to move the loop forward.

## Self Audit

The self audit is a slate-level red-team pass over the agent loop. It asks whether the agent can be wrong before acting:

- runtime: can the next command actually run with the current environment?
- data: are required provider signals missing, stale, or mock-backed?
- tools: are fixture, odds, context, memory, training, or AI-review tasks blocked?
- market: are priced markets too thin or too expensive after margin removal?
- memory: can similar stored decisions discount repeated weak patterns?
- learning: is the training/backtest corpus large enough to inform guardrails?
- actionability: do publish permissions agree with actionability and control policy?
- safety: has the guarded AI protocol cleared missing-data and safety gates?

Each finding has a severity, failure mode, affected-match count, evidence, mitigation, and owner phase. The trust score starts at 100 and subtracts penalties by severity; critical findings fail the slate, high findings place it on watch, and only a pass allows the agent to raise trust.

## Repair Planner

The repair planner converts self-audit findings into an action queue. For each finding it chooses:

- repair type: configure env, dry-run provider, read status, run review, persist memory, backfill training, or operator review
- priority from finding severity
- status from whether required env is present
- safe command, preferring `GET` or `dryRun=1`
- expected evidence that proves the repair worked
- trust-delta estimate used to project potential trust score
- verification URL back to self-audit or repair-plan

The planner is not allowed to mark a repair complete by itself. A repair only counts when the audit rerun removes or downgrades the finding.

## Repair Verification

The repair verifier is the proof layer after the planner. It takes the current repair plan, latest self-audit, and readiness snapshot, then assigns every action a status:

- `verified`: the original self-audit finding is no longer present
- `ready-to-run`: the command or operator check can be run with the current environment
- `blocked`: required environment, provider, admin, or Supabase proof is still missing
- `waiting`: the action needs operator or external-provider review
- `needs-rerun`: the finding still exists and the verification URL must be checked again

The verifier does not raise trust by itself. It only reports whether evidence is strong enough for the next self-audit to clear a finding. This keeps the agent from treating planned repairs, missing keys, or stale readiness snapshots as actual model improvement.

## Operating Cycle

The operating cycle is the state machine above the individual reports. It combines the agent loop, self-audit, repair planner, repair verifier, supervisor runbook, readiness, and learning state into six public stages:

- `observe`: required fixture, odds, live, context, memory, and training inputs
- `diagnose`: self-audit trust score and failure modes
- `decide`: control-policy and actionability gates
- `act`: supervisor runbook and preflight result
- `verify`: repair proof against the latest audit/readiness evidence
- `learn`: persistence, outcomes, calibration, backtests, and case memory

The cycle chooses one `nextTransition` with command, verification URL, expected evidence, blocked requirements, and whether it can run now. This makes the agent act like a bounded operator: it keeps a current belief, primary doubt, decisive unknown, guardrail, and learning target, then refuses to advance trust until proof appears in the next stage.

## Action Sandbox

The action sandbox is the execution gate between a supervisor runbook and a real command. It does not run commands by itself. It evaluates:

- whether the primary command is read-only or explicitly `dryRun=1`
- whether an admin token is required
- whether required env alternatives are configured
- whether the command targets the local OddsPadi server
- whether write-gated actions must stay blocked
- which abort condition should stop the operator
- which verification endpoint must be checked after the command

The sandbox only exposes `primaryCommand` when the command is safe, local, non-write-gated, and preflight has no blocking failures. This gives the agent an act phase without silently mutating provider data, Supabase rows, or public recommendations.

## Learning Queue

The learning queue is the explicit feedback loop after a prediction. It ranks the work required before historical evidence can change live guardrails:

- read decision memory so similar-case comparison works
- persist the current decision with model snapshot and brain trace
- open and later settle outcome records with taken odds, closing odds, and result
- run calibration once enough settled outcomes exist
- run real-data sport-specific backtests once corpus volume is ready
- backfill the 10-year fixture, context, odds, and feature corpus

Each task reports missing env, command, verification URL, expected evidence, and learning impact. Learned thresholds remain inactive until real provider data, settled outcomes, calibration, and backtests are proven.

## Data Authority

The data authority layer converts the intake queue into permissions the agent can actually obey. Each signal family receives an authority status:

- live-authorized: provider-backed evidence can influence live decisions
- computed-shadow: deterministic/computed evidence can be shown as context but cannot raise action
- dry-run-ready: one provider dry-run can be executed, but storage and training remain locked
- needs-provider-env: provider/admin env is missing
- needs-supabase-proof: OddsPadi project, credential, MCP, or op_ schema proof is missing
- training-blocked: corpus, labels, calibration, backtests, or drift checks are not ready
- blocked: the signal family cannot be trusted for decisions or training

Authority score is intentionally conservative:

```text
authority_score =
  priority_weight
  + provider_readiness
  + supabase_isolation_bonus
  + governance_bonus
  - blocker_penalty
```

The policy can allow read-only inspection and provider dry-runs, but it always keeps provider writes, decision persistence, model training, publishing, and public-action upgrades false until separate gates pass.

## Model Cards

Model cards expose the sport-specific model family before the engine trusts a decision. They are not another predictor; they are an audit packet around the actual formulas, parameters, feature provenance, training corpus, and governance gates.

Football card:

```text
xG_home =
  clamp((league_goal_rate / 2)
    * home_attack
    * away_defensive_resistance
    * home_rating_factor
    * home_form_factor
    * home_advantage,
    0.25,
    3.65)

P(score h-a) = Pois(h; xG_home) * Pois(a; xG_away)
edge = model_probability - no_vig_probability
EV = model_probability * decimal_odds - 1
```

Basketball card:

```text
margin =
  rating_diff * 0.42
  + form_diff * 5.5
  + home_court
  + rest_adjustment
  + availability_adjustment

P(home) = logistic(margin / 7.2)
P(cover) = logistic((margin - spread_line) / 6.5)
P(over) = logistic((expected_total - total_line) / 11.5)
```

Tennis card:

```text
P(player_1) =
  logistic(elo_diff * 1.15
    + form_diff * 0.9
    + surface_adjustment
    + fatigue_adjustment
    + round_adjustment
    + head_to_head_adjustment
    + travel_load_adjustment)
```

Each card reports live feature coverage, mock/missing features, training-ready feature count, real finished fixtures, real odds snapshots, feature snapshots, backtests, governance trust, and next upgrade action. Model cards can inspect and explain, but they cannot train, publish, persist, raise trust, or upgrade public action.

## Training Data Blueprint

The training blueprint sits above the corpus plan. It converts the 10-year multi-sport import plan and current Supabase training counts into a no-write operator contract.

Per sport:

```text
fixture_deficit = max(0, 1000 - real_finished_fixtures)
odds_deficit = max(0, 2000 - real_odds_snapshots)
feature_deficit = max(0, max(1000, real_finished_fixtures) - feature_snapshots)
backtest_deficit = max(0, 1 - completed_backtest_runs)
```

The phase order is fixed:

```text
prove_supabase
provider_dry_runs
write_corpus
feature_snapshots
backtest
unlock_shadow_learning
```

The blueprint can mark a phase ready, waiting, or blocked, but it cannot execute the phase. Storage tables are service-role-only, RLS-required, and routed through guarded API routes. The route can expose a safe `dryRun=1` command only when Supabase proof and required provider env are present; provider writes, model training, publishing, persistence, and public-action upgrades stay false.

## World Model

The world model is the agent's current state reducer. It does not create new picks. It fuses ranked match beliefs with data authority and asks which part of the world is under the most pressure.

For each match cell:

```text
pressure =
  0.42 * belief_uncertainty
  + action_pressure
  + 8 * unresolved_reasoning_nodes
  + 10 * contradiction_count
  + 4 * missing_signal_count
  + edge_pressure
  + boundary_penalty
```

Authority cells use `100 - authority_score`; the Supabase authority cell uses `100 - trust_score`. The highest-pressure cell becomes the next observation target. The model emits support, challenge, update rule, falsifier, and next observation, but it cannot persist, publish, train, raise trust, or upgrade the public action.

## World Model Critic

The world-model critic is a deterministic self-review layer. It does not call OpenAI or invent facts. It asks whether the current world state can survive adversarial questions from five roles: model advocate, market skeptic, data steward, safety officer, and learning critic.

For each high-pressure cell:

```text
cell_confidence =
  100
  - 0.48 * pressure
  - 0.22 * belief_uncertainty
  - status_penalty
  - challenge_penalty
  + support_credit
```

The critic then runs four stress tests:

```text
market_reprice     = max pressure from market or match-belief cells
authority_regress  = max pressure from Supabase or data-authority cells
signal_volatility  = 18 * volatile_cells + 10 * uncertain_cells + 20 * blocked_cells
learning_gap       = max pressure from learning cells, or a training-lock fallback
```

The final confidence ceiling is:

```text
confidence_ceiling =
  100
  - 0.58 * max(top_cell_pressure, max_stress)
  - 12 * blocking_debate_roles
  - 10 * blocking_stress_tests
```

If the world model is avoid-only, the critic blocks. If any role or stress test blocks, it routes to repair. If the posture is shadow-only, training-locked, or the confidence ceiling is low, it holds. Only clean states can move to read-only observe. It still cannot persist, publish, train, raise trust, or upgrade a public action.

The AI executive runbook is the final no-write operator wrapper around the executive feedback cycle. It chooses one local read-only GET command, verifies the target URL, lists abort conditions, states success criteria, and keeps Supabase memory, provider writes, model training, publishing, trust raises, and public-action upgrades locked until separate proof gates pass.

The AI executive governor sits one level above the runbook. It scores possible next moves with a small utility function:

```text
score = information_gain + urgency - risk - lock_penalty
```

The candidate with the highest allowed score becomes the next intent. Typical intents are observe proof, inspect learning, guarded AI review, refresh executive state, or hold. The governor also records public beliefs, doubts, decision boundaries, and a one-command autonomy budget, but it still cannot persist, publish, train, raise trust, or upgrade a public action.

## Hypothesis Lab

The hypothesis lab turns the deliberation layer into a slate-level experiment queue. For every match hypothesis, it records:

- thesis and counter-thesis
- current hypothesis status: supported, contested, rejected, or needs data
- falsifier from the decision notebook, challenge evidence, or missing-data rule
- expected signal required before trust can rise
- projected action from the most relevant scenario
- safe verification command back to the match decision route

Experiments are ranked by priority, readiness, scenario action flip, control-policy blocker, decision health, and confidence. The lab does not create hidden chain-of-thought. It exposes public tests the agent can run or wait for, so the product can say exactly what evidence would prove or kill a recommendation.

## Market Movement Intelligence

After odds intelligence selects the best positive-value candidate, the engine checks whether the price is still usable if the market moves. This is separate from the broader robustness audit because it focuses on the current bookmaker quote and practical execution risk.

For a selected side with model probability `p_model` and current decimal odds `O_current`:

```text
fairOdds = 1 / p_model
oddsBuffer = O_current / fairOdds - 1
maxShorteningBeforeNoValue = 1 - fairOdds / O_current
expectedValue = p_model * O_current - 1
```

The engine then re-prices the selection across deterministic scenarios:

- current quoted odds
- 3% shortening
- 5% shortening
- 10% shortening
- 5% drift outward

Each scenario recalculates EV and assigns an action of `value`, `watch`, or `avoid`. A selection is `resilient` when it survives a 10% shortening with enough odds buffer, `sensitive` when it survives the medium move but not the full stress, and `fragile` when normal price compression can erase the edge. The alerts are also copied into `nextChecks` so the UI can tell operators which price move should downgrade or block the thesis.

The robustness audit runs counterfactual stress tests:

- odds shortening: expected edge after a bookmaker price move
- adverse context: injury, lineup, weather, or news shock
- data-quality decay: provider uncertainty reducing trust in the edge
- belief expiry: stale belief before the next refresh
- review repair pressure: unresolved repair-loop checks
- actionability downgrade: actionability warnings reducing the effective edge

Each case returns an action after shock: `survives`, `downgrades`, or `breaks`. The audit reports survival rate, worst case, required rechecks, and safer hedge alternatives.

The evaluation plan is the pre-registered grading contract for a decision. For a tracked value pick it records:

- settlement market and selection
- model probability and no-vig market probability
- break-even probability from quoted odds
- value edge and expected value
- target closing-line value
- success and failure criteria
- required outcome signals such as settled result, closing odds, context resolution, and calibration row
- post-match actions for calibration and backtesting

This is how the agent remembers what it must learn later; a pick is not just explained, it is made auditable before the result is known.

When the optional OpenAI reviewer runs, it receives the deterministic evidence as an ID-based packet and must cite those IDs in its structured audit. The local engine filters citations to supplied IDs, records safety gates, and treats any blocking gate as a downgrade to `avoid`; the model cannot promote a weaker deterministic action.

The decision committee converts that deliberation into role votes:

- model advocate checks whether probability, edge, and EV support a selection
- market skeptic checks whether the price is wide enough after margin removal and odds movement
- context scout checks injuries, lineups, weather, live state, and other missing signals
- risk manager checks calibration, contradictions, and abstention gates
- memory analyst checks whether similar stored decisions support, discount, or block the pick
- final arbiter applies the deterministic guardrails and records unresolved disagreements

The decision engine also carries a case-memory profile when Supabase has stored decisions. Case similarity is deterministic and compares:

- market and selection
- model probability
- no-vig value edge
- expected value
- confidence and risk
- prior decision action, health, score, and reliability

Similar cases create an action mix. If memory is weak or avoid-heavy, it can discount confidence; if it is strongly avoid-heavy with poor reliability, it can trigger a memory abstention gate. Without enough stored decisions, case memory stays neutral.

## 8. Historical Backtest Layer

The historical training module now adds offline evaluation paths for football, basketball, and tennis data. Football uses online Elo plus Poisson expected goals:

```txt
homeEloExpected = 1 / (1 + 10 ^ ((awayElo - (homeElo + homeAdvantageElo)) / 400))
```

After each finished fixture, online Elo updates:

```txt
newHomeElo = homeElo + k * (actualHomeResult - expectedHomeResult)
newAwayElo = awayElo + k * (actualAwayResult - expectedAwayResult)
```

For each holdout fixture, the backtester:

- estimates expected goals from Elo, home advantage, form, attack/defense, rest, injuries, and suspensions
- converts expected goals into home/draw/away probabilities with the Poisson score matrix
- removes bookmaker margin from 1X2 odds by normalizing implied probabilities
- compares model probability to no-vig implied probability
- selects only positive-edge picks above the configured threshold

Evaluation metrics:

```txt
Brier = mean((p_home - y_home)^2 + (p_draw - y_draw)^2 + (p_away - y_away)^2) / 3
LogLoss = -ln(p_actual_outcome)
ROI units = sum(win ? odds - 1 : -1)
Yield = ROI units / pick_count
CLV = taken_odds / closing_odds - 1
```

Basketball maps stored finished games into team rating, pace, offensive/defensive efficiency, rest, availability, moneyline edge, ROI, yield, and CLV. Tennis maps stored matches into player Elo, surface rating, form, head-to-head, fatigue, injury/news proxies, match-winner edge, ROI, yield, and CLV.

Stored sport-specific backtests suggest learned weights such as minimum edge, value-edge weight, data-quality weight, and market/surface/pace adjustments. These are suggestions until the corpus is large enough; the UI requires a meaningful historical sample before treating the model as trained.

The 10-year corpus planner keeps collection mathematically useful instead of merely large. The default football scope is seasons 2016-2025 across the first provider-confirmed competitions, with API-Football used first for fixture, result, event, standings, availability, lineup, news, and weather dry-runs. Odds history is a second pass: once fixture kickoff times are stored, the system should generate opening, pre-kickoff, and closing-line jobs so CLV, no-vig edge, and expected value can be measured on the same timeline the live model will use.

The safe first football command comes from `/api/sports/decision/training/corpus-plan`; it is always `dryRun=1`. Write-mode imports should wait until Supabase schema checks pass, provider quotas are understood, and normalized dry-run counts look sane.

The provider-ingestion evidence packet at `/api/sports/decision/provider-ingestion-evidence` is the pre-training gate. It does not fetch or write data itself. It joins the slate data-intake queue, the 10-year corpus plan, the current training snapshot, and Supabase project/schema proof into one answer:

- which feed should be dry-run first
- which env keys block provider calls
- which `op_` tables would store the evidence
- which model component the feed improves
- whether Supabase proof is strong enough for later writes
- why persistence, training, and publishing remain locked

The multi-sport training contract comes from `/api/sports/decision/training/multi-sport-corpus-plan`. It keeps football, basketball, and tennis visible in one plan:

```txt
football   = implemented API-Football + The Odds API backfill path
basketball = implemented API-Basketball dry-run adapter plus implemented efficiency/moneyline backtest runner
tennis     = implemented API-Tennis dry-run adapter plus implemented surface-Elo match-winner backtest runner
```

The multi-sport plan is allowed to expose safe dry-run proof commands, but it must not mark basketball or tennis as training-ready until normalized real rows, odds snapshots, and stored backtest runs exist.

Basketball and tennis training spines should follow the same pattern once provider history exists:

- finished fixtures/matches with pre-match features
- opening and closing market odds
- no-vig implied probabilities
- context snapshots such as standings, injuries/suspensions, lineups, weather, news, and live events where the sport supports them
- sport-specific model probabilities
- Brier/log loss, ROI, yield, and closing-line value
- learned edge thresholds that activate only after enough real data

## 9. Future Model Upgrades

Good next upgrades:

- football team-specific attack and defense ratings from historical match data
- provider-backed basketball travel, rotations, injuries, pace priors, and player availability
- tennis true surface Elo, real head-to-head, fatigue/travel, draw path, injury/news, and retirement-risk feeds
- closing-line value tracking
- calibration curves and Brier score
- bookmaker margin removal by market
- learned market-prior weights from historical closing-line value
- richer live in-play adjustment using sport-specific event, momentum, shot-pressure, possession, and player-state data

## Responsible Positioning

OddsPadi is analysis only. The model estimates uncertainty; it does not remove it. No prediction is guaranteed.
