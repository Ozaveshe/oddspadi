# OddsPadi AI Decision Engine

The decision engine is the layer that turns model probabilities and odds into a responsible product answer.

It does not replace the math model. It reads:

- fixture context
- model probabilities
- expected goals, projected points, or expected sets
- scoreline, margin, or match-shape simulation
- football Dixon-Coles low-score dependence correction
- basketball rest-day, availability, and rotation-shape model diagnostics
- tennis head-to-head and travel/load model diagnostics
- raw and no-vig bookmaker implied probabilities
- market-prior adjustment after bookmaker margin removal
- value edges
- expected value per unit
- confidence and risk
- data quality
- structured context signals such as lineups, injuries, weather, rest, surface, news, and live events
- remaining missing signals after available context is applied

Then it returns:

- verdict: `strong-value`, `lean-value`, `watchlist`, `avoid`, or `insufficient-data`
- action: `consider`, `monitor`, or `avoid`
- deliberation: primary thesis, dissenting thesis, synthesis, hypotheses, and watch items
- belief state: current model-vs-market belief, confidence band, uncertainty, expiry, and invalidation triggers
- probability trace: market-prior-to-posterior evidence fusion with log-odds updates, posterior edge, posterior EV, conflicts, and safeguards
- decision attribution: ranked positive/negative drivers, missing-data drag, decisive factor, value score, and risk score
- uncertainty decomposition: model, market, data, context, price, timing, memory, and robustness uncertainty budget with mitigations
- decision boundary: probability, odds, edge, EV, score, data-quality, uncertainty, context-shock, and price-movement thresholds that would flip the action
- AI protocol: public questions, audit checks, evidence refs, tool requests, reviewer guardrails, and handoff instructions for the guarded OpenAI reviewer
- reasoning graph: linked objective, model, market, data, uncertainty, boundary, actionability, review, tool, and final-action nodes with support/challenge/block edges
- tool orchestration: executable provider tasks for fixtures, history, standings, form, context, odds, live state, weather, training, memory, and AI review
- tool execution: deterministic run audit showing which tool tasks executed, waited, skipped, or blocked, plus observed record counts and output signals
- control policy: final operating policy for publish, watchlist, rerun, or block decisions, with allowed actions, forbidden actions, and release criteria
- action sandbox: dry-run/read-only execution gate that decides whether the supervisor's primary command can run and what proof must follow
- activation runbook: supervised activation sequence for Supabase proof, env secrets, schema verification, provider dry-runs, OpenAI review, Netlify smoke checks, training corpus proof, and write-mode approval
- decision mind: consolidated active-match belief, doubts, public thought checks, thinking trace, confidence budget, falsifiers, change-my-mind evidence, AI readiness, safe next command, hard locks, and proof URLs
- operator turn: single safe turn packet that joins mind, capability contract, evidence transition, runtime, and authority into one observable action with verification and fallback criteria
- operator receipt: bounded proof runner that observes the selected turn's local read-only verification route and hashes the response without shell execution or writes
- operator state: proof-to-state reducer that turns an observed receipt into trust, confidence, action, and next-turn patches without persistence or publishing
- operator episode: replayable turn-receipt-state timeline with final patch, replay commands, operator narrative, and memory draft
- AI reasoning gateway: strict Responses API operator review over the episode with public reasoning phases, citation filtering, deterministic fallback, and no persist/publish/train permissions
- AI review readiness: no-call contract surface for the OpenAI lanes that lists schema names, `store=false`, deterministic fallbacks, missing env, the linked cognitive proof receipt, evidence graph, thinking introspection, and hard no-persist/no-publish/no-train controls before any `run=1` request is allowed
- AI cognitive loop: bounded sense/interpret/deliberate/arbitrate/act/verify/learn controller that composes the episode and AI reasoning result into one safe next operation
- AI context dossier: hashable AI review packet that joins model probabilities, no-vig odds, posterior belief, data coverage, feature provenance, governance, intake blockers, and cognitive-loop state into one no-write OpenAI payload preview plus a deterministic fallback review
- AI control packet: deliberation-aware controller that combines public deliberation, runtime, capability contract, and operator turn into one control state, bounded next move, run mode, missing env, stage gates, escalation, and forbidden actions
- AI executive decision: top-level reducer that fuses mind, reasoning alignment, cognitive loop, AI session, deliberation, control, experiment episode, capability contract, Supabase project isolation, and provider-ingestion evidence into one public stance, conflict list, bounded proof command, executable policy synthesis, feedback-loop state, executive cycle state, next-turn governor, memory draft, evidence packet, strict AI review payload preview, deterministic fallback review, and locked controls
- AI thought episode: private audit/replay record that joins the AI control packet and operator episode into a compact thought chain, replay commands, proof URLs, private payload hash, and guarded Supabase memory draft
- AI thought memory: private recall layer over stored thought episodes that compares control hash, operator episode hash, active match, public action, run mode, stage blocks, replay count, and locked controls before returning audit-only lessons
- AI experiment planner: bounded proof planner that consumes the AI control packet, private thought episode, and thought memory to choose one read-only or dry-run experiment with hypothesis, falsifier, verification command, and hard no-publish/no-train controls
- AI experiment observer: no-write receipt layer that fetches only approved local GET proof routes for the selected experiment, hashes the response, summarizes signals, and keeps shell, OpenAI, persistence, publishing, training, and trust upgrades locked
- AI experiment state: conservative reducer that converts a planner plus observer receipt into a shadow-only state patch that may hold, retry, reduce, or record proof without raising trust
- AI experiment episode: replayable audit artifact that joins the experiment plan, observer receipt, state reducer, stability packet, final patch, timeline, replay commands, and memory draft into one no-write loop record
- AI deliberation: public no-write debate that combines the AI decision session and shadow evaluation into role positions, hypotheses, falsifiers, decision questions, final safe stance, and next proof without exposing hidden chain-of-thought
- AI decision session: one no-write session packet that composes the context dossier, operator reasoning gateway, slate council, authority gate, and MVP audit into a same-or-safer session action, public trace, metareasoning packet, evidence packet, deterministic fallback review, and strict top-level Responses API session-review payload
- AI session shadow evaluation: no-write learning-readiness gate that scores the AI session against outcome tickets, calibration, real-data backtests, corpus coverage, and locked training permissions before it can become a learning candidate
- AI council: slate-level role vote over model, market, data, risk, learning, and operations evidence with optional no-upgrade OpenAI critique
- model ensemble: independent sport-model, market, posterior-belief, data-quality, calibration/memory, risk/robustness, and actionability judges
- feature matrix: numeric training/vector view of the current slate with provider/computed/mock/missing provenance for every feature
- model governance: drift, provenance, corpus, target-label, calibration, and runtime gate before learned guardrails can affect live decisions
- data intake queue: slate-level provider queue for fixtures, history, standings, form, injuries, lineups, odds, live data, news, weather, and training gaps
- provider ingestion evidence: dry-run readiness packet that maps each missing feed to provider command, env blockers, storage tables, model impact, Supabase project/schema proof, corpus coverage, and no-write/no-train locks
- data gap resolver: ranked proof-action layer over data authority and provider ingestion evidence, with safe commands, missing env, Supabase blockers, expected evidence, and model/odds/training/AI unlocks for the next real-data step
- requirement pulse: compact first-screen requirements scorecard that maps the original MVP brief to current data authority, multi-sport model cards, odds intelligence, AI review readiness plus cognitive proof, evidence graph, and thinking introspection, training blueprint, and responsible controls
- agent brain: compact belief, thesis, committee, blocker, next-tool, and control-policy trace for slate-level, match-level, and stored-run replay inspection
- hypothesis lab: slate-level experiment queue that tests each thesis against falsifiers, expected signals, scenario flips, and safe verification commands
- learning queue: feedback-loop planner for persistence, outcomes, calibration, backtests, corpus backfill, and memory verification
- operating cycle: top-level controller that links observe, diagnose, decide, act, verify, and learn stages into one next proof transition
- agent loop: slate-level observe-orient-decide-act-learn cycle that binds the brain, supervisor runbook, autonomy mode, evidence ledger, action contract, and verification hooks
- self audit: slate-level red-team critique that scores trust and names runtime, data, tool, market, memory, learning, actionability, and safety failure modes before action
- repair planner: prioritized action queue that converts audit findings into safe read-only or dry-run commands, expected evidence, trust deltas, and verification URLs
- repair verification: proof layer that checks the repair queue against current self-audit and readiness evidence before trust can rise
- supervisor queue: cross-match operating queue that ranks the next tool, control, AI-review, monitoring, or publish action across the slate and returns a safe runbook
- decision committee: role-based votes from model, market, context, risk, memory, and final-arbiter viewpoints
- monitoring plan: status, priority, review cadence, watch tasks, stop conditions, and escalation rules
- actionability audit: gate-level answer for whether a value edge is actionable, watch-only, or blocked
- review loop: thesis, red-team critique, data-gap review, repair plan, and final reviewer recommendation
- research brief: headline, executive summary, model thesis, market thesis, risk thesis, data gaps, required checks, evidence trail, posture, and decision clock
- decision notebook: visible working assumptions, falsifiers, refresh triggers, operator checklist, audit trail, and next review time
- data coverage: status and provenance for required fixtures, history, standings, form, injuries, lineups, odds, live data, news, weather, and training signals
- odds intelligence: per-market margin, no-vig probability, fair odds, EV, candidate ranking, and avoid notes
- market movement: fair-odds buffer, shortening tolerance, price-move scenarios, downgrade alerts, and next action
- robustness stress test: counterfactual survival rate across odds, context, data, freshness, and repair shocks
- evaluation plan: pre-registered settlement, closing-line value, calibration, success/failure, and learning contract
- case memory: similar stored decisions, action mix, average reliability, and memory adjustment
- health: `stable`, `review`, or `fragile`
- calibration score and calibration action
- agent stages
- contradiction checks
- scenario matrix
- abstention gates
- public reasoning trace
- evidence reviewed
- weighted decision factors
- sensitivity checks showing what could change the verdict
- risks
- avoid reasons
- safer alternatives
- missing signals
- next checks

## Why This Counts As The Agent Layer

The agent performs structured decision work:

1. Gather model, market, form, and data-quality evidence.
2. Apply bounded context adjustments from injuries/news, lineups, weather, rest/rotation, surface, and live-state signals.
3. Blend priced model selections toward no-vig market probabilities with a bounded weight based on data quality and bookmaker margin.
4. Apply football Dixon-Coles low-score correction before deriving winner, totals, BTTS, and scoreline probabilities.
5. For live football, use current score and minute to run remaining-time Poisson recalibration before live guardrails.
6. For basketball, fold rest-day margin and availability/rotation proxies into margin, total, spread, and moneyline diagnostics.
7. For tennis, fold head-to-head and travel/load proxies into match-winner, set-handicap, and games-total diagnostics.
8. Score whether the best edge and expected value clear guardrails.
9. Calculate weighted factors such as value edge, EV, confidence, data quality, variance, missing context, and live-state risk.
10. Run sensitivity checks for odds movement, adverse lineup/news, and data-quality upgrades.
11. Refuse weak picks instead of forcing a recommendation.
12. Surface missing signals instead of pretending the data exists.
13. Suggest safer alternatives such as double chance, draw no bet, totals, BTTS, moneyline, spread, set handicap, and total games.
14. Run self-critique checks for probability normalization, confidence/data-quality mismatch, high-risk recommendations, missing context, and live-state mismatch.
15. Apply abstention gates when edge, data quality, variance, or live-model requirements are not met.
16. Compare the decision with recent stored Supabase decisions to identify similar cases and discount or abstain when memory is weak enough.
17. Produce a structured deliberation record that states the primary thesis, counter-thesis, what would change the decision, and which hypotheses survived.
18. Build a belief state that records the current probability belief, market disagreement, confidence interval, uncertainty score, expiry window, and invalidation triggers.
19. Run a deterministic decision committee so model advocate, market skeptic, context scout, risk manager, memory analyst, and final arbiter roles vote on consider, monitor, or avoid.
20. Build a monitoring plan that decides when to refresh odds/context, which signals are urgent, and what would invalidate the decision.
21. Audit actionability so positive EV is only shown when value, confidence, freshness, committee, memory, monitoring, and responsible-use gates agree.
22. Run a review loop that attacks the thesis, plans repairs, and either clears, downgrades, or blocks the recommendation.
23. Audit data coverage and provenance across the production data checklist before trusting the recommendation.
24. Run odds intelligence across every available bookmaker market and selection, not only the final pick.
25. Stress-test robustness across adverse odds movement, context shocks, data-quality decay, stale belief, repair pressure, and actionability downgrade.
26. Register an evaluation plan so the post-match learning loop knows how to grade result, closing-line value, calibration, and missed data.
27. Compile a research brief that summarizes the model thesis, market thesis, risk thesis, data gaps, evidence trail, required checks, and decision clock.
28. Open a decision notebook with assumptions, falsifiers, refresh triggers, operator checklist, and an audit trail.
29. Produce a public reasoning trace that can be shown to users.

The engine intentionally exposes public reasoning steps and structured deliberation, not hidden chain-of-thought.

## Agent Trace

Each decision now includes a structured agent audit:

- `agentStages`: intake, model integrity, market edge search, risk gate, self-critique, and final arbitration.
- `contradictionChecks`: checks for conflicts between the model, market, risk profile, data quality, missing context, and match state.
- `scenarioMatrix`: base case plus projected score/action under odds shortening, adverse team news, and context improvement.
- `deliberation`: a compact agent debate over the primary value thesis, counter-thesis, context-risk thesis, final arbitration, and watch items.
- `beliefState`: a current-state probability belief with uncertainty score, confidence interval, evidence balance, expiry, and invalidation rules.
- `probabilityTrace`: an auditable market-prior-to-posterior update trace across model evidence, context, market calibration, data quality, case memory, calibration, and abstention gates.
- `attribution`: a ranked explanation of what drove the final action, including positive drivers, negative drivers, missing-data drag, decisive factor, net probability movement, value score, and risk score.
- `uncertainty`: a decomposition of total uncertainty across model, market, data, context, price, timing, memory, and robustness buckets with confidence penalty and mitigations.
- `decisionBoundary`: explicit floor/ceiling metrics for probability, odds, no-vig edge, EV, score, data quality, uncertainty, context shocks, and price shortening, plus nearest flip, triggers, and required conditions to stay considerable.
- `aiProtocol`: the public AI-review contract with answered questions, pass/watch/fail audit checks, evidence references, missing tool/data requests, guardrails, and reviewer instructions.
- `reasoningGraph`: a compact graph of public reasoning nodes and edges, including strongest path, blocking path, and unresolved watch nodes.
- `toolOrchestration`: ordered tool/provider tasks with dependencies, priority, status, freshness window, blocker list, next task, and decision impact.
- `toolExecution`: the current run trace for those tasks, including executed/blocked/waiting/skipped counts, observed records, output signals, next run, and public log lines.
- `controlPolicy`: final permissioning layer with status, visibility, publish allowance, rerun requirement, primary blocker, gates, allowed actions, forbidden actions, and release criteria.
- `committee`: a role-based arbitration record with vote counts, consensus, final rationale, unresolved disagreements, and guardrail notes.
- `monitoringPlan`: operational watch state with next review time, priority, tasks, stop conditions, and escalation rules.
- `actionability`: gate scores, blockers, warnings, required checks, and responsible-use limits for the current recommendation posture.
- `reviewLoop`: thesis-builder, red-team, data-gap, repair-planner, and final-reviewer steps with release criteria.
- `researchBrief`: a compact analyst-facing brief with the current thesis, counter-thesis, evidence trail, checks, and expiry clock.
- `notebook`: the agent's visible working memory for the decision, including assumptions, falsifiers, refresh triggers, operator checklist, audit trail, and next review time.
- `dataCoverage`: weighted source audit for required production signals, including status, freshness, source, detail, and required-before-trust gaps.
- `oddsIntelligence`: per-selection value audit with margin, raw implied probability, no-vig probability, market-prior-calibrated model probability, fair odds, EV, confidence, risk, top candidates, and avoid reasons.
- `marketMovement`: live-price audit with current odds, fair odds, odds buffer, maximum shortening before no value, target closing-line value, movement scenarios, alerts, and next action.
- `robustness`: counterfactual stress cases, survival rate, worst case, hedges, and required rechecks.
- `evaluationPlan`: settlement market, model probability, quoted odds, target CLV, success/failure criteria, required outcome signals, learning questions, and post-match actions.
- `caseMemory`: a similarity comparison against recent stored decisions, including action mix, reliability, and whether memory stays neutral, discounts, or abstains.
- `abstentionRules`: explicit gates that explain why the engine should avoid forcing a selection.
- `calibration`: reliability score, health classification, and whether the decision should be trusted, discounted, or abstained.

This is the product-facing "thinking" layer. It is deterministic and auditable. Belief state says what the agent currently believes and when that belief expires; probability trace shows how the no-vig market prior becomes the current posterior; attribution explains which drivers actually moved or blocked the final action; uncertainty decomposition shows which unknowns dominate trust; decision boundary says exactly what would flip the action; AI protocol defines the public reviewer contract and tool/data requests; reasoning graph links claims, checks, blockers, and final action; tool orchestration turns those blockers into ordered provider tasks with freshness windows and decision impact; tool execution records which tasks actually ran in this decision and which were blocked, waiting, or skipped; control policy turns the full state into a publish, watchlist, rerun, or block permission; the action sandbox decides whether the next supervisor command is safe to execute and what proof must follow; the autopilot coordinates council, invalidation, governance, sandbox, learning, and operating-cycle evidence into one bounded next proof action with run, publish, and persist gates; the research agent turns the active slate evidence into a cited investigation dossier with thesis, counter-thesis, contradictions, open provider questions, and optional no-invention OpenAI critique; the trace ledger converts the current reasoning path into replayable audit nodes, persistence input hash, verification URLs, and safe replay commands; the slate-thinking queue scores every match's belief pressure and chooses the next belief to investigate across the day; the working-memory blackboard separates facts, assumptions, doubts, blockers, next actions, learning targets, and guardrails so the agent knows what it actually knows versus what it still needs to prove; the reflection layer red-teams that blackboard for overconfidence, provider gaps, action drift, memory gaps, market fragility, and guardrail locks before trust can rise; decision rehearsal turns the active reflection question into a simulated observe/challenge/verify/revise/learn proof turn with same-or-safer outcomes; the AI control/thought/memory/planner chain chooses one bounded proof experiment before any trust change; the AI executive reducer fuses that loop with the active mind, session, deliberation, capability contract, and Supabase isolation gates into a single public action, conflict register, and selected safe proof; the AI council votes across model, market, data, risk, learning, and operations roles before any slate-level posture is trusted; the model ensemble audits each candidate with independent model, market, posterior, data, memory/calibration, risk, and actionability judges; the feature matrix exposes the numeric training vector and provenance for each candidate before historical learning can trust it; model governance blocks learned guardrails unless corpus volume, real odds, feature snapshots, target labels, backtests, live provenance, and drift evidence pass; the invalidation monitor turns stale beliefs, due monitoring windows, fragile prices, live-state checks, data-intake blockers, and governance blockers into ranked proof jobs; the data intake queue aggregates slate-level provider gaps into run commands, missing env, expected evidence, and verification URLs; the hypothesis lab ranks which thesis should be tested next and what would falsify it; the learning queue makes persistence, settlement, calibration, backtesting, and corpus backfill explicit before learned guardrails can affect live decisions; the operating cycle chooses which observe/diagnose/decide/act/verify/learn stage owns the next proof transition; the agent loop binds the active brain and supervisor runbook into observe, orient, decide, act, and learn phases; the self audit red-teams the loop before action by naming failure modes and mitigations; the repair planner converts those failures into a safe action queue with expected proof; repair verification checks whether current audit/readiness evidence proves each repair, needs rerun, or remains blocked; the supervisor queue ranks that work across all matches in the slate and emits a safe runbook for the next command; deliberation explains the thesis loop; the committee shows role votes and arbitration; the monitoring plan says what must be checked next; the actionability audit decides whether the product should show, watch, or block the candidate; the review loop records the final QA cycle; the research brief turns that final state into a compact analyst note; the decision notebook tracks working assumptions, falsifiers, and operator checks; data coverage says which inputs are provider-backed, computed, mock, stale, or missing; odds intelligence ranks every market; market movement checks whether the live price can still survive realistic shortening; robustness tests whether the thesis survives counterfactual shocks; evaluation plan says how the decision will be graded after settlement. OpenAI is used in bounded modes: wording enhancer, guarded match reviewer, optional slate council critique, and optional cited research critique.

## Context Signal Layer

`src/lib/sports/prediction/contextAdjustment.ts` is the current pre-decision context layer. It produces a `contextAdjustment` object with:

- bounded side probability shifts
- bounded totals/tempo shifts
- data-quality delta
- provider signal list
- risk flags
- remaining missing signals

When provider keys are absent, the MVP feed is explicitly marked `mock-context-feed`. When API-Football, NewsAPI, and weather keys are present, provider-backed football decisions can consume the same signal shape from lineups, injuries, suspensions, standings, live match events, late team-news scans, and venue weather. Basketball and tennis now include deterministic rest/availability, head-to-head, and travel/load proxies inside their sport models; remaining adapters should replace those proxies with provider-backed rest, rotation, player-status, surface, and match-history feeds.

## Live Football Layer

`src/lib/sports/prediction/footballModel.ts` now has a score/minute-aware live branch. When a football fixture is live and includes score state, the model:

- keeps the pre-match expected-goals estimate as the baseline
- scales remaining expected goals by the minute left
- applies a bounded game-state chase/tempo adjustment
- builds a remaining-goal Poisson matrix
- adds remaining goals to the current score to project final scorelines
- feeds live-aware match winner, over/under, BTTS, expected final score, and top scorelines into the same decision engine

The live abstention gate remains active for live sports without an in-play model. For football with score/minute recalibration, the gate becomes a monitored risk instead of a hard block; event feeds for cards, substitutions, injuries, shots, and pressure are still required before production trust.

## Market Prior Layer

`src/lib/sports/prediction/odds.ts` applies the current market-prior adjustment after context signals and before value-edge ranking. For each priced market, the engine:

- converts decimal odds to implied probability
- removes bookmaker margin by normalizing the market
- blends matched model selections toward no-vig probabilities
- lowers the blend when bookmaker margin is high
- raises the blend when model data quality is weaker
- records adjusted markets, selections, average weight, and average bookmaker margin

This gives the agent a controlled way to listen to the market without letting the market erase independent model disagreement.

## Optional LLM Enhancement

`src/lib/sports/prediction/openaiDecisionEnhancer.ts` can call the OpenAI Responses API when `OPENAI_API_KEY` is configured.
`src/lib/sports/prediction/openaiDecisionAgent.ts` runs the guarded AI reviewer used by `agent=1`.

The deterministic decision remains the source of truth for probabilities, bookmaker-margin removal, market math, and the first guardrail pass. The wording enhancer may only improve the visible summary, risks, and next checks. It must not:

- invent injuries, lineups, odds, or weather
- claim certainty
- force a bet
- override the mathematical guardrails

The OpenAI enhancer returns a status contract instead of failing silently:

- `not-requested`
- `not-configured`
- `enhanced`
- `provider-error`
- `invalid-response`

The API includes this under `enhancement`, and the decision payload can include `llmStatus` plus `llmFailureReason`.

The AI reviewer is stricter than the enhancer. It returns structured JSON with:

- review verdict: agree, downgrade, abstain, or needs-data
- recommended action
- confidence and risk adjustment
- rationale
- evidence-cited checks using IDs from the supplied evidence packet
- safety gates that can pass, warn, or block
- unsupported claims that the local engine should not trust
- risk flags
- data gaps
- safer alternatives
- checks before action

The local post-processor enforces a no-upgrade guardrail. The reviewer can lower confidence, raise risk, downgrade a `consider` decision to `monitor` or `avoid`, or abstain entirely. It cannot turn an `avoid` or `monitor` decision into a stronger public recommendation. Blocking AI safety gates force the applied action down to `avoid`, and accepted evidence citations are filtered to IDs that were actually supplied by the deterministic engine.

## Learned Guardrails

`src/lib/sports/prediction/decisionLearningProfile.ts` connects historical training to live decisions. It reads the latest training snapshot and backtest run, then produces a decision-learning profile with:

- training status: active, demo-only, untrained, not-configured, or failed
- real finished fixture count
- sample size
- learned minimum edge
- learned value-edge, data-quality, and market-adjustment weights
- yield, Brier score, and closing-line value
- notes and reason

Only real-data, training-ready backtests can activate learned guardrails. Demo-seed backtests remain visible for smoke testing, but the live engine will not use them to tune recommendations. When active, the profile can:

- change the value-edge and data-quality factor weights
- add a historical-learning factor to the decision score
- enforce a learned minimum-edge abstention gate
- explain in the public trace why a decision used learned thresholds or stayed on defaults

Environment variables:

```txt
OPENAI_API_KEY=
OPENAI_DECISION_MODEL=gpt-5.5
```

The page `/predictions/decision-engine` ranks the football workspace in depth and now starts with a multi-sport thinking layer across football, basketball, and tennis so the operator can see which sport needs the next proof turn.

API routes:

- `/api/sports/decision` returns the full decision board for a day.
- `/api/sports/decision/data-authority` returns the data-family authority layer. It joins data intake, provider ingestion evidence, OddsPadi Supabase isolation, model governance, the training snapshot, and the 10-year corpus plan, then marks each signal family as live-authorized, computed-shadow, dry-run-ready, provider-env blocked, Supabase-proof blocked, training blocked, or fully blocked. The route can expose safe read-only or dry-run-first commands, but provider writes, decision persistence, training, publishing, and public-action upgrades remain locked.
- `/api/sports/decision/world-model` returns the no-write state-of-the-world reducer. It fuses the ranked slate and data authority into pressure cells, unstable assumptions, falsifiers, next observations, and a conservative public posture while keeping persistence, publishing, training, trust raises, and action upgrades locked.
- `/api/sports/decision/world-model-critic` returns the deterministic self-critic over the world model. It converts pressure cells into hypotheses, model/market/data/safety/learning debate roles, stress tests, unresolved questions, a confidence ceiling, and one safe read-only command while keeping OpenAI live review, persistence, publishing, training, trust raises, and public-action upgrades locked.
- `/api/sports/decision/model-cards` returns the audited model cards for football, basketball, and tennis. Use `sport=all` for the multi-sport packet or a single sport for one card. Each card exposes the actual formula family, parameters, markets, feature provenance, training corpus counts, governance checks, upgrade path, and no-train/no-publish/no-upgrade controls.
- `/api/sports/decision/action-sandbox` returns the safe-execution gate for the supervisor runbook, including dry-run safety, blocked env, abort conditions, and post-run proof.
- `/api/sports/decision/activation-runbook` returns the supervised MVP activation sequence. It orders Supabase project proof, environment secrets, schema verification, provider dry-runs, OpenAI review, local build, Netlify env and production smoke checks, training corpus proof, and write-mode approval while exposing only safe read-only or `dryRun=1` commands.
- `/api/sports/decision/agent-kernel` returns the top-level agent turn. It wraps metacognition, AI handoff, citation validation, firewall, authority, proof runner, and review ledger state into observe, reason, challenge, cite, firewall, authorize, act, and learn phases with the current kernel hash, active decision, safe next operation, and no-persist/no-publish/no-train permissions.
- `/api/sports/decision/agent-runtime` returns the operational runtime for the agent. It combines the agent kernel, activation audit, OpenAI orchestrator, autopilot, data intake, and trace ledger into sense, think, review, decide, execute, verify, and learn phases with safe command candidates, runtime locks, active proof state, and no-persist/no-publish/no-train permissions.
- `/api/sports/decision/ai-cognitive-loop` returns the bounded cognitive loop. It composes the operator episode with the AI reasoning gateway, selects one safe read-only next operation, emits a public cycle, drafts memory without persistence, and keeps publish/train/public-action-upgrade locked.
- `/api/sports/decision/ai-cognitive-proof` returns the end-to-end thinking receipt. It composes the cognitive loop, public deliberation, control packet, private thought episode, thought-memory recall, experiment reducer, executive decision, and executive governor into one public proof hash with stage/check counts, next bounded move, OpenAI credential gate, and no-hidden-chain/no-persist/no-publish/no-train/no-trust-raise locks.
- `/api/sports/decision/evidence-graph` returns the slate-level evidence graph. It links objective, slate thinking, match reasoning nodes, graph edges, and the next safe observation into one read-only graph hash; the deep dashboard can also stitch in trace, world-model, and cognitive-proof nodes already computed for that view.
- `/api/sports/decision/thinking-introspection` returns the read-only self-audit over slate thinking, working memory, reflection, next-turn rehearsal, and evidence graph. It names the current belief, primary doubt, next question, weakest layer, and safe proof command without exposing hidden chain-of-thought or unlocking persistence, publishing, training, trust raises, or public-action upgrades.
- `/api/sports/decision/ai-context-dossier` returns the AI review input dossier. It selects the active target, packages model/market/data/training/agent context, scores AI readiness, lists evidence-bound questions, emits a strict Responses API payload preview, and includes a deterministic no-write fallback review. Add `run=1` or `review=1` to request the configured OpenAI context review; provider errors, missing keys, and invalid responses keep the fallback review and never grant persistence, publishing, training, or public-action upgrade permission.
- `/api/sports/decision/ai-control` returns the deliberation-aware control packet. It composes the AI deliberation, agent runtime, capability contract, and operator turn, then emits the current control state, active action/stance, next bounded move, run mode, missing env placeholders, verification target, stage gates, escalation level, unlock evidence, and forbidden actions. Add `run=1` to refresh the review/control path first. The route can identify read-only and explicit dry-run proof moves, but persistence, publishing, training, and public-action upgrades remain locked.
- `/api/sports/decision/ai-executive` returns the AI executive decision reducer. It joins the active mind, reasoning alignment, cognitive loop, AI decision session, public deliberation, control packet, experiment episode, capability contract, Supabase isolation proof, and provider-ingestion evidence into one phase map, conflict register, final same-or-safer action, selected bounded proof command, executable policy synthesis, feedback-loop state, executive cycle state, next-turn governor, operator runbook, proof observation receipt, draft-only memory note, evidence packet, strict OpenAI review payload preview, deterministic fallback review, and hard no-persist/no-publish/no-train controls. Add `observe=1` to fetch and hash the selected approved local GET proof route without shell execution or writes. Add `run=1` to observe proof first, then request the guarded executive AI review; missing keys or invalid output fall back deterministically.
- `/api/sports/decision/ai-thought-episode` returns the private thought-episode draft. It composes the AI control packet and replayable operator episode into observe, challenge, decide, authorize, replay, and store steps, plus a compact `op_ai_thought_episodes` payload. `GET` is read-only. `POST` requires `ODDSPADI_ADMIN_TOKEN` and a valid OddsPadi Supabase service role, and stores only the private audit trace; it cannot publish, train, stake, or upgrade the public action.
- `/api/sports/decision/ai-thought-memory` returns private thought-memory recall. It reads recent `op_ai_thought_episodes` rows with the server Supabase client, scores similarity against the current thought episode, names recurring blockers and lessons, and recommends only capture, replay, or hold actions. Missing Supabase config returns a structured `not-configured` state. Recall can guide proof replay or reduce trust, but it cannot raise trust, publish, train, stake, or upgrade the public action.
- `/api/sports/decision/ai-experiment-planner` returns the next bounded proof experiment. It consumes the control packet, thought episode, and thought memory, then selects one read-only or dry-run candidate with objective, hypothesis, falsifier, verification command, expected evidence, rejected alternatives, and hard no-OpenAI/no-persist/no-publish/no-train controls.
- `/api/sports/decision/ai-experiment-observer` returns the observation receipt for the selected experiment. Without `run=1` it only resolves the approved target. With `run=1` it internally fetches the selected local GET proof route, hashes the response, records status signals, and returns observed, warning, failed, or blocked while keeping shell execution, OpenAI calls, persistence, publishing, training, and public-action upgrades locked.
- `/api/sports/decision/ai-experiment-state` returns the reduced AI experiment state. It joins the planner and observer, classifies the proof as pending, observed, retry, hold-trust, or blocked, and emits a conservative state patch, gates, memory draft, and next safe experiment command. Add `run=1` to observe the proof first; the reducer can still only hold, retry, reduce trust, or record a shadow proof.
- `/api/sports/decision/ai-experiment-episode` returns the replayable AI experiment episode. It joins the observer and state reducer into plan, observe, reduce, memory, and next steps, then emits a final same-or-safer patch, stability packet, replay commands, narrative, and memory draft. Add `run=1` to observe the proof before replaying the episode. If the observer response is itself failed, warning, or missing a response hash, the route may make one extra approved local GET observer attempt and select the strongest receipt. If the observed replay exceeds its bounded timeout, the route falls back to the approved no-run receipt and reports that in stability.
- `/api/sports/decision/ai-deliberation` returns the public decision deliberation packet. It joins the AI decision session with the shadow evaluation, then emits role positions for model, market, data, safety, review, and learning; value/review/learning/public-action hypotheses; falsifiers; decision questions; final same-or-safer stance; and next proof. Add `run=1` to run the review/evaluation path first. The response never exposes hidden chain-of-thought and keeps persistence, publishing, training, and public-action upgrades locked.
- `/api/sports/decision/ai-decision-session` returns the combined AI decision session. It joins the context dossier, operator reasoning gateway, slate AI council, authority gate, and MVP audit into one session hash, public trace, review-run ledger, metareasoning packet, evidence packet, deterministic fallback review, and final same-or-safer session action. The metareasoning packet explains why the engine can act, hold, repair, or block by exposing consensus score, evidence debt, contradiction count, action pressure, trust ceiling, strongest objection, required evidence, and a public thought trace. Add `run=1` to request every configured AI review lane and then submit the whole session to a top-level strict JSON-schema Responses API reviewer. Missing OpenAI config, provider errors, invalid schema output, or unsupported evidence IDs fall back deterministically and never grant persistence, publishing, training, or public-action upgrade permission.
- `/api/sports/decision/ai-session-evaluation` returns the no-write shadow evaluation for the AI session. It composes the session with the learning queue, calibration snapshot, and historical training snapshot, then emits a learning-readiness score, session/outcome/calibration/backtest/corpus/permission gates, next evaluation task, shadow grade plan, safe proof commands, and hard no-persist/no-publish/no-train controls. Add `run=1` to run the session review lanes first, then evaluate the resulting session for future outcome grading.
- `/api/sports/decision/training/data-blueprint` returns the no-write training data blueprint. It joins the multi-sport 10-year corpus plan with current training snapshots, required service-role-only `op_` storage tables, row deficits, Supabase/provider/backtest phases, unlock gates, and one safe dry-run command. It does not run providers, apply migrations, write rows, train models, publish picks, persist decisions, or upgrade public action.
- `/api/sports/decision/ai-citations` returns the evidence-citation validator for AI output. It checks handoff evidence IDs, citation schema, prompt grounding, completed review citation metadata, no-persistence controls, and firewall alignment before AI output can be trusted.
- `/api/sports/decision/ai-council` returns the slate-level council with role votes, active candidate, evidence docket, guardrails, critical questions, and next operation. Add `review=1` for the optional OpenAI critique, which cannot upgrade the deterministic council action.
- `/api/sports/decision/ai-firewall` returns the acceptance firewall for AI output. It checks the handoff packet, completed review status, no-persistence flag, same-or-safer action rule, proof ledger, and metacognition state before marking output accepted, pending-review, quarantined, or blocked.
- `/api/sports/decision/ai-handoff` returns the real AI review handoff packet before model submission. It includes the Responses API request preview, strict JSON schema, active target, metacognition state, evidence IDs, packet/input hashes, missing env, blocked proof reasons, and no-upgrade/no-persist/no-publish contract.
- `/api/sports/decision/ai-orchestrator` returns the guarded OpenAI review controller. It selects active-match and slate targets, exposes the evidence contract, thinking-role protocol, safe no-persist review commands, missing env, and optional `run=active-match|slate|1` execution without decision persistence.
- `/api/sports/decision/ai-reasoning-gateway` returns the operator-level AI reasoning gateway. It builds a strict JSON-schema Responses API request from the operator episode, emits a public observe/frame/challenge/decide/verify/learn trace, filters citations to supplied evidence IDs, and falls back deterministically when OpenAI is not configured or fails validation.
- `/api/sports/decision/ai-review-ledger` returns the append-only AI review manifest with ledger hash, prompt-manifest hash, review targets, thinking roles, proof dependencies, denied inputs, latest run records, and no-upgrade/no-persist controls.
- `/api/sports/decision/authority` returns the final product authority state. It combines deterministic action, belief revision, AI handoff, AI firewall, proof runner, and review ledger into authorized, supervised, or blocked output with the authoritative action, source, public posture, and display/apply/persist/publish/train gates.
- `/api/sports/decision/autopilot` returns the bounded agent controller with one ranked next proof action, public reasoning ledger, run/publish/persist gates, mode, guardrails, and verification URL.
- `/api/sports/decision/belief-revision` returns the belief-revision layer. It combines counterfactual shocks, proof blockers, data gaps, and AI-review ledger state into hold, weaken, needs-evidence, or retire decisions for each current belief.
- `/api/sports/decision/capability-contract` returns the product capability map for the decision engine: active, shadow, proof-ready, and locked capabilities with one live-readiness score and next safe command.
- `/api/sports/decision/operator-turn` returns the single safe operator turn: public trace, next bounded operation, proof criteria, fallback action, no-write permissions, state patch, and proof URLs.
- `/api/sports/decision/operator-receipt` returns the proof receipt for the selected operator turn. Add `run=1` to observe the approved local read-only proof route, response hash, HTTP status, summarized signals, and no-write locks.
- `/api/sports/decision/operator-state` returns the proof-derived state transition for the selected operator receipt. Add `run=1` to observe the proof first, then classify the state patch and next safe turn.
- `/api/sports/decision/operator-episode` returns the replayable operator episode. Add `run=1` to observe proof first, then inspect the turn, receipt, state, final patch, timeline, replay commands, and memory draft together.
- `/api/sports/decision/counterfactual-lab` returns deterministic shock tests for market moves, adverse team news, lineup/context changes, data-quality decay, decision-boundary pressure, and robustness cases. It reports action-after-shock, score delta, EV/edge after shock, survival state, falsifier, mitigation, and a safe read-only verification command.
- `/api/sports/decision/data-intake` returns the slate-level provider queue for data gaps, missing env, expected evidence, and verification URLs.
- `/api/sports/decision/provider-ingestion-evidence` returns the first real-data operator packet. It joins the data-intake queue, 10-year corpus plan, training snapshot, and Supabase project/schema proof into provider signal cards, dry-run commands, storage targets, model impact, missing env, proof URLs, and hard no-write/no-train/no-publish controls.
- `/api/sports/decision/data-gap-resolver` returns the ranked data-layer proof plan. It explains which data gap to fix next, which safe command can run, which env/Supabase blockers remain, and what each proof unlocks for models, odds, training, and AI review.
- `/api/sports/decision/launch-commander` returns the compact launch blocker commander. It ranks Supabase proof, 10-year corpus proof, provider data, OpenAI review, MVP requirements, and responsible controls into one next safe proof while keeping provider writes, decision persistence, training-row persistence, model training, publishing, and public-action upgrades locked.
- `/api/sports/decision/env-activation-matrix` returns the safe environment activation matrix. It lists required key names, local/Netlify/MCP destinations, public versus server-secret exposure, configured/missing/invalid/proof-needed states, proof URLs, and next actions without printing or writing secret values.
- `/api/sports/decision/training/corpus-proof` returns the executive 10-year corpus proof. It binds the multi-sport corpus plan, current training counts, Supabase proof binder, signal coverage, sport deficits, phase gates, and next safe command while keeping provider writes, training-row persistence, learned weights, publishing, and public-action upgrades locked.
- `/api/sports/decision/supabase-proof-binder` returns the read-only Supabase proof packet. It binds expected OddsPadi project ref, repo MCP config, live MCP proof expectation, credential state, expected `op_` schema, local migration declarations, foreign-schema sentinels, proof URLs, and hard no-write/no-train/no-publish controls.
- `/api/sports/decision/evidence-refresh` returns the scheduler that ranks the next proof or provider refresh after signal reliability and model trust run.
- `/api/sports/decision/evidence-refresh-verification` returns receipts that compare scheduled refresh work against the current evidence state.
- `/api/sports/decision/evidence-transition` returns the proof-gated state transition after verification: advance, retry-proof, hold, or reduce-trust.
- `/api/sports/decision/feature-matrix` returns numeric feature vectors, feature provenance, training-readiness scores, and the historical training export contract.
- `/api/sports/decision/hypothesis-lab` returns the slate-level experiment queue with hypothesis status, falsifier, expected signal, scenario impact, and verification command.
- `/api/sports/decision/information-gain` returns the read-only proof planner that ranks evidence-refresh, data-intake, hypothesis, counterfactual, and belief-revision candidates by expected uncertainty reduction, blocker clearing, action-flip potential, learning value, and execution cost.
- `/api/sports/decision/reasoning-alignment` returns the read-only consistency judge between the active decision mind and the information-gain planner. It blocks or watchlists drift when the thought trace, selected command, blocker language, or action-impact explanation does not match the highest-value proof.
- `/api/sports/decision/invalidation-monitor` returns stale-belief, price-refresh, live-state, data-intake, settlement, and governance jobs with commands, missing env, expected proof, verification URLs, and risk if ignored.
- `/api/sports/decision/learning-queue` returns persistence, outcome settlement, calibration, backtest, backfill, and memory-read feedback tasks.
- `/api/sports/decision/metacognition` returns the read-only thought state for the current slate. It joins the brain slate, operating cycle, autopilot, counterfactual lab, belief revision, proof runner, and AI-review ledger into observe, believe, doubt, test, revise, decide, verify, and learn stages with a hash, operating mode, primary doubt, change-my-mind evidence, and no-promote/no-persist/no-publish runbook.
- `/api/sports/decision/mind` returns the consolidated active decision mind. It fuses brain slate, research agent, metacognition, AI orchestrator, handoff, firewall, authority, and activation runbook into one read-only packet with belief, doubts, public thought checks, a thinking trace, confidence budget, falsifiers, evidence gaps, change-my-mind evidence, AI readiness, safe command, hard locks, and proof URLs.
- `/api/sports/decision/multi-sport-thinking` returns the cross-sport attention layer. It composes slate thinking, working memory, reflection, and rehearsal for football, basketball, and tennis, then ranks which sport needs the next read-only proof turn.
- `/api/sports/decision/model-trust` returns the composite trust governor. It combines model governance, calibration, historical corpus, market quality, portfolio pressure, and runtime storage into a trust score, confidence cap, next actions, and hard no-raise/no-learned-weights/no-publish locks.
- `/api/sports/decision/signal-reliability` returns slate-wide feed freshness and reliability for fixtures, history, standings, form, injuries, suspensions, lineups, odds, live scores, events, news, weather, and training, with missing env and proof commands attached.
- `/api/sports/decision/slate-thinking` returns the cross-match thinking queue. It scores every match's support, questions, evidence gaps, blockers, confidence budget, and control-policy pressure, then names the next belief to investigate with a safe read-only verification command.
- `/api/sports/decision/working-memory` returns the agent blackboard: facts, assumptions, doubts, blockers, next actions, learning targets, and guardrails with evidence, commands, verification URLs, and no-promote/no-persist/no-publish locks.
- `/api/sports/decision/reflection` returns the red-team reflection layer over working memory: overconfidence checks, data/provider gaps, action drift, memory/calibration gaps, market fragility, guardrail locks, the next reflection question, and no-promote/no-persist/no-publish/no-train locks.
- `/api/sports/decision/model-ensemble` returns the independent model-judge audit for top candidates, including conservative ensemble action, agreement, conflicts, blockers, and next checks.
- `/api/sports/decision/model-governance` returns the learned-guardrail governance gate with corpus, provenance, target-label, backtest, drift, and runtime checks.
- `/api/sports/decision/model-math-proof` returns the cross-sport formula proof for the active deterministic models: football Poisson/xG/Dixon-Coles, basketball rating/pace/efficiency/rest/spread/moneyline, and tennis surface Elo/form/head-to-head/fatigue/round/set/total-games logic.
- `/api/sports/decision/mvp-audit` returns the top-level requirements audit for the original MVP plan: data layer, sport models, odds intelligence, AI explanation path, Supabase/training readiness, Netlify readiness, and responsible locks.
- `/api/sports/decision/requirement-pulse` returns the compact first-screen requirements pulse for the same original MVP plan using the current data authority, multi-sport model cards, odds rows, AI review readiness, cognitive proof receipt, evidence graph, thinking introspection, training blueprint, and world critic controls.
- `/api/sports/decision/netlify-readiness` returns deployment readiness for Netlify: build config, Next runtime assumptions, non-secret route smoke commands, production env requirements, Supabase bootstrap state, agent runtime state, and locked scheduled-backfill/publishing controls.
- `/api/sports/decision/context-signal-proof` returns the cross-sport context proof packet. It audits fixtures, historical results, standings, home/away, recent form, injuries, suspensions, lineups, odds, live scores, events, news, weather, and training coverage, then lists bounded probability shifts, provider gaps, risk flags, and no-persist/no-publish/no-train/no-trust-raise locks.
- `/api/sports/decision/odds-board` returns the cross-sport value board for football, basketball, and tennis. It ranks audited selections by value/watch/avoid action, EV, edge, data quality, control-policy pressure, and risk while leaving promote/persist/publish/train locked.
- `/api/sports/decision/odds-intelligence-proof` returns the read-only money-feature proof packet. It exposes ranked selection math, market-family summaries, implied probability, no-vig probability, model probability, edge, EV, bookmaker margin, risk, safer alternative, avoid reason, proof checks, and no-stake/no-publish/no-train locks.
- `/api/sports/decision/operating-cycle` returns the top-level observe, diagnose, decide, act, verify, and learn controller with one next proof transition.
- `/api/sports/decision/portfolio-risk` returns paper-only exposure pressure from the odds board. It uses fractional Kelly math, confidence/risk/data-quality/control/actionability haircuts, sport/market/match caps, non-value exclusions, cap reasons, and no-stake/no-promote/no-publish locks.
- `/api/sports/decision/agent-loop` returns the slate-level observe-orient-decide-act-learn loop with active match focus, phase statuses, autonomy mode, evidence ledger, action contract, and verification URL.
- `/api/sports/decision/brain` returns the slate-level agent brain queue: belief state, thesis, committee vote, next tool, blockers, thinking steps, and control policy for matches needing attention.
- `/api/sports/decision/brain/memory` returns replayable agent-brain traces from recent persisted decision runs when the Supabase memory store contains new-format snapshots.
- `/api/sports/decision/repair-plan` returns the audit-driven repair queue with commands, missing env, expected evidence, trust deltas, and verification URLs.
- `/api/sports/decision/repair-verification` returns proof status for each repair action by comparing the latest repair plan with current self-audit and readiness evidence.
- `/api/sports/decision/rehearsal` returns the simulated next proof turn from reflection: observe, challenge, verify, revise, and learn steps; the next read-only command; expected evidence; fallback outcomes; and hard no-write locks.
- `/api/sports/decision/research-agent` returns the cited research dossier for the active slate candidate. Add `review=1` for optional OpenAI critique constrained to supplied evidence IDs.
- `/api/sports/decision/evidence-refresh` returns the proof-driven refresh scheduler. It converts signal reliability, data-intake gaps, model-trust gates, portfolio pressure, and odds-board state into ranked read-only or `dryRun=1` tasks with expected evidence, missing env, unlocks, and no-write locks.
- `/api/sports/decision/evidence-refresh-verification` returns the proof-check layer after the scheduler. It marks refresh receipts as verified, ready-to-check, blocked, or waiting by comparing the scheduled task to current signal reliability, data-intake, model-trust, odds-board, and portfolio evidence.
- `/api/sports/decision/evidence-transition` returns the state controller after verification. It chooses whether the engine may advance in read-only shadow mode, retry a safe proof, hold for external evidence, or reduce trust, while keeping persistence, publishing, write imports, and training locked.
- `/api/sports/decision/activation-audit` returns the launch controller for live agent mode: Supabase project isolation, MCP proof, schema verification, provider keys, odds intelligence, OpenAI critique, governance, trace-payload readiness, autopilot safety, and Netlify runtime gates.
- `/api/sports/decision/capability-contract` returns the operator-facing readiness contract. It turns runtime, evidence transition, authority, model trust, data reliability, and Supabase bootstrap state into concrete capability levels and keeps shadow/proof capabilities distinct from live-ready ones.
- `/api/sports/decision/operator-turn` returns the operator-facing run packet. It chooses one safe read-only or explicit `dryRun=1` command, names the objective, records observe/frame/hypothesize/challenge/decide/execute/verify/learn phase statuses, and leaves persistence, publishing, and training locked.
- `/api/sports/decision/operator-receipt` returns the operator-facing observation receipt. It does not run shell commands; with `run=1` it fetches the selected local `GET /api/sports/decision/...` proof URL, summarizes the JSON wrapper, hashes the response body, and keeps persistence, publishing, and training locked.
- `/api/sports/decision/operator-state` returns the operator-facing state reducer. It interprets the receipt as pending-proof, proof-observed, advance-shadow, needs-repair, or blocked, then emits a trust/confidence patch, memory draft, state gates, and next safe command without writing state.
- `/api/sports/decision/operator-episode` returns the operator-facing episode record. It ties together turn, receipt, and state into a five-step timeline, names the final patch, exposes safe replay commands, and keeps the memory draft unpersisted until write approval is explicit.
- `/api/sports/decision/ai-thought-episode` returns the AI-facing private memory draft over the control packet and operator episode. `POST` stores the private trace only when the admin header and OddsPadi Supabase service-role gate are valid.
- `/api/sports/decision/ai-thought-memory` returns AI-facing private memory recall over stored thought episodes. It never treats memory as permission to publish or train.
- `/api/sports/decision/ai-experiment-planner` returns the AI-facing next experiment planner. It can select proof, not execute or upgrade it.
- `/api/sports/decision/ai-experiment-observer` returns the AI-facing experiment receipt. It can observe an approved local proof route, not execute shell commands or raise trust.
- `/api/sports/decision/ai-experiment-state` returns the AI-facing experiment state reducer. It can record shadow proof, hold, retry, or reduce trust, not persist, publish, train, ask OpenAI, or upgrade an action.
- `/api/sports/decision/ai-experiment-episode` returns the AI-facing experiment episode. It can replay and explain the plan-observe-reduce loop, including observer stability, not persist, publish, train, ask OpenAI, or raise trust.
- `/api/sports/decision/ai-executive` returns the AI-facing executive reducer and review contract. It can choose the next bounded read-only or dry-run proof from the thinking lanes, observe that approved local GET proof with `observe=1`, and request a same-or-safer model critique with `run=1`, not persist, publish, train, raise trust, or upgrade an action.
- `/api/sports/decision/ai-reasoning-gateway` returns the AI-facing episode reviewer. Add `run=1` to attempt the configured OpenAI review; the response still keeps persistence, publishing, training, and public-action upgrade locked.
- `/api/sports/decision/proof-runner` returns supervised proof receipts from activation gates, trace nodes, replay steps, and autopilot actions. Receipts include observed evidence, expected evidence, safe command status, evidence hash, missing env, verification URL, and forbidden actions.
- `/api/sports/decision/trace-ledger` returns the replayable audit ledger: trace hash, persistence input hash, claim nodes, replay commands, verification URLs, and op_decision_runs payload readiness.
- `/api/sports/decision/self-audit` returns the slate-level trust critique: trust score, findings, red-team questions, affected matches, mitigations, and next audit action.
- `/api/sports/decision/supervisor` returns the cross-match supervisor queue and a runbook for the top safe read-only/dry-run action, including a preflight verdict for env readiness, admin-token requirements, missing keys, and command safety.
- `/api/sports/decision/[matchId]` returns one match decision.
- `/api/sports/decision/[matchId]/brain` returns the compact agent brain trace for one match.
- `/api/sports/decision/[matchId]?enhance=1` returns the deterministic decision and, when configured, an LLM-enhanced version.
- `/api/sports/decision/[matchId]?agent=1` returns the guarded AI-reviewed decision and an `aiAgent` audit object. Combine with `persist=1` to store the final guarded decision.
- `/api/sports/decision/[matchId]?persist=1` stores the final decision report in Supabase when server writes are configured.
- `/api/sports/decision/status` returns runtime readiness for deterministic core, OpenAI, Supabase project preflight, data-provider keys, provider adapter coverage, configured signal coverage, and live-runtime signal coverage.
- `/api/sports/decision/supabase-bootstrap` returns the safe Supabase activation handoff: expected OddsPadi project ref, local link state, MCP proof state, migration manifest, expected `op_` tables, service-key validity, football/basketball/tennis dry-run commands, missing env, and hard locks for writes, persistence, and training.
- `/api/sports/decision/supabase-project-isolation` returns the wrong-project guard: expected OddsPadi ref/URL, detected env and CLI refs, MCP proof ref, known foreign-project blockers, key proof, schema proof, next action, safe proof commands, and locks for client reads, memory reads/writes, migrations, write backfills, training, and publishing.
- `/api/sports/decision/self-test?enhance=1&persist=1` runs a sample engine check and optionally tests OpenAI/Supabase paths.
- `/api/sports/decision/memory` returns recent stored decision runs, persisted brain replay availability, average reliability, outcome counts, and calibration readiness.
- `/api/sports/decision/calibration` previews current measured calibration and returns the latest stored calibration run.
- `POST /api/sports/decision/calibration` stores a new calibration run. It requires `ODDSPADI_ADMIN_TOKEN` and `x-oddspadi-admin-token`.
- `/api/sports/decision/training` returns historical fixture, odds, event, news, context, feature, and backtest readiness.
- `POST /api/sports/decision/training?sport=football|basketball|tennis` runs and stores the sport-specific backtest when enough historical fixtures/matches exist. It uses real provider data by default; `includeDemo=1` is only for demo-seed smoke tests. It requires `ODDSPADI_ADMIN_TOKEN` and `x-oddspadi-admin-token`.
- `GET /api/sports/decision/training/football-runtime-replay` executes a no-write football replay through the exact `modelFootballMatch` runtime entrypoint and returns a compact feature-contract, invocation-count, execution-hash, calibration, player-form coverage, and rejection summary. `POST` stores the same proved replay in `op_backtest_runs`. Both methods require `x-oddspadi-admin-token`; neither applies weights, promotes a model, publishes picks, or stakes. A completed benchmark run remains research evidence only: governance passes backtest parity only when the stored model-identity receipt proves the current runtime entrypoint and feature contract. Exact-runtime football learning also remains shadow-only until chronology-safe player-form signals cover at least 60% of eligible fixtures.
- `POST /api/sports/decision/training/ingest` validates and ingests normalized historical football, basketball, and tennis fixtures/matches, teams/players, features, odds, event snapshots, news signals, standings/context snapshots, player availability, lineups, weather snapshots, raw payload archives, and ingestion-run audit rows. It defaults to `dryRun`; pass `dryRun=0` for writes. `mode=demo` generates synthetic pipeline-test fixtures that are never counted as real training readiness.
- `POST /api/sports/decision/training/provider-sync` fetches provider data and maps it into the normalized ingestion layer. It supports `provider=api-football` for fixture history, optional `includeEvents=1` API-Football event archives, optional `includeNews=1` NewsAPI archives, optional `includeContext=1` standings/injuries/suspensions/lineups/weather archives, and explicit `includePlayerStats=1` finished-match player-performance ingestion. Player-performance responses separate fetched, normalized, fixture-requested, fixture-covered, stored, and readback-verified counts. A fixture is covered only when both teams have at least 11 participants with recorded minutes; incomplete player payloads return `invalid-response` and are not stored. Daily inference and runtime replay use only performances from kickoffs strictly earlier than the prediction clock. It also supports `provider=api-basketball` for basketball game history, `provider=api-tennis` for tennis event history, and `provider=the-odds-api` for historical h2h odds snapshots. It defaults to `dryRun`; pass `dryRun=0` only after reviewing the normalized counts and provider budget.
- `POST /api/sports/decision/training/backfill` plans and executes capped multi-season/date imports. It supports API-Football and API-Basketball season ranges, API-Tennis date slices, and The Odds API historical date batches for odds snapshots. It defaults to `dryRun`, caps jobs with `maxJobs`, and requires the same admin header.
- `GET /api/sports/decision/training/corpus-plan` returns the read-only 10-year operating plan: target seasons, league list, provider job counts, required env, schema tables, first dry-run command, and blockers before write-mode backfills are allowed.
- `GET /api/sports/decision/training/multi-sport-corpus-plan` returns the read-only football, basketball, and tennis training contract. It exposes implemented provider dry-runs, target competitions, model features, required providers, estimated row volume, implemented backtest model keys, and remaining env/data blockers before learned guardrails can be trusted.
- `POST /api/sports/decision/outcomes` stores a settled or pending outcome for the learning loop. It requires `ODDSPADI_ADMIN_TOKEN` and `x-oddspadi-admin-token`.

## Supabase Persistence

`src/lib/supabase/server.ts` creates a server-only Supabase client from:

```txt
SUPABASE_PROJECT_REF=wncwtzqipnoqwmqlznqn
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

The public client env is also tracked for future browser reads:

```txt
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Decision persistence lives in `src/lib/sports/prediction/decisionPersistence.ts`.
It writes to `public.op_decision_runs` only when `persist=1` is requested and server env is present. Stored rows include `context_adjustment`, and the model snapshot includes market-prior adjustment, belief state, probability trace, attribution, uncertainty decomposition, decision boundary, AI protocol, reasoning graph, tool orchestration, tool execution, control policy, monitoring plan, actionability audit, review loop, research brief, decision notebook, data coverage, odds intelligence, market movement, robustness audit, evaluation plan, AI evidence audit when available, deliberation, committee, case memory, `brain`, and `thinkingTrace` so future calibration can audit which signals moved probabilities and which evidence gaps blocked or supported the agent before value-edge ranking.

Readiness does not rely on env presence alone. `/api/sports/decision/status`, `/api/sports/decision/supabase-project-isolation`, `/api/sports/decision/activation-audit`, and `/predictions/decision-engine` use a shared verified readiness path that first checks the OddsPadi project target, public key readiness, server key presence, server key validity, repo-local MCP visibility, and the expected `op_` schema manifest. The project-isolation route adds a dedicated wrong-project guard: AfroTools `zpclagtgczsygrgztlts` and LATMtools `obtgxgbcoychelycvrfj` refs block OddsPadi work, and live schema mutations stay blocked until an OddsPadi-scoped MCP session or `ODDSPADI_SUPABASE_MCP_PROJECT_REF=wncwtzqipnoqwmqlznqn` proves the target. It performs lightweight server-side table checks across the expected `op_` schema plus a memory read when Supabase server env is present; missing/inaccessible tables, invalid project keys, or an `Invalid API key` response downgrade persistence and training readiness. If the configured ref or URL points at a non-OddsPadi project, readiness is blocked and the server Supabase client refuses to initialize.
Missing env returns a structured `skipped` result instead of throwing.

The migration keeps the MVP audit tables server-only by revoking `anon` and `authenticated` table access and granting service-role access. This matches the newer Supabase default where new public tables are not assumed to be Data API readable.

## Learning Loop

The decision engine now has a memory and outcome layer:

- `src/lib/sports/prediction/decisionMemory.ts` reads recent stored decisions from Supabase and summarizes agent memory.
- `src/lib/sports/prediction/decisionOutcomes.ts` validates and stores outcome rows.
- `src/lib/sports/prediction/decisionCalibration.ts` computes win rate, Brier score, average edge, closing-line value, ROI units, and buckets by confidence/health.
- `op_prediction_outcomes` stores settled or pending results for specific decision runs.
- `op_calibration_runs` stores future backtest/calibration summaries such as win rate, Brier score, closing-line value, and ROI units.

The first calibration threshold is 30 settled outcomes. Before then, the UI reports that the engine is still collecting evidence instead of pretending it has a trained track record.

The live prediction surface now runs sport-specific deterministic models for football, basketball, and tennis. Each active sport also requests its sport-specific learning profile before building decisions, so training-readiness, demo-only, failed, or active learned-guardrail state can appear in football, basketball, and tennis decisions. The multi-sport thinking layer then compares those sport slates in one packet before the deeper football workspace, so a basketball or tennis blocker can own the next proof turn. Learned thresholds stay locked until real provider imports, odds snapshots, and sport-specific backtest runs exist for that sport.

The odds-board layer is the cross-sport odds-intelligence surface. It flattens each decision's market audits into ranked rows with raw implied probability, no-vig probability, bookmaker margin, fair odds, model probability, edge, EV, risk, safer alternative, avoid reason, actionability status, control status, learning state, and a read-only per-match proof URL. The board can find value candidates, but it cannot publish picks or train the model.

The context-signal proof layer is the cross-sport data-risk proof before odds and portfolio conclusions are trusted. It joins `dataCoverage` with `contextAdjustment` so operators can see the exact requested data families, provider/mock/missing counts, bounded side/draw/total shifts, injury/news/lineup/weather/live risk flags, and next provider action. The proof can hold or lower trust when context is thin, but it cannot persist, publish, train, raise trust, or upgrade a public action.

The model-math proof layer is the compact formula audit for the real deterministic engines. It turns each sport's diagnostics into a slate-level proof with model versions, formulas, required inputs, present signals, proxy/missing inputs, normalized match-winner checks, expected score examples, market probabilities, and signal scores. It exists to prove the football, basketball, and tennis models are actual mathematical engines; it still cannot train, persist, publish, use learned weights, or upgrade a public action.

The odds-intelligence proof layer is the operator audit for that surface. It answers the money-feature questions directly: what is the implied probability, what is the no-vig market probability, what does the model believe, how large is the edge, what is the EV, what can invalidate it, which softer alternative exists, and why should a row be avoided. The proof checks must pass before portfolio-risk can be treated as more than paper math, and all stake, publish, persist, train, and public-action-upgrade controls remain locked.

The portfolio-risk layer answers the next operator question: if several value candidates exist, which ones create concentrated exposure? It converts positive-EV board rows into paper-only units with fractional Kelly math, then caps by candidate, sport, market, and match while applying confidence, risk, data-quality, control-policy, and actionability haircuts. This is an audit surface, not staking advice, and it cannot persist, publish, promote, train, or stake.

The model-trust layer is the self-confidence governor. It combines model governance, settled calibration sample size, calibration accuracy, historical corpus depth, market quality, portfolio concentration, and runtime storage into one trust score. The layer can hold the public confidence cap at low or medium when evidence is thin; it cannot raise confidence, use learned weights, stake, persist, publish, or train.

The signal-reliability layer is the data freshness board. It consumes every decision's data-coverage signals plus the slate data-intake queue, then scores each feed by provider backing, freshness, mock/missing/stale counts, required production gaps, and missing environment keys. It tells the agent which feed must be refreshed next before trust can rise.

The evidence-refresh scheduler is the operator runbook after reliability and trust checks. It ranks read-only proof tasks, safe `dryRun=1` provider commands, model-trust reruns, portfolio checks, and odds-board checks by status, priority, source, and affected matches. It can tell an operator what to refresh first, but it cannot write to Supabase, publish picks, train models, or treat a planned refresh as completed evidence.

The evidence-refresh verifier closes that loop. It reads the scheduler's task list and compares each task to the current reliability, data-intake, model-trust, odds-board, and portfolio state. A receipt is only verified when the current evidence satisfies the expected condition; safe commands that still need proof remain ready-to-check, and missing provider/admin/Supabase keys stay blocked.

## Historical Training Spine

Decision memory answers: "How have the agent's shown decisions performed?"

Historical training answers: "How would the model have performed across years of finished fixtures and bookmaker prices?"

Case memory answers: "Does this decision look like recent stored decisions, and should those comparisons change confidence right now?"

The new training layer is built around:

- `src/lib/sports/training/footballBacktest.ts`, `basketballBacktest.ts`, and `tennisBacktest.ts` - pure sport-specific backtest engines with no-vig bookmaker implied probability, value-edge picks, Brier score, log loss, ROI, yield, CLV, and learned weights.
- `src/lib/sports/prediction/modelIdentity.ts` - canonical runtime-versus-benchmark model identities. Benchmark runners cannot grant runtime parity. A runtime receipt must prove a passed feature contract, a positive evaluated sample, equal entrypoint invocation/evaluation counts, and an execution hash; matching a model-key string alone cannot unlock learning.
- `src/lib/sports/training/footballRuntimeReplay.ts` - fail-closed football runtime replay. It rebuilds ordered pre-match form from earlier results only, shares daily league-strength and Elo-to-runtime-rating preprocessing, evaluates stored player availability and lineup freshness at the original kickoff clock, calls `modelFootballMatch`, records proper scoring/calibration, and rejects rows whose identities, chronology, history floor, timestamps, or representable venue contract are incomplete.
- `src/lib/sports/training/footballChronologyFeatures.ts` - chronology-v3 feature materializer. It stores newest-first W/D/L, an exclusive as-of timestamp, prior-match counts, the runtime feature-contract version, and leakage-safe provenance before each fixture outcome updates state.
- `src/lib/sports/training/trainingRepository.ts` - Supabase reader/writer for normalized historical fixtures, features, odds, and stored backtest runs.
- `src/lib/sports/training/historicalIngestion.ts` - normalized provider ingestion for leagues, teams, fixtures, team features, odds snapshots, standings snapshots, player availability, lineups, weather snapshots, event snapshots, news signals, feature snapshots, raw payload archive, and ingestion-run audit.
- `src/lib/sports/training/providerSync.ts` - provider adapters for API-Football fixture history, API-Football event/context archives, API-Basketball game history, API-Tennis event history, NewsAPI article archives, OpenWeather forecast snapshots, and The Odds API historical h2h odds snapshots.
- `src/lib/sports/training/historicalBackfill.ts` - capped batch planner/executor for multi-season API-Football imports and historical odds date batches.
- `src/lib/sports/training/corpusBackfillPlan.ts` - read-only 10-year corpus planner for the MVP. The default target is football seasons 2016-2025 across Premier League, La Liga, Serie A, Bundesliga, Ligue 1, and UEFA Champions League. It keeps African/regional league expansion on a provider-confirmation watchlist rather than inventing league ids.
- `src/lib/sports/prediction/decisionLearningProfile.ts` - converts latest backtest results into live decision-profile guardrails while blocking demo data from tuning production decisions.
- `op_fixtures` - finished fixtures, scores, provider IDs, season/round, data quality, and xG fields when available.
- `op_fixture_team_features` - pre-match home/away Elo, attack/defense, recent form, rest days, injuries, suspensions, and lineup confirmation.
- `op_standings_snapshots` - league-table position, points, form, goals for/against, and played-count context for pre-match team strength.
- `op_odds_snapshots` - bookmaker odds observations, implied probability, margin-adjusted probability, and closing-price marker.
- `op_player_availability_snapshots` - provider injury, doubt, suspension, and availability rows used to derive absence counts and context risk.
- `op_lineup_snapshots` - confirmed or predicted formations and player lists for lineup freshness and absences.
- `op_live_match_events` - minute-by-minute provider events such as goals, red cards, substitutions, and other in-play signals for future in-play modeling.
- `op_news_signals` - provider news observations with source, published timestamp, signal type, sentiment, confidence, impact score, entities, and raw article metadata.
- `op_weather_snapshots` - venue forecast observations with precipitation, wind, temperature, humidity, condition, and tempo-impact score.
- `op_backtest_runs` - stored model performance summary and learned threshold suggestions.

The minimum recommended football corpus is 1,000 real finished fixtures with odds before the UI marks the model as training-ready. Demo-seed rows are useful for smoke-testing ingestion/backtest mechanics, but they are counted separately and do not make the product trained. The eventual target is 10 years of historical fixtures, team/player context, lineups, injuries/suspensions, standings snapshots, opening and closing odds, live events, news signals, and weather where relevant.

After creating a fresh Supabase project, the safe order is: prove the project ref, refresh `SUPABASE_SERVICE_ROLE_KEY` from the new project, verify `/api/sports/decision/status` no longer reports `credential-error`, check `/api/sports/decision/supabase-project-isolation`, prove the MCP session is OddsPadi-scoped, apply the `op_` migrations, then run the football, basketball, and tennis `dryRun=1` provider commands from `/api/sports/decision/supabase-bootstrap`.

The 10-year collection and evaluation sequence is intentionally staged:

1. Import fixture/context history first through API-Football dry-runs, then write-mode backfills after Supabase schema verification and provider counts look right.
2. Use stored kickoff times to generate fixture-derived odds jobs for opening, pre-kickoff, and closing-line snapshots. The current The Odds API date-batch path is used as a market-history probe, not as the final full odds corpus.
3. Run benchmark backtests only after real fixtures/matches and odds are present; these remain benchmark evidence.
4. Run the admin-gated football runtime replay in no-write mode, review its feature-contract and rejection counts, then `POST` the same route to store the receipt. Runtime parity still does not authorize promotion by itself.

Provider sync examples:

```bash
curl -X POST "http://localhost:3013/api/sports/decision/training/provider-sync?provider=api-football&league=39&season=2025&date=2025-08-01&includeEvents=1&includeNews=1&includeContext=1&includePlayerStats=1" \
  -H "x-oddspadi-admin-token: $ODDSPADI_ADMIN_TOKEN"

curl -X POST "http://localhost:3013/api/sports/decision/training/backfill?provider=api-football&league=39&seasonFrom=2016&seasonTo=2025&includeEvents=1&includeNews=1&includeContext=1&maxJobs=10" \
  -H "x-oddspadi-admin-token: $ODDSPADI_ADMIN_TOKEN"

curl "http://localhost:3013/api/sports/decision/training/corpus-plan"

curl "http://localhost:3013/api/sports/decision/training/multi-sport-corpus-plan"

curl "http://localhost:3013/api/sports/decision/training/football-runtime-replay?limit=50000&minPriorMatches=3" \
  -H "x-oddspadi-admin-token: $ODDSPADI_ADMIN_TOKEN"

curl -X POST "http://localhost:3013/api/sports/decision/training/football-runtime-replay?limit=50000&minPriorMatches=3&minSample=1000" \
  -H "x-oddspadi-admin-token: $ODDSPADI_ADMIN_TOKEN"

curl -X POST "http://localhost:3013/api/sports/decision/training/provider-sync?provider=the-odds-api&sportKey=soccer_epl&date=2025-08-01T12:00:00Z" \
  -H "x-oddspadi-admin-token: $ODDSPADI_ADMIN_TOKEN"
```

These examples dry-run by default. Add `dryRun=0` only when provider quotas, Supabase env, provider counts, and normalized rows look correct. API-Football uses `API_FOOTBALL_KEY`, `APISPORTS_KEY`, or `SPORTS_API_KEY`; The Odds API uses `THE_ODDS_API_KEY` or `ODDS_API_KEY`.

The readiness layer separates provider setup into configured provider keys, live-runtime adapters, historical-sync-ready adapters, and live-runtime signal coverage. The live football adapter uses API-Football for fixtures, scores, match events, lineups, injuries, suspensions, and standings, The Odds API for current H2H odds, NewsAPI for bounded late team-news risk scans, and OpenWeather for venue-city forecast context. Basketball uses API-Basketball when configured and can otherwise normalize The Odds API event identity, moneyline, spread, and total markets into a provider-backed fixture. Those provider context signals flow through `contextAdjustment` before value-edge ranking, so they can move probabilities within bounded limits and update the data-coverage audit. `ODDS_API_FOOTBALL_SPORT_KEY` and `ODDS_API_BASKETBALL_SPORT_KEY` override the default competition keys. Current odds responses are cached for five minutes by default. Runtime historical-odds fallback is disabled unless `ODDS_API_ALLOW_HISTORICAL_RUNTIME=true`, preventing ordinary page reads from consuming the higher historical quota cost. Runtime API-Football reads can be restricted with `API_FOOTBALL_LEAGUE_IDS`; enrichment is capped and concurrency-limited so one dashboard render cannot fan out across every worldwide fixture. The read-only ten-season learning dossier is cached per server instance for 15 minutes by default; configure `ODDSPADI_PUBLIC_HISTORY_CACHE_TTL_MS`, or set it to `0` to disable this cache.

The production-shaped execution path is `GET|POST /api/sports/decision/autonomous-cycle`. `GET` is always a no-write preview. Authenticated `POST` fetches provider-backed fixtures, executes the deterministic model and odds intelligence, performs at most three grounded OpenAI reviews, and writes each evidence state once using `(fixture_external_id, input_hash)` idempotency. A previously reviewed evidence hash is reused without another model call. Netlify's scheduled sweep invokes a background worker at minutes 5 and 35; defaults are 12 fixtures and two new AI reviews per run, configurable with `ODDSPADI_AUTONOMOUS_FIXTURE_LIMIT` and `ODDSPADI_AUTONOMOUS_AI_LIMIT`. Settlement remains a separate scheduled phase so final results and calibration cannot contaminate pre-match reasoning.

Each stored cycle also opens one paper-only `op_prediction_outcomes` row for the strongest match-winner probability, whether the action is consider, monitor, or avoid. This makes all model opinions auditable. `GET|POST /api/sports/decision/autonomous-settlement` matches pending rows to provider final scores, grades the selection with deterministic score rules, records closing odds when available, and runs a new calibration snapshot only after a fresh settlement. `(decision_run_id, market, selection)` uniqueness makes scheduler retries idempotent and prevents a settled row from being reverted to pending.

Current remote state:

- Project: OddsPadi `wncwtzqipnoqwmqlznqn`
- All 13 local migrations are applied to the linked remote project through `20260710061000_autonomous_outcome_idempotency`; local and remote migration histories match.
- Decision and outcome idempotency constraints are live for `(fixture_external_id, input_hash)` and `(decision_run_id, market, selection)`.
- `op_model_versions`, `op_decision_runs`, `op_provider_ingestion_runs`, `op_raw_provider_payloads`, `op_prediction_outcomes`, and `op_calibration_runs` exist in `public`.
- RLS is enabled on the verified `op_` tables.
- A persistence smoke wrote sample `epl-001` decision rows through `/api/sports/decision/epl-001?persist=1`, including agent stages, contradiction checks, scenario matrix, abstention gates, and context-adjustment signals.
- `/api/sports/decision/memory` reads recent stored decisions through the server-side Supabase client, and new persisted rows include `model_snapshot.brain` plus `model_snapshot.thinkingTrace` for replaying the agent brain and confidence budget without recomputing the match.
- Supabase advisors did not run from this CLI profile because `SUPABASE_DB_PASSWORD` was not set.

## Production Upgrade Path

Next upgrades:

- link the intended Netlify site, sync server-only environment variables, deploy a preview, and smoke both scheduled workers before production DNS cutover
- expand news source allowlists, richer article scoring, and minute-by-minute live event features
- add market-specific alternatives when bookmaker prices exist
- import 10 years of historical fixtures, odds, standings, lineups, injuries, news, weather, and live events into the new training tables
- accumulate settled autonomous outcomes, run scheduled backtests, and promote learned thresholds only after shadow calibration gates pass
- add a user-visible audit log for changed verdicts after odds/news movement

Local migration scaffold:

```txt
supabase/migrations/20260624000100_oddspadi_decision_engine_foundation.sql
```

Do not apply future OddsPadi migrations to AfroTools or LATMtools. Confirm the linked project is `wncwtzqipnoqwmqlznqn` before every remote push.
