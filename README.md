# OddsPadi MVP

OddsPadi is a mobile-first sports odds intelligence product for `oddspadi.com`. It removes bookmaker margin where possible, blends deterministic model probabilities with a bounded no-vig market prior, calculates expected value, and helps users review value edge, confidence, risk, and live score readiness. The product is analysis only: sports outcomes are uncertain and predictions are not guarantees.

## Local Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm test
npm run build
```

Production builds target Node 22, matching `netlify.toml`. If a local shell is on Node 24, `npm run build` reroutes the Next production build through `node@22` to avoid the Next.js startup hang seen on Node 24.

## Deployment Channel

OddsPadi deploys only through the channel locked in `deploy-channel.json`: Netlify project `oddspadi` (`3ba4bf38-60ec-4bc4-b49f-aca9495a9aa2`), `https://oddspadi.com`, release branch `main`, and Supabase project `wncwtzqipnoqwmqlznqn`.

```bash
npm run deploy:verify:local
npm run deploy:preview
npm run deploy:production
```

Both deploy commands verify the linked Netlify project. The online verification also checks that the production Supabase and site URL variables point to OddsPadi without printing any secret values. Production deployment additionally refuses to run outside `main`.

## MVP Routes

- `/` - OddsPadi homepage with prediction preview, value picks preview, supported sports, and responsible-use notice.
- `/predictions` - today's football, basketball, and tennis predictions with date, sport, league, country, confidence, EV, and search filters.
- `/predictions/[matchId]` - match detail with odds, probabilities, edge calculation, form, placeholders, and explanation.
- `/predictions/decision-engine` - AI decision workspace ranking football, basketball, and tennis attention by verdict, evidence quality, missing signals, and safer alternatives.
- `/predictions/value-picks` - positive-edge picks with medium or high confidence.
- `/predictions/history` - mock previous predictions, outcomes, accuracy, and simple ROI simulation.
- `/live-scores` - live-scores-ready page backed by the mock provider.
- `/predictions/bet-slip` - placeholder for future bet slip review.

## API Routes

All API responses use:

```json
{
  "success": true,
  "data": {}
}
```

Routes:

- `/api/sports/fixtures`
- `/api/sports/matches/[matchId]`
- `/api/sports/decision`
- `/api/sports/decision/[matchId]`
- `/api/sports/decision/adversarial-panel`
- `/api/sports/decision/briefing`
- `/api/sports/decision/data-authority`
- `/api/sports/decision/activation-runbook`
- `/api/sports/decision/action-sandbox`
- `/api/sports/decision/agent-kernel`
- `/api/sports/decision/agent-runtime`
- `/api/sports/decision/ai-cognitive-loop`
- `/api/sports/decision/ai-cognitive-proof`
- `/api/sports/decision/evidence-graph`
- `/api/sports/decision/explanation-audit`
- `/api/sports/decision/thinking-introspection`
- `/api/sports/decision/ai-context-dossier`
- `/api/sports/decision/ai-control`
- `/api/sports/decision/ai-deliberation`
- `/api/sports/decision/ai-decision-session`
- `/api/sports/decision/ai-executive`
- `/api/sports/decision/ai-experiment-episode`
- `/api/sports/decision/ai-experiment-observer`
- `/api/sports/decision/ai-experiment-planner`
- `/api/sports/decision/ai-experiment-state`
- `/api/sports/decision/ai-session-evaluation`
- `/api/sports/decision/ai-thought-episode`
- `/api/sports/decision/ai-thought-memory`
- `/api/sports/decision/ai-citations`
- `/api/sports/decision/ai-contract-audit`
- `/api/sports/decision/ai-council`
- `/api/sports/decision/ai-firewall`
- `/api/sports/decision/ai-handoff`
- `/api/sports/decision/ai-orchestrator`
- `/api/sports/decision/ai-reasoning-gateway`
- `/api/sports/decision/ai-review-ledger`
- `/api/sports/decision/agent-loop`
- `/api/sports/decision/authority`
- `/api/sports/decision/autopilot`
- `/api/sports/decision/belief-revision`
- `/api/sports/decision/brain`
- `/api/sports/decision/brain/memory`
- `/api/sports/decision/[matchId]/brain`
- `/api/sports/decision/capability-contract`
- `/api/sports/decision/operator-turn`
- `/api/sports/decision/operator-receipt`
- `/api/sports/decision/operator-state`
- `/api/sports/decision/operator-episode`
- `/api/sports/decision/context-signal-proof`
- `/api/sports/decision/counterfactual-lab`
- `/api/sports/decision/data-intake`
- `/api/sports/decision/provider-ingestion-evidence`
- `/api/sports/decision/world-model`
- `/api/sports/decision/world-model-critic`
- `/api/sports/decision/evidence-refresh`
- `/api/sports/decision/evidence-refresh-verification`
- `/api/sports/decision/evidence-transition`
- `/api/sports/decision/feature-matrix`
- `/api/sports/decision/hypothesis-lab`
- `/api/sports/decision/invalidation-monitor`
- `/api/sports/decision/learning-queue`
- `/api/sports/decision/metacognition`
- `/api/sports/decision/mind`
- `/api/sports/decision/model-cards`
- `/api/sports/decision/model-ensemble`
- `/api/sports/decision/model-governance`
- `/api/sports/decision/model-math-proof`
- `/api/sports/decision/model-trust`
- `/api/sports/decision/multi-sport-thinking`
- `/api/sports/decision/odds-board`
- `/api/sports/decision/odds-intelligence-proof`
- `/api/sports/decision/mvp-audit`
- `/api/sports/decision/netlify-readiness`
- `/api/sports/decision/operating-cycle`
- `/api/sports/decision/portfolio-risk`
- `/api/sports/decision/repair-plan`
- `/api/sports/decision/repair-verification`
- `/api/sports/decision/rehearsal`
- `/api/sports/decision/research-agent`
- `/api/sports/decision/self-audit`
- `/api/sports/decision/signal-reliability`
- `/api/sports/decision/slate-thinking`
- `/api/sports/decision/supervisor`
- `/api/sports/decision/status`
- `/api/sports/decision/supabase-bootstrap`
- `/api/sports/decision/supabase-project-isolation`
- `/api/sports/decision/self-test`
- `/api/sports/decision/activation-audit`
- `/api/sports/decision/proof-runner`
- `/api/sports/decision/trace-ledger`
- `/api/sports/decision/working-memory`
- `/api/sports/decision/reflection`
- `/api/sports/decision/memory`
- `/api/sports/decision/calibration`
- `/api/sports/decision/training`
- `/api/sports/decision/training/ingest`
- `/api/sports/decision/training/provider-sync`
- `/api/sports/decision/training/backfill`
- `/api/sports/decision/training/corpus-plan`
- `/api/sports/decision/training/multi-sport-corpus-plan`
- `/api/sports/decision/training/data-blueprint`
- `/api/sports/decision/training/readiness`
- `/api/sports/decision/training/shadow-candidates`
- `/api/sports/decision/training/promotion-governor`
- `/api/sports/decision/training/shadow-comparison`
- `/api/sports/decision/training/activation-runbook`
- `/api/sports/decision/outcomes`
- `/api/sports/predictions`
- `/api/sports/value-picks`
- `/api/sports/live-scores`
- `/api/sports/history`

Supported query params include `date`, `sport`, `league`, `country`, `confidence`, and `q` where relevant.
Use `/api/sports/decision/[matchId]?enhance=1` to request OpenAI summary enhancement. Use `/api/sports/decision/[matchId]?agent=1` to run the guarded AI reviewer, which can agree, downgrade, abstain, or require more data, but cannot upgrade a weak/no-edge decision. Add `persist=1` to store the final decision run when Supabase is configured.
Use `/api/sports/decision/data-authority` to inspect which data families are allowed to influence live decisions, which are dry-run-only, and which are blocked by provider env, OddsPadi Supabase proof, schema storage, or training governance. It joins data intake, provider ingestion, Supabase isolation, model governance, the training snapshot, and the 10-year corpus plan while keeping provider writes, decision persistence, model training, publishing, and public-action upgrades locked.
Use `/api/sports/decision/original-brief-coverage` to map the original MVP brief to the current implementation. It reports each data-layer, prediction-engine, odds-intelligence, AI-explanation, 10-year corpus, Supabase/Netlify, and safety-control requirement as real, shadow, or blocked with proof URLs and next actions.
Use `/api/sports/decision/launch-commander` as the compact first-screen launch blocker commander. It ranks Supabase proof, 10-year corpus proof, provider data, OpenAI review, MVP requirements, and responsible controls into the next safe proof while keeping provider writes, decision persistence, training-row persistence, model training, publishing, and public-action upgrades locked.
Use `/api/sports/decision/env-activation-matrix` to inspect the required local and Netlify environment key names without printing values. It classifies Supabase, MCP, admin, provider, OpenAI, and Netlify rows by destination, exposure, configured/missing/invalid/proof-needed state, proof URL, and next action while keeping secret writes, secret printing, production deploys, training, persistence, and publishing locked.
Use `/api/sports/decision/openai-key-diagnostic` to troubleshoot why live OpenAI review is locked without printing or validating the key. It distinguishes missing runtime key, suspicious key shape, model override state, review-lane readiness, and the next safe command while keeping key creation, secret writes, OpenAI calls, persistence, publishing, training, and public-action upgrades locked.
Use `/api/sports/decision/explanation-audit` to verify that every surfaced decision explanation covers the model thesis, market edge or avoid logic, risk disclosure, news/context caveats, safer alternatives, next checks, and no-action-overreach locks. It is read-only, does not call OpenAI, and cannot persist, publish, train, or upgrade public action.
Use `/api/sports/decision/world-model` to inspect the agent's current no-write world state. It fuses ranked match beliefs with data authority into pressure cells, unstable assumptions, falsifiers, the next observation, and a public posture while keeping persist, publish, train, trust-raise, and public-action upgrades locked.
Use `/api/sports/decision/world-model-critic` to inspect the deterministic self-critic over that world state. It turns pressure cells into hypotheses, debate roles, stress tests, confidence ceilings, unresolved questions, and the next safe read-only command while keeping OpenAI live review, persistence, publishing, training, trust raises, and public-action upgrades locked.
Use `/api/sports/decision/model-cards?sport=all` to inspect the actual football, basketball, and tennis model cards. Each card exposes formulas, parameters, markets, feature provenance, training corpus counts, governance checks, upgrade path, and hard no-train/no-publish/no-upgrade controls.
Use `/api/sports/decision/ai-review-readiness` to inspect whether the OpenAI review lanes are configured without making a model call. It lists the operator reasoning, context dossier, decision session, executive review contracts, schema names, `store=false` guarantees, deterministic fallbacks, missing env, the linked cognitive proof receipt, evidence graph, thinking introspection, and locked no-persist/no-publish/no-train controls.
Use `/api/sports/decision/supabase-proof-binder` to bind the Supabase target, repo MCP config, live MCP proof expectation, server-key status, expected `op_` schema, local migration declarations, and foreign-schema sentinels into one read-only activation artifact. It keeps provider writes, decision persistence, model training, public publishing, and public-action upgrades locked until the OddsPadi project, MCP proof, credentials, and schema all agree.
Use `/api/sports/decision/action-sandbox` to inspect whether the supervisor's primary command is safe to execute. It checks dry-run/read-only safety, admin-token requirements, missing env, local target, abort conditions, and post-run proof before exposing an executable primary command.
Use `/api/sports/decision/activation-runbook` to turn the MVP audit into an operator runbook. It orders Supabase project proof, environment secrets, schema verification, provider dry-runs, OpenAI review, Netlify smoke checks, training corpus proof, and write-mode approval while exposing only safe read-only or `dryRun=1` commands and hard locking persist, publish, train, and write-backfill.
Use `/api/sports/decision/agent-kernel` to inspect the top-level agent turn. It wraps metacognition, AI handoff, citation validation, firewall, authority, proof, and review ledger state into observe, reason, challenge, cite, firewall, authorize, act, and learn phases with a kernel hash, safe next operation, and hard no-persist/no-publish/no-train permissions.
Use `/api/sports/decision/agent-runtime` to inspect what the agent may safely do right now. It combines the kernel, activation audit, OpenAI orchestrator, autopilot, data intake, and trace ledger into sense/think/review/decide/execute/verify/learn phases, safe read-only or `dryRun=1` commands, runtime locks, and no-persist/no-publish/no-train permissions.
Use `/api/sports/decision/ai-cognitive-loop` to inspect the agent's bounded sense/interpret/deliberate/arbitrate/act/verify/learn cycle. It composes the operator episode with the AI reasoning gateway, selects one safe read-only next operation, drafts memory without persistence, and keeps publishing, training, and public-action upgrades locked. Add `run=1` to observe proof and attempt the configured OpenAI reasoning review first.
Use `/api/sports/decision/ai-cognitive-proof` to inspect the end-to-end thinking receipt. It composes the cognitive loop, public deliberation, control packet, private thought episode, thought-memory recall, experiment reducer, executive decision, and executive governor into one public proof hash with stage/check counts, next bounded move, OpenAI credential gate, and no-hidden-chain/no-persist/no-publish/no-train/no-trust-raise locks.
Use `/api/sports/decision/evidence-graph` to inspect the slate-level evidence graph. It links the objective, slate thinking, per-match reasoning graph nodes, and safe next observation into one read-only graph hash with no-persist/no-publish/no-train/no-trust-raise locks.
Use `/api/sports/decision/thinking-introspection` to inspect whether the engine can name its current belief, primary doubt, reflection question, rehearsal step, evidence graph path, and next safe observation in one read-only receipt. It cannot expose hidden chain-of-thought, persist, publish, train, raise trust, or upgrade public action.
Use `/api/sports/decision/ai-context-dossier` to inspect the review-ready AI input packet. It selects the active target and bundles model probabilities, no-vig odds intelligence, posterior belief, data coverage, feature provenance, training governance, intake blockers, a deterministic review fallback, and a strict Responses API payload preview while keeping publish, persist, train, and public-action upgrades locked. Add `run=1` to request the configured OpenAI context review; if OpenAI is missing or invalid, the route returns the deterministic no-write fallback with an explicit run status.
Use `/api/sports/decision/ai-control` to inspect the deliberation-aware control packet. It combines AI deliberation, agent runtime, capability contract, and operator turn into one control state, bounded next move, run mode, missing env, verification target, stage gates, escalation, and forbidden actions. Add `run=1` to refresh the review/control path first; persistence, publishing, training, and public-action upgrades stay locked.
Use `/api/sports/decision/ai-executive` to inspect the top-level AI executive reducer. It fuses the active mind, reasoning alignment, cognitive loop, AI session, deliberation, control packet, experiment episode, capability contract, Supabase project-isolation state, and provider-ingestion evidence into one public stance, conflict list, selected bounded proof command, executable policy synthesis, feedback-loop state, executive cycle state, next-turn governor, operator runbook, proof observation receipt, memory draft, evidence packet, strict OpenAI review payload preview, deterministic fallback review, and locked controls. Add `observe=1` to fetch and hash the selected approved local GET proof route with no writes. Add `run=1` to observe proof first, then request the guarded executive AI review; the model can agree, downgrade, request evidence, repair, or block, but it cannot persist, publish, train, raise trust, or upgrade a public action.
Use `/api/sports/decision/ai-thought-episode` to inspect the private audit/replay record that combines the AI control packet with the operator episode. It emits a compact thought chain, replay commands, proof URLs, private payload hash, and a guarded `op_ai_thought_episodes` memory draft. `GET` is read-only; `POST` requires `ODDSPADI_ADMIN_TOKEN` and a valid OddsPadi Supabase service role, and still cannot publish, train, stake, or upgrade the public action.
Use `/api/sports/decision/ai-thought-memory` to recall similar private thought episodes from `op_ai_thought_episodes` when Supabase is configured. It compares control hash, operator episode hash, active match, public action, run mode, stage blocks, replay count, and locked publish/train flags, then returns audit-only lessons and the next proof to replay. Recall can lower or hold trust, but it cannot raise trust, publish, train, stake, or upgrade the public action.
Use `/api/sports/decision/ai-experiment-planner` to choose the next bounded proof experiment after control, thought, and memory have been built. It selects one read-only or dry-run candidate, states the hypothesis and falsifier, emits the safe verification command, and keeps OpenAI calls, persistence, publishing, training, trust raises, staking, and public-action upgrades locked. Add `run=1` to refresh the upstream proof path before planning.
Use `/api/sports/decision/ai-experiment-observer` to turn the selected experiment into a no-write receipt. It fetches only approved local GET proof routes when `run=1`, hashes the response, summarizes status signals, and reports observed, warning, failed, or blocked without shell execution, OpenAI calls, persistence, publishing, training, or trust upgrades.
Use `/api/sports/decision/ai-experiment-state` to reduce the selected experiment and observation receipt into a conservative AI state patch. It can record a shadow-only proof, hold trust, retry proof, or reduce trust, but it cannot ask OpenAI, persist, publish, train, raise trust, or upgrade the public action. Add `run=1` to observe the proof first, then reduce the state from the observed receipt.
Use `/api/sports/decision/ai-experiment-episode` to replay the whole AI experiment loop as one audit artifact. It bundles the selected experiment, observer receipt, state reducer, replay commands, final patch, public narrative, stability packet, and memory draft while keeping OpenAI calls, persistence, publishing, training, trust raises, staking, and public-action upgrades locked. When `run=1` is requested and the observer receipt itself fails or lacks a response hash, the episode route may make one extra approved local GET observation attempt before selecting the strongest receipt; if the observed replay times out, it falls back to the approved no-run receipt instead of hanging.
Use `/api/sports/decision/ai-deliberation` to inspect the public decision debate for the active AI session. It combines the AI decision session and shadow evaluation into role positions, hypotheses, falsifiers, decision questions, final safe stance, and next proof. Add `run=1` to run the review/evaluation path first; the deliberation still cannot expose hidden chain-of-thought, publish, persist, train, or upgrade the public action.
Use `/api/sports/decision/ai-decision-session` to inspect the whole no-write AI decision session. It composes the AI context dossier, operator reasoning gateway, slate AI council, authority gate, and MVP audit into one session hash, final same-or-safer action, public trace, review-run ledger, metareasoning packet, evidence packet, deterministic fallback review, and strict Responses API request preview. The metareasoning layer scores cross-lane consensus, evidence debt, contradiction pressure, action pressure, trust ceiling, required evidence, and whether only a read-only shadow move is allowed. Add `run=1` to attempt all configured AI review lanes and then run the top-level session reviewer; missing keys or invalid model output fall back deterministically while keeping persistence, publishing, training, and public-action upgrades locked.
Use `/api/sports/decision/ai-session-evaluation` to grade that AI session in shadow mode against the learning loop. It joins the session, learning queue, calibration snapshot, and historical training snapshot into learning-readiness score, proof gates, next evaluation task, grade plan, and locked controls. Add `run=1` to run the AI decision session first, then evaluate whether it is safe to track as a no-write learning candidate.
Use `/api/sports/decision/ai-citations` to validate that the AI review path is evidence-bound. It checks handoff evidence IDs, citation schema, no-invention prompt language, completed review citation metadata, no-persistence controls, and firewall alignment before AI output can be trusted.
Use `/api/sports/decision/ai-contract-audit` to inspect the full AI review acceptance contract without calling OpenAI. It combines OpenAI key readiness, review-lane schemas, store=false request proof, the append-only review ledger, handoff packet, firewall, citation validator, and same-or-safer action rule into one no-write receipt. It can say whether a guarded review may be requested or accepted, but it still cannot apply AI output to public decisions, persist, publish, train, raise trust, or upgrade public action.
Use `/api/sports/decision/ai-council` to run the slate-level council over the top candidates, role votes, evidence docket, data-intake blocker, self-audit findings, and next operation. Add `review=1` to request the optional OpenAI slate critique; the AI reviewer can agree, downgrade, abstain, or request data, but cannot upgrade the local council action.
Use `/api/sports/decision/ai-firewall` to adjudicate AI review output before it can affect the product. It checks the handoff packet, completed review status, no-persistence flag, same-or-safer action rule, proof ledger, and metacognition state, then returns accepted, pending-review, quarantined, or blocked.
Use `/api/sports/decision/ai-handoff` to inspect the real AI review packet before model submission. It returns the Responses API request preview, evidence IDs, schema, active target, metacognition state, packet hash, input hash, missing env, blocked proof reasons, and no-persist/no-publish/no-upgrade contract.
Use `/api/sports/decision/ai-orchestrator` for the real AI review controller. It selects the active match and slate-review targets, returns the OpenAI evidence contract, thinking-role protocol, safe non-persistent review commands, missing env, and no-upgrade/no-persist guardrails. Add `run=active-match`, `run=slate`, or `run=1` to call the configured OpenAI reviewers without storing a decision run.
Use `/api/sports/decision/ai-reasoning-gateway` for the operator-level AI reasoning gateway. It wraps the replayable operator episode in a Responses API strict JSON-schema request, returns public observe/frame/challenge/decide/verify/learn reasoning, filters citations to supplied evidence IDs, and falls back deterministically when `OPENAI_API_KEY` is missing or the model response is invalid. Add `run=1` to attempt the live OpenAI review without persistence.
Use `/api/sports/decision/ai-review-ledger` for the append-only AI review manifest. It hashes review targets, thinking roles, prompt boundaries, proof dependencies, latest run results, denied inputs, and no-upgrade/no-persist controls so every model review has an auditable contract before persistence or publishing is allowed.
Use `/api/sports/decision/authority` to ask the final product-control question: which action is authoritative right now? It combines deterministic action, belief revision, AI handoff, AI firewall, proof runner, and review ledger into an authorized, supervised, or blocked state with display, apply-AI, persist, publish, and training gates.
Use `/api/sports/decision/autopilot` for the bounded agent controller. It coordinates AI council, invalidation monitor, model governance, action sandbox, learning queue, and operating cycle into one next proof action with run/publish/persist gates and no-upgrade/no-write guardrails.
Use `/api/sports/decision/belief-revision` to convert counterfactual shocks, data gaps, proof blockers, and AI-review ledger state into explicit belief changes: hold, weaken, needs-evidence, or retire. It can lower trust/action but cannot promote, persist, or publish.
Use `/api/sports/decision/capability-contract` to see which AI-engine capabilities are active, shadow-only, proof-ready, or locked. It combines runtime permissions, evidence transition, authority, model trust, provider reliability, and Supabase bootstrap into one live-readiness score, next safe command, blockers, and no-write/no-publish/no-train contract.
Use `/api/sports/decision/operator-turn` to inspect the single safe operator turn. It composes the decision mind, capability contract, evidence transition, agent runtime, and authority into observe/frame/hypothesize/challenge/decide/execute/verify/learn phases with one bounded command, success criteria, fallback action, state patch, and hard no-persist/no-publish/no-train locks.
Use `/api/sports/decision/operator-receipt` to inspect the proof receipt for the selected operator turn. Add `run=1` to fetch only the approved local `GET /api/sports/decision/...` proof URL, hash the observed response, summarize proof signals, and keep shell execution, persistence, publishing, and training locked.
Use `/api/sports/decision/operator-state` to reduce the selected receipt into a proof-derived state patch. Add `run=1` to observe the receipt first, then classify the state as pending-proof, proof-observed, advance-shadow, needs-repair, or blocked with trust/confidence patches and the next safe turn.
Use `/api/sports/decision/operator-episode` to replay the full operator loop. It bundles the selected turn, receipt, and state transition into one episode timeline with final trust/action patch, replay commands, operator narrative, memory draft, and hard no-persist/no-publish/no-train locks. Add `run=1` to build the episode after observing proof.
Use `/api/sports/decision/counterfactual-lab` to stress-test the slate against market, team-news, lineup, weather/context, data-quality, model-boundary, and robustness shocks. It returns action-after-shock, score delta, EV/edge after shock, survival state, falsifier, mitigation, and a safe read-only verification command.
Use `/api/sports/decision/data-intake` to aggregate the slate's fixture, history, standings, form, injury, lineup, odds, live-score, event, news, weather, and training gaps into provider-specific commands, missing environment variables, expected evidence, and verification URLs.
Use `/api/sports/decision/provider-ingestion-evidence` as the first real-data operator packet after creating the Supabase project. It combines data-intake gaps, provider dry-run commands, 10-year corpus coverage, Supabase project/schema proof, storage tables, model impact, and hard no-write/no-train/no-publish locks into one dry-run readiness answer.
Use `/api/sports/decision/data-gap-resolver` to turn the current data-layer gap into ranked proof actions. It combines data authority and provider-ingestion evidence into safe read-only/dry-run commands, missing env, Supabase blockers, expected evidence, model/odds/training/AI unlocks, and locked no-write/no-train/no-publish controls.
Use `/api/sports/decision/feature-matrix` to inspect numeric model features for the current slate. Each feature is tagged provider-backed, computed, mock, or missing, and the response shows whether the vector is ready for the historical training contract.
Use `/api/sports/decision/hypothesis-lab` to rank slate-level experiments from each match's thesis, dissent, scenarios, falsifiers, data gaps, and market-movement risks. It returns the next hypothesis to test, what would falsify it, the expected signal, and a safe verification command.
Use `/api/sports/decision/information-gain` to rank the proof candidates most likely to reduce decision uncertainty next. It compares evidence refresh, data intake, hypothesis, counterfactual, and belief-revision candidates by uncertainty reduction, blocker clearing, action-flip potential, learning value, and execution cost while keeping write, publish, train, and trust-raise actions locked.
Use `/api/sports/decision/reasoning-alignment` to audit whether the active decision mind is pointing at the same next proof as the information-gain planner. It scores proof-language match, source recognition, command alignment, blocker consistency, action-impact agreement, and safety locks before any AI narrative can be trusted.
Use `/api/sports/decision/invalidation-monitor` to detect stale beliefs, due monitoring tasks, fragile market movement, live-state refreshes, data-intake blockers, and governance blockers. It returns ranked jobs with commands, missing env, expected evidence, verification URLs, and the risk of ignoring each stale signal.
Use `/api/sports/decision/learning-queue` to prioritize feedback-loop work: persist decisions, open/settle outcome records, run calibration, run real-data backtests, backfill the historical corpus, and verify memory reads before learned guardrails are allowed to affect live decisions.
Use `/api/sports/decision/metacognition` to inspect the engine's current thought state. It composes brain slate, operating cycle, autopilot, counterfactual shocks, belief revision, proof runner, and AI-review ledger into observe, believe, doubt, test, revise, decide, verify, and learn stages with a hash, current doubt, change-my-mind evidence, safe command, and no-promote/no-persist/no-publish gates.
Use `/api/sports/decision/mind` to inspect the consolidated active decision mind. It fuses brain slate, research agent, metacognition, AI orchestrator, handoff, firewall, authority, and activation runbook into one read-only packet with active belief, doubts, a thinking trace, confidence budget, falsifiers, evidence gaps, change-my-mind evidence, AI readiness, safe next command, hard locks, and proof URLs.
Use `/api/sports/decision/multi-sport-thinking` to inspect the cross-sport attention layer for football, basketball, and tennis together. It composes slate thinking, working memory, reflection, and rehearsal per sport, then names the sport that needs the next read-only proof turn.
Use `/api/sports/decision/context-signal-proof` to inspect the context/data proof packet across football, basketball, and tennis. It joins data coverage and bounded context adjustment into one audit for fixtures, historical results, standings, home/away, form, injuries, suspensions, lineups, odds, live scores, events, news, weather, and training. It shows which signals moved side/draw/total probabilities, which provider feeds are still mock or missing, and keeps persist/publish/train/trust-raise/action-upgrade locked.
Use `/api/sports/decision/odds-board` to inspect the cross-sport value board. It flattens every audited market selection across football, basketball, and tennis, compares model probability to raw and no-vig implied probability, ranks value/watch/avoid candidates by EV, edge, data quality, control-policy state, and risk, then keeps promote/persist/publish/train locked.
Use `/api/sports/decision/odds-intelligence-proof` to inspect the money-feature audit packet. It proves the decimal-odds implied probability, no-vig probability, model probability, edge, EV, bookmaker margin, risk note, safer alternative, avoid reason, market-family summary, and no-stake/no-publish/no-train locks for the ranked selections.
Use `/api/sports/decision/adversarial-panel` to challenge top candidates before action. It composes the model ensemble, odds-intelligence proof, and evidence graph into model-advocate, market-skeptic, data-skeptic, risk-manager, evidence-auditor, and final-arbiter votes with a conservative panel action, safer alternatives, avoid reasons, and no-stake/no-publish/no-train locks.
Use `/api/sports/decision/briefing` for the operator-facing final brief. It composes model math, odds intelligence, the adversarial panel, and the OpenAI key diagnostic into one headline, thesis, counter-thesis, action posture, next evidence list, proof chain, and hard no-stake/no-publish/no-train/no-OpenAI-call locks. `POST` is admin-token guarded and writes to `op_decision_briefings` only when the OddsPadi Supabase service env is configured; otherwise it returns a skipped persistence receipt.
Use `/api/sports/decision/slate-thinking` to inspect the cross-match thinking queue. It scores every match's support, questions, evidence gaps, blockers, confidence budget, and control-policy pressure, then returns the next belief to investigate with a safe read-only verification command.
Use `/api/sports/decision/working-memory` to inspect the agent blackboard. It turns the current slate into facts, assumptions, doubts, blockers, next actions, learning targets, and guardrails with evidence, commands, verification URLs, and no-promote/no-persist/no-publish locks.
Use `/api/sports/decision/reflection` to red-team the working-memory slate before trust can rise. It checks overconfidence, data gaps, provider gaps, action drift, memory/calibration gaps, market fragility, and guardrail locks, then returns the next reflection question with no-promote/no-persist/no-publish/no-train locks.
Use `/api/sports/decision/model-ensemble` to audit each top candidate through independent sport-model, market, posterior-belief, data-quality, calibration/memory, risk/robustness, and actionability judges. The ensemble action is conservative when any judge blocks or contests the base action.
Use `/api/sports/decision/model-governance` to decide whether learned guardrails can affect live decisions. It checks corpus volume, real odds, feature snapshots, target labels, calibration/backtests, live feature provenance, drift coverage, and Supabase runtime storage.
Use `/api/sports/decision/model-math-proof` to inspect the sport-model formulas and diagnostics behind the slate. It proves football Poisson/xG/Dixon-Coles logic, basketball rating/pace/efficiency/rest/spread/moneyline logic, and tennis Elo/surface/form/head-to-head/fatigue/round logic while keeping learned weights, persistence, publishing, training, and public-action upgrades locked.
Use `/api/sports/decision/model-trust` to combine model governance, calibration, historical corpus, market quality, and portfolio pressure into one trust verdict. It caps public confidence and learned-weight usage until settled outcomes, real backtests, provider data, and Supabase runtime gates pass.
Use `/api/sports/decision/evidence-refresh` to rank the next evidence-gathering work after signal reliability and model trust run. It returns read-only proof tasks, dry-run provider refresh tasks, missing env, expected evidence, unlocks, risk if skipped, and hard no-write/no-publish/no-train locks.
Use `/api/sports/decision/evidence-refresh-verification` to compare the refresh queue against the current evidence state. It returns verified, ready-to-check, blocked, and waiting receipts, current evidence summaries, next proof commands, and hard no-trust/no-write locks.
Use `/api/sports/decision/evidence-transition` to choose the next proof-gated state transition after verification. It returns advance, retry-proof, hold, or reduce-trust decisions, pass/watch/block gates, the next safe command when one exists, and hard no-write/no-publish/no-train locks.
Use `/api/sports/decision/mvp-audit` as the top-level requirements audit. It checks the requested data layer, sport models, odds intelligence, AI explanation path, Supabase/training readiness, Netlify deployment readiness, and responsible locks, then returns pass/watch/block counts, launch blockers, proof URLs, and the next safe command.
Use `/api/sports/decision/requirement-pulse` as the compact first-screen version of that audit. It summarizes the original MVP brief across data layer, prediction engine, odds intelligence, AI review, training data, and responsible controls using the current multi-sport model cards, data authority, training blueprint, world critic, AI review readiness, cognitive proof receipt, evidence graph, and thinking introspection.
Use `/api/sports/decision/netlify-readiness` to inspect deployment readiness. It checks `netlify.toml`, Next.js runtime expectations, required Netlify env keys, production route smoke URLs, Supabase bootstrap state, agent runtime state, and keeps scheduled backfills/pick publishing locked.
Use `/api/sports/decision/operating-cycle` for the top-level agent cycle controller. It joins the brain, loop, self-audit, repair planner, repair verifier, supervisor, readiness, and learning state into observe, diagnose, decide, act, verify, and learn stages with one next proof transition.
Use `GET /api/sports/decision/autonomous-cycle` for a read-only preview of the real provider-backed execution queue. Use authenticated `POST /api/sports/decision/autonomous-cycle` to run a bounded closed loop: fetch live fixtures and odds, attach stored historical-strength evidence, execute the deterministic sport model, reuse or request a cited OpenAI critique, and idempotently persist the final guarded decision. The cycle never lets AI upgrade the deterministic action, never applies learned weights automatically, and never publishes or stakes. Netlify schedules the football cycle at minutes 5 and 35. Each football run first stores bounded API-Football standings, availability, lineup, same-day event evidence, and keyless Open-Meteo weather when venue-city and forecast-window evidence permit, then captures provider-backed live feature snapshots before reasoning across a bounded UTC date window. News remains excluded until a licensed source-stamped feed is configured. A separate basketball and tennis cycle runs every two hours, stores only complete provider-backed rows, skips incomplete strength evidence, rotates which sport receives first access to one shared AI-review budget, and persists deterministic monitor/avoid decisions for both sports. `ODDSPADI_AUTONOMOUS_HORIZON_DAYS`, `ODDSPADI_LIVE_CONTEXT_LIMIT`, `ODDSPADI_LIVE_FEATURE_LIMIT`, and `ODDSPADI_AUTONOMOUS_FIXTURE_LIMIT` cap football work. `ODDSPADI_MULTISPORT_HORIZON_DAYS`, `ODDSPADI_MULTISPORT_FIXTURE_LIMIT`, and `ODDSPADI_MULTISPORT_AI_LIMIT` independently cap basketball and tennis work. Standings requests are shared per league-season inside each sync so a full slate does not spend one identical standings request per fixture.

Basketball and tennis settlement runs hourly at minute 50. It recovers recent provider-final scores from The Odds API by event ID, settles `autonomous-shadow` outcomes, refreshes sport-specific calibration after new labels, and labels matching `split=live` feature rows. `ODDSPADI_MULTISPORT_SETTLEMENT_LIMIT` caps each sport per run. Settled evidence remains shadow-only: it cannot train models, promote weights, publish picks, or stake automatically. For a bounded recent-slate proof, run `npx tsx scripts/run-multi-sport-settlement-proof.ts --sport basketball --date YYYY-MM-DD --limit 2`; add `--run` only for authenticated storage and settlement.
Every stored cycle opens one `autonomous-shadow` outcome for the strongest match-winner probability, including `avoid` decisions, so the product cannot hide weak forecasts. `GET /api/sports/decision/autonomous-settlement` previews pending rows. Each authenticated scheduler pass refreshes the pending row with the latest coherent provider price only while the fixture is still pre-kickoff, including capture time, provider identity, and seconds before kickoff. Post-kickoff prices are rejected, and final settlement reuses the stored pre-kickoff quote after bookmaker markets disappear. The worker still requires a provider final score before grading the result and runs calibration only after a newly settled outcome. Scheduler retries reuse both the decision and outcome rows.
Use `/api/sports/decision/portfolio-risk` to inspect paper-only exposure pressure. It takes the odds board, applies fractional Kelly math, confidence/risk/data-quality/control/actionability haircuts, sport/market/match caps, and non-value exclusions, then returns paper units, expected paper return, cap reasons, exclusions, and hard no-stake/no-promote/no-publish locks.
Use `/api/sports/decision/agent-loop` for the slate-level observe-orient-decide-act-learn loop. It binds the agent brain to the supervisor runbook and returns the active match, autonomy mode, phase statuses, evidence ledger, action contract, and verification URL.
Use `/api/sports/decision/self-audit` for the slate-level red-team critique. It returns trust score, critical/high findings, affected matches, audit questions, failure modes, mitigations, and the next audit action before the agent can raise trust.
Use `/api/sports/decision/signal-reliability` to inspect slate-wide data freshness and reliability. It aggregates fixture, history, standings, form, injury, suspension, lineup, odds, live-score, event, news, weather, and training signals, attaches data-intake env blockers and proof commands, and caps trust when feeds are mock, stale, missing, or unverified.
Use `/api/sports/decision/repair-plan` to convert self-audit findings into a prioritized repair queue with safe read-only/dry-run commands, missing env, expected evidence, trust delta, and verification URLs.
Use `/api/sports/decision/repair-verification` to compare the repair queue against the latest self-audit and readiness evidence. It marks each repair as verified, ready to run, blocked, waiting, or needing a rerun, then points operators at the next proof check.
Use `/api/sports/decision/rehearsal` to simulate the next read-only proof turn from reflection. It emits observe, challenge, verify, revise, and learn steps, the next safe command, expected evidence, fallback outcomes, and hard no-promote/no-persist/no-publish/no-train locks.
Use `/api/sports/decision/research-agent` to turn the current slate evidence into a cited research dossier: primary thesis, counter-thesis, evidence statuses, contradictions, open provider questions, and next verification command. Add `review=1` for the optional OpenAI critique; it must cite supplied evidence and cannot invent team news or upgrade the deterministic verdict.
Use `/api/sports/decision/activation-audit` as the launch controller for live agent mode. It combines Supabase project isolation, MCP proof, schema verification, provider keys, odds intelligence, OpenAI critique, model governance, trace payload readiness, autopilot safety, and Netlify runtime evidence into pass/watch/block gates. Do not enable write-mode learning or live publishing while this audit is blocked.
Use `/api/sports/decision/proof-runner` to convert activation gates, trace nodes, replay steps, and autopilot actions into supervised proof receipts. It returns verified/needs-run/blocked receipts, evidence hashes, safe read-only or `dryRun=1` commands, and forbidden actions before any autonomous write or publish step.
Use `/api/sports/decision/trace-ledger` to replay and audit the active decision path. It returns the persistence input hash, trace hash, audit nodes, blocked/watch/pass claims, replay commands, verification URLs, and whether the `op_decision_runs` payload includes a brain trace.
Use `/api/sports/decision/brain` for the slate-level agent brain: belief state, thesis, committee vote, next tool, blockers, and control policy for the matches needing the most attention. Use `/api/sports/decision/[matchId]/brain` for the compact brain trace for one match. Use `/api/sports/decision/brain/memory` to replay stored brain traces from recent persisted decision runs.
Use `/api/sports/decision/memory` to inspect recent stored agent decisions, persisted brain replay availability, and calibration readiness. Outcome writes go through `POST /api/sports/decision/outcomes` and require `ODDSPADI_ADMIN_TOKEN` plus the `x-oddspadi-admin-token` request header.
Use `GET /api/sports/decision/calibration` to preview measured calibration and `POST /api/sports/decision/calibration` with the same admin header to store a calibration run.
Calibration now reports Brier score and skill versus the observed base rate, binary log loss, 10-bin expected and maximum calibration error, a Wilson 95% win-rate interval, ROI yield, and closing-line sample coverage. Stored runs keep these fields in the versioned `calibration_by_confidence.__diagnostics_v1` envelope so older rows remain readable without a schema migration. Passing every quality gate can make a run eligible for operator shadow review only; calibration always returns `canInfluenceLive: false` and never activates learned weights automatically.
Use `GET /api/sports/decision/status` to inspect deterministic core, OpenAI, Supabase project preflight, provider keys, provider adapter coverage, configured signal coverage, and live-runtime signal coverage.
Use `GET /api/sports/decision/supabase-bootstrap` before any live database work. It verifies the expected OddsPadi project ref, local link, MCP proof, migration manifest, expected `op_` tables, Supabase service-key validity, football/basketball/tennis dry-run commands, and hard write/training locks.
Use `GET /api/sports/decision/supabase-project-isolation` to inspect the stricter wrong-project guard. It compares the OddsPadi ref, URL ref, local CLI link, MCP proof env, key proof, and schema proof, blocks known AfroTools/LATMtools refs, and keeps memory writes, migrations, backfills, training, and publishing locked until isolation is proven.
Schema verification also probes known non-OddsPadi sentinel tables such as AfroStream, scholarship, Matchday, payroll, and creator-tool tables. If those are present while the `op_` spine is missing, isolation reports a cross-product block and migration/training locks stay closed.
Use `GET /api/sports/decision/supervisor` to inspect the cross-match supervisor queue. It ranks blocked control gates, next tool tasks, AI-review work, monitoring tasks, and publishable candidates for the current slate, then returns a runbook with the next command, required env, preflight status, missing env keys, safety checks, expected state change, and verification step.
Use `GET /api/sports/decision/training?sport=football|basketball|tennis` to inspect historical-data corpus readiness and `POST /api/sports/decision/training?sport=...` with the same admin header to run/store the sport-specific backtest when enough finished fixtures/matches and odds exist.
By default, training backtests use real provider data only. Pass `includeDemo=1` only for explicitly marked demo-seed smoke tests.
Use `POST /api/sports/decision/training/ingest` to ingest normalized historical football, basketball, and tennis fixtures/matches, teams/players, features, odds, events, news signals, standings/context, availability, lineups, and weather snapshots. It defaults to `dryRun` unless `dryRun=0` is passed, and requires the same admin header.
Use `POST /api/sports/decision/training/provider-sync` to fetch and normalize the first real provider feeds. It supports `provider=api-football` for finished football fixture history, an optional numeric `team` filter for bounded promoted-team or coverage-gap recovery, optional `includeEvents=1` event archives, optional `includeNews=1` NewsAPI archives, optional `includeContext=1` standings/injuries/suspensions/lineups/weather archives, and explicit `includePlayerStats=1` post-match player-performance ingestion. Player rows are idempotent, server-only, and a non-dry-run is successful only after key-level storage readback. It also supports `provider=api-basketball` for basketball game history, `provider=api-tennis` for tennis event history, and `provider=the-odds-api` for historical h2h odds snapshots. It defaults to `dryRun`; pass `dryRun=0` only when the normalized payload and provider budget look correct.
Use `POST /api/sports/decision/training/backfill` for capped multi-job imports. It can plan API-Football or API-Basketball season backfills, API-Tennis date slices, or The Odds API historical date batches. It defaults to `dryRun`, caps jobs with `maxJobs`, and requires the same admin header.
Use `GET /api/sports/decision/training/corpus-plan` to inspect the MVP 10-year corpus plan. It is read-only and returns the 2016-2025 target seasons, core league jobs, odds-history probe plan, required environment variables, schema tables, first dry-run command, and blockers before any write-mode import is attempted.
Use `GET /api/sports/decision/training/multi-sport-corpus-plan` to inspect the 10-year football, basketball, and tennis corpus contract together. It identifies implemented versus planned provider adapters, implemented sport-specific backtest runners, model features, target competitions, estimated row volume, missing env, first safe command, and blockers before any training claim can be trusted.
Use `GET /api/sports/decision/training/data-blueprint` for the operator-level no-write training blueprint. It joins the multi-sport corpus plan with current training snapshots, required service-role-only `op_` tables, row deficits, phase gates, storage/RLS contract, and the next safe dry-run command while keeping provider writes, model training, publishing, persistence, and public-action upgrades locked.
Use `GET /api/sports/decision/training/readiness` for the model-trainability receipt. It answers whether football, basketball, and tennis are trainable yet from the 10-year corpus, which labels and feature snapshots are missing, which model families are blocked, what the first safe backfill proof is, and why learned weights remain shadow-only until real rows, odds, feature parity, completed backtests, and governance pass.
Use `GET /api/sports/decision/training/shadow-candidates` to inspect stored learned-weight candidates from completed historical backtests without activating them. It extracts sport-specific weight payloads, sample sizes, ROI/yield/log-loss/Brier/CLV metrics, promotion blockers, and proof URLs while keeping provider writes, training-row persistence, model training, learned-weight promotion, publishing, and public-action upgrades locked.
Use `GET /api/sports/decision/training/promotion-governor` as the hard gate between shadow learned-weight candidates and model influence. It compares candidates with model cards and governance, returns eligible-shadow/waiting/blocked decisions by sport, and still keeps applying learned weights, promotion, training, persistence, publishing, and public-action upgrades locked.
Use `GET /api/sports/decision/training/shadow-comparison` to simulate learned weights against the current odds board without changing predictions. It shows which selections would pass, downgrade, or stay blocked under learned thresholds while keeping applying weights, promotion, training, persistence, publishing, and public-action upgrades locked.
Use `GET /api/sports/decision/training/activation-runbook` to follow the ordered training activation path. It sequences Supabase corpus proof, capped provider dry-runs, corpus review, feature snapshots, real backtests, shadow candidates, promotion governor, shadow comparison, and manual operator review while exposing only read-only or dry-run evidence and keeping writes, training, learned-weight application, promotion, publishing, and public-action upgrades locked.
Use `GET /api/sports/decision/training/corpus-proof` for the executive 10-year corpus proof. It binds the multi-sport corpus plan, current training counts, Supabase proof binder, signal coverage, deficits, phases, and next safe command while keeping provider writes, training-row persistence, learned weights, publishing, and public-action upgrades locked.

For the new Supabase project, treat "configured" and "verified" as separate states. If `/api/sports/decision/status` reports `credential-error` or `/api/sports/decision/supabase-bootstrap` reports `blocked-invalid-keys`, replace `SUPABASE_SERVICE_ROLE_KEY` with a valid secret/service-role key for project `wncwtzqipnoqwmqlznqn`, restart the app, and rerun the status endpoint before applying migrations or running provider imports.

Run `npm run doctor` while the local server is up to get a sanitized setup report. It checks the OddsPadi project target, key presence/source, live status/bootstrap results, rejected-key state, and the next safe activation actions without printing secrets.

## Prediction Model

The sport models are deterministic and live under `src/lib/sports/prediction/`.

Football lives in `footballModel.ts` and uses a transparent expected-goals, Poisson scoreline, and Dixon-Coles low-score correction engine. It uses:

- home and away team rating
- home advantage
- recent form
- goals for and goals against
- attacking and defensive strength
- league strength placeholder
- bounded context adjustment from provider-backed injuries, suspensions, lineups, standings, weather, news, and live events when available
- live football score/minute recalibration using current score plus remaining-time Poisson expected goals
- bounded Dixon-Coles rho for 0-0, 1-0, 0-1, and 1-1 dependence correction
- data quality score

It outputs match winner, over/under 2.5 goals, both-teams-to-score probabilities, expected goals, top scorelines, uncertainty, Dixon-Coles rho, and model signal diagnostics. Probabilities are bounded between `0` and `1`, and home/draw/away is normalized to approximately `1`. When a football match is live and has score/minute state, the model projects final scorelines from the current score plus remaining expected goals; cards, substitutions, injuries, shot pressure, and momentum still require live event feeds before production trust.

Basketball lives in `basketballModel.ts` and uses team rating, pace, offensive efficiency, defensive resistance, form, home court, rest-day margin, availability/rotation proxies, moneyline probability, spread cover probability, and total-points probability.

Tennis lives in `tennisModel.ts` and uses player Elo, surface-specific strength, recent form, fatigue proxy, head-to-head proxy, travel/load proxy, tournament-round pressure, match-winner probability, set-handicap probability, and total-games probability.

See `docs/prediction-agent-math.md` for the calculation reference.

## AI Decision Engine

The fuller decision layer lives in `src/lib/sports/prediction/decisionEngine.ts`. It turns model diagnostics and market edges into:

- `strong-value`
- `lean-value`
- `watchlist`
- `avoid`
- `insufficient-data`

The report includes a public reasoning trace, weighted decision factors, agent stages, structured deliberation, belief state, probability trace, decision attribution, uncertainty decomposition, decision-boundary thresholds, AI protocol, reasoning graph, tool-orchestration plan, tool-execution audit, control policy, monitoring plan, actionability audit, review loop, research brief, decision notebook, data coverage/provenance audit, odds-intelligence audit, market-movement intelligence, robustness stress test, evaluation plan, a decision committee, case-memory comparison, contradiction checks, scenario matrix, abstention gates, calibration score, evidence quality, missing signals, safer alternatives, avoid reasons, fair-odds comparison, expected value, strongest reviewed edges, risks, and next checks. It never forces a pick when the edge, EV, or confidence threshold is not met.

The tool-orchestration plan turns data gaps into executable agent work: fixtures, historical results, standings, recent form, home/away features, injuries, suspensions, lineups, odds, live state, weather, Supabase training data, decision memory, and guarded OpenAI review each get a status, provider, dependency list, freshness window, decision impact, and next-task ranking.

The tool-execution audit then records what the current run actually used: executed tasks, blocked tasks, waiting tasks, skipped tasks, observed record counts, output signals, decision deltas, and the next run instruction.

The control policy is the final operating layer. It decides whether the agent may publish a value candidate, show only a watchlist item, require a rerun, or block public display. It exposes gates, allowed actions, forbidden actions, primary blocker, visibility, and release criteria.

The supervisor queue scans all decisions for the day and ranks the next operational work across matches. It answers what the agent should do first across the slate, not just within one fixture. Its runbook turns the top item into a safe read-only or dry-run command before any write-gated action is allowed, and its preflight says whether that command can run with the current OpenAI, provider, admin-token, and Supabase env configuration.

The structured deliberation layer gives every decision a primary thesis, dissenting thesis, synthesis, tested hypotheses, and watch items that explain what data would change the engine's mind. The decision mind also emits a thinking trace with belief pressure, a confidence budget, falsifiers, evidence gaps, and a next evidence action. It is not hidden chain-of-thought; it is a product-facing audit object built from the same evidence, market math, scenario matrix, and abstention gates used for the final verdict. Persisted runs store a replayable version at `model_snapshot.thinkingTrace` alongside `model_snapshot.brain`, so memory can show what the agent believed, doubted, and needed next without recomputing the slate.

The slate-thinking queue runs across every match for the day. It scores each belief by support, questions, evidence gaps, blockers, confidence budget, value edge, data quality, actionability, and control-policy state, then names the next belief to investigate. This keeps the agent from getting hypnotized by one attractive EV number when another match has a more urgent missing-provider or control-policy blocker.

The working-memory blackboard is the agent's shared short-term memory for the slate. It separates facts from assumptions, doubts from blockers, and learning targets from guardrails, then gives the safest next verification command. This keeps the product honest about what the engine knows versus what it is still carrying as an unproven MVP assumption.

The reflection layer red-teams that blackboard before trust can rise. It asks whether a positive EV number is creating overconfidence, whether provider gaps or assumptions could flip the edge, whether the current focus would drift beyond the safest authorized posture, and whether memory, market movement, or guardrails still require proof.

The decision-rehearsal layer turns the next reflection question into a simulated proof turn: observe the active doubt, challenge it with the right read-only route, verify same-or-safer authority, revise belief only after proof, and keep learning queued until storage and real-data training are trusted.

The multi-sport thinking layer runs that attention loop across football, basketball, and tennis. It keeps the deep football workspace intact, but the top-level agent now sees every active sport, model version, learning-profile state, value-candidate count, blocker pressure, and next read-only proof command before deciding where to focus.

The context-signal proof layer is the data-risk companion to odds intelligence. It audits the requested data families across football, basketball, and tennis, then shows which injury, suspension, lineup, news, weather, rest, surface, or live-event signals actually moved model probabilities. Mock or missing provider feeds stay visible as trust blockers, and the layer can only lower or hold trust; it cannot persist, publish, train, raise trust, or upgrade a public action.

The model-math proof layer is the readable formula layer for the actual sport engines. It shows football expected-goals plus Poisson/Dixon-Coles score matrices, basketball rating-margin, pace, efficiency, rest, availability, spread, total, and moneyline logic, and tennis surface Elo, recent form, head-to-head, fatigue, tournament-round, set-handicap, and total-games logic. It proves the math is inspectable, but it cannot train or authorize a public pick.

The odds-board layer is the first cross-sport money-feature surface. It uses the existing per-selection odds intelligence to rank every value, watch, and avoid row across football, basketball, and tennis. Each row carries raw implied probability, no-vig implied probability, bookmaker margin, fair odds, EV, edge, model probability, risk, safer alternative, avoid reason, control status, actionability status, learning status, and a read-only proof URL.

The odds-intelligence proof layer is the audit packet behind that money feature. It reuses the odds-board rows and explicitly checks decimal-odds implied probability, no-vig margin removal, model-versus-market edge, expected value, risk/safer-alternative coverage, and no-publish locks. It can explain why the model favors a side and why a selection should be avoided, but it cannot stake, publish, persist, train, or upgrade a public action.

The portfolio-risk layer sits after the odds board. It asks whether multiple attractive edges create too much exposure to one sport, market, or match. It uses fractional Kelly only as paper math, then applies confidence, risk, data-quality, control-policy, actionability, sport, market, and match caps. It cannot stake, promote, publish, persist, or train.

The model-trust layer is the confidence governor. It combines model governance, calibration sample size, Brier score and skill, log loss, expected calibration error, closing-line coverage, historical corpus volume, odds-board quality, portfolio concentration, and runtime storage into one trust score. Calibration quality remains blocked until the run passes the explicit shadow-review gates. The layer can cap or lower confidence, but it cannot raise public confidence, use learned weights, persist, publish, train, or stake.

The signal-reliability layer is the data freshness board. It aggregates each match's coverage signals into slate-level feed health for fixtures, history, standings, form, injuries, suspensions, lineups, odds, live scores, match events, news, weather, and training. It links each weak feed to the data-intake command and missing env so the agent knows what evidence to refresh next.

The belief-state layer records what the agent currently believes about the best available selection: model probability, no-vig market probability, edge, EV, confidence interval, uncertainty score, evidence balance, belief expiry, and invalidation triggers. This gives each recommendation a shelf life instead of letting stale odds or late team news masquerade as current analysis.

The probability-trace layer makes the belief update auditable. It starts from the no-vig market prior, applies weighted model evidence, context, market-calibration, data-quality, case-memory, calibration, and abstention updates in log-odds space, then reports posterior probability, posterior edge, posterior EV, conflicts, and safeguards.

The decision-attribution layer answers why the final action happened. It ranks positive drivers, negative drivers, missing-data drag, decisive factor, net probability movement, model-market gap, value score, and risk score so operators can see whether the decision is supported by model edge, price resilience, provider context, calibration, or blocked by data/risk.

The uncertainty-decomposition layer turns uncertainty into an explicit budget. It scores model, market, data, context, price execution, timing freshness, memory/calibration, and robustness/review buckets, then returns the primary uncertainty, confidence penalty, mitigations, and decision impact.

The decision-boundary layer makes every recommendation falsifiable. It records the probability floor, odds floor, no-vig edge floor, EV floor, score floor, data-quality floor, uncertainty ceiling, context-shock tolerance, and price-shortening room that would flip the current action.

The AI-protocol layer is the public "thinking contract" for the guarded reviewer. It lists the questions answered, audit checks, evidence references, tool/data requests, reviewer guardrails, and handoff instructions. It is not hidden chain-of-thought; it is the structured protocol that lets an OpenAI reviewer critique the deterministic decision without inventing facts or upgrading weak picks.

The reasoning-graph layer links the decision into nodes and edges: objective, model probability, market value, data coverage, uncertainty, boundary, attribution, actionability, robustness, tool requests, and final action. Operators can see which nodes support, challenge, or block the recommendation.

The monitoring-plan layer turns that shelf life into action: next review time, review cadence, priority, watch tasks, stop conditions, and escalation rules. It tells the product what must be refreshed before a pick remains visible and what should downgrade the decision.

The actionability-audit layer asks whether a mathematically positive edge is ready to show as an inspectable value candidate. It scores value/EV, confidence/risk, data quality, context coverage, belief freshness, committee arbitration, monitoring state, case memory, and historical learning, then returns `actionable`, `watch-only`, or `blocked`. Live football can pass the hard in-play gate when the score/minute Poisson model is active, but the audit still requires live event refreshes before trusting a visible edge.

The review-loop layer runs a deterministic agent QA cycle: thesis builder, red team, data-gap checker, repair planner, and final reviewer. It can clear the action, keep it with repairs, recommend a downgrade, or block the recommendation until release criteria are satisfied.

The research-brief layer converts the final post-review decision into an analyst note: headline, executive summary, model thesis, market thesis, risk thesis, data gaps, evidence trail, required checks, analyst posture, and decision clock. This is the compact "what the engine thinks right now" object that can be shown in the UI, persisted, or sent to a guarded reviewer without exposing hidden chain-of-thought.

The decision-notebook layer turns that brief into operations: working assumptions, falsifiers that would kill the thesis, refresh triggers, an operator checklist, and a compact audit trail. It is the agent's visible working memory for the current decision, separate from private chain-of-thought and ready to persist with the decision run.

The data-coverage layer maps the required production checklist to explicit signal status: fixtures for the day, historical results, standings, home/away performance, recent form, injuries, suspensions, lineups, bookmaker odds, live scores, match events, news, weather, and historical training corpus. Each signal is marked `provider-backed`, `computed`, `mock`, `missing`, `stale`, or `not-applicable`, then rolled into a weighted coverage score and "required before trust" list.

The odds-intelligence layer reviews every bookmaker market and selection with raw implied probability, no-vig probability, bookmaker margin, calibrated model probability, fair odds, value edge, EV, confidence, and risk. It ranks top candidates, counts actionable positive-EV selections, flags high-margin markets, and records avoid reasons for selections that do not clear both edge and EV guardrails.

The market-movement layer audits the live price after the edge is found. It calculates fair odds, odds buffer, maximum shortening before the selection loses positive value, target closing-line value, price-move scenarios, downgrade alerts, and the next action if the market moves against the thesis.

The robustness layer stress-tests the candidate against odds shortening, adverse context, data-quality decay, belief expiry, review-loop repair pressure, and actionability downgrade. It reports survival rate, worst case, hedge alternatives, and required rechecks.

The evaluation-plan layer pre-registers how the decision should be judged after the match: settlement market and selection, model probability, no-vig market probability, break-even probability, quoted odds, target closing-line value, success/failure criteria, required outcome signals, learning questions, and post-match actions. This keeps the agent accountable to calibration and closing-line value instead of only producing a pre-match explanation.

The decision committee turns that audit into role-based arbitration. Model advocate, market skeptic, context scout, risk manager, memory analyst, and final arbiter roles each vote consider, monitor, or avoid. The final action remains bounded by deterministic guardrails, and the committee records consensus, unresolved disagreements, and checks that would change the vote.

The case-memory layer compares the current decision against recent stored Supabase decisions using market, selection, model probability, edge, EV, confidence, risk, score, and reliability. Similar cases can keep memory neutral, discount confidence, or trigger a memory abstention gate when stored evidence is weak enough.

Structured context signals run before value-edge ranking through `src/lib/sports/prediction/contextAdjustment.ts`. The current MVP uses an auditable mock context feed when providers are absent, while the provider-backed football runtime can now feed API-Football lineups, injuries, suspensions, standings, live match events, NewsAPI team-news scans, and OpenWeather venue forecasts. That layer adjusts probabilities within bounded limits, updates data quality, and records the remaining missing signals; future providers can replace the remaining mock rest/surface signals without changing the downstream decision engine.

After context adjustment, `src/lib/sports/prediction/odds.ts` applies a bounded market-prior calibration to priced markets. It removes bookmaker margin, nudges model probabilities toward no-vig probabilities based on data quality and overround, then records adjusted markets, selection count, average weight, and average bookmaker margin for later calibration audits.

Optional OpenAI enhancement is available through `src/lib/sports/prediction/openaiDecisionEnhancer.ts` and `/api/sports/decision/[matchId]?enhance=1`. The deterministic decision remains the source of truth for probabilities and market math; the LLM can improve the visible summary, risks, and next checks when `OPENAI_API_KEY` is configured.

The deeper AI reviewer lives in `src/lib/sports/prediction/openaiDecisionAgent.ts` and `/api/sports/decision/[matchId]?agent=1`. It uses a structured Responses API payload to review the model output, evidence, data coverage, missing signals, risks, abstention gates, actionability, and robustness tests. The reviewer receives an evidence packet with stable IDs and must return evidence-cited checks, safety gates, unsupported-claim flags, and checks before action. Local guardrails enforce one-way safety: AI may downgrade from `consider` to `monitor`/`avoid`, or require more data, but it cannot promote an `avoid`/`monitor` decision into a stronger recommendation.

Historical learning is wired through `src/lib/sports/prediction/decisionLearningProfile.ts`. The live decision engine can consume the latest real-data backtest profile to tune value-edge weight, data-quality weight, market-adjustment weight, and minimum-edge abstention gates. Demo-seed backtests are visible as pipeline proof but are never applied to live guardrails.

Operational readiness lives in `src/lib/sports/prediction/decisionReadiness.ts` and is exposed through:

- `/api/sports/decision/status`
- `/api/sports/decision/supabase-bootstrap`
- `/api/sports/decision/supabase-project-isolation`
- `/api/sports/decision/self-test?enhance=1`
- `/api/sports/decision/self-test?persist=1`
- `/api/sports/decision/action-sandbox`
- `/api/sports/decision/agent-kernel`
- `/api/sports/decision/agent-runtime`
- `/api/sports/decision/ai-citations`
- `/api/sports/decision/ai-council`
- `/api/sports/decision/ai-control`
- `/api/sports/decision/ai-deliberation`
- `/api/sports/decision/ai-executive`
- `/api/sports/decision/ai-experiment-episode`
- `/api/sports/decision/ai-experiment-observer`
- `/api/sports/decision/ai-experiment-planner`
- `/api/sports/decision/ai-experiment-state`
- `/api/sports/decision/ai-thought-episode`
- `/api/sports/decision/ai-thought-memory`
- `/api/sports/decision/ai-firewall`
- `/api/sports/decision/ai-handoff`
- `/api/sports/decision/ai-orchestrator`
- `/api/sports/decision/ai-session-evaluation`
- `/api/sports/decision/ai-review-ledger`
- `/api/sports/decision/authority`
- `/api/sports/decision/autopilot`
- `/api/sports/decision/belief-revision`
- `/api/sports/decision/counterfactual-lab`
- `/api/sports/decision/data-intake`
- `/api/sports/decision/feature-matrix`
- `/api/sports/decision/hypothesis-lab`
- `/api/sports/decision/invalidation-monitor`
- `/api/sports/decision/learning-queue`
- `/api/sports/decision/metacognition`
- `/api/sports/decision/mind`
- `/api/sports/decision/model-ensemble`
- `/api/sports/decision/model-governance`
- `/api/sports/decision/mvp-audit`
- `/api/sports/decision/netlify-readiness`
- `/api/sports/decision/operating-cycle`
- `/api/sports/decision/agent-loop`
- `/api/sports/decision/repair-plan`
- `/api/sports/decision/repair-verification`
- `/api/sports/decision/research-agent`
- `/api/sports/decision/self-audit`
- `/api/sports/decision/brain/memory`
- `/api/sports/decision/activation-audit`
- `/api/sports/decision/proof-runner`
- `/api/sports/decision/trace-ledger`
- `/api/sports/decision/evidence-graph`
- `/api/sports/decision/thinking-introspection`
- `/api/sports/decision/memory`
- `/api/sports/decision/calibration`

The self-test now includes read-only AI proof receipts. Its response carries `aiProofs.evidenceGraph` and `aiProofs.thinkingIntrospection` summaries, plus checks for graph construction, public thinking introspection, and control locks that keep persist, publish, train, trust-raise, public-action upgrade, and hidden-chain access disabled while OpenAI and Supabase remain gated.

See `docs/ai-decision-engine.md` for the decision architecture.

`/api/sports/decision/status`, `/api/sports/decision/supabase-project-isolation`, `/api/sports/decision/activation-audit`, and `/predictions/decision-engine` now use a shared verified readiness path. The Supabase preflight separates the OddsPadi project target from public keys, server keys, service-key verification, repo-local MCP visibility, and expected `op_` schema objects. The project-isolation route is the wrong-project guard: it treats AfroTools `zpclagtgczsygrgztlts` and LATMtools `obtgxgbcoychelycvrfj` as blockers for this repo, requires `ODDSPADI_SUPABASE_MCP_PROJECT_REF=wncwtzqipnoqwmqlznqn` before live MCP schema work, and reports separate locks for client reads, decision-memory reads/writes, migrations, provider dry-runs, write backfills, training, and publishing. When Supabase server env vars are present, the app performs lightweight server-side table checks across the expected `op_` schema plus a memory read; missing/inaccessible tables or an invalid service-role key downgrade persistence and training readiness instead of falsely showing Supabase as ready.

## Historical Training And Backtests

The training spine is now separate from decision memory:

- `src/lib/sports/prediction/decisionMemory.ts` reads stored decision runs from Supabase for recent-memory summaries and case-memory comparisons.
- `src/lib/sports/training/footballBacktest.ts`, `basketballBacktest.ts`, and `tennisBacktest.ts` run pure sport-specific backtests with bookmaker-margin removal, value-edge picks, Brier score, log loss, ROI, yield, CLV, and learned threshold suggestions.
- Live football, basketball, and tennis predictions now all request their sport-specific learning profile. Learned guardrails still stay inactive until real provider rows, odds snapshots, and stored backtests pass readiness, but basketball and tennis no longer bypass the training-readiness contract.
- `src/lib/sports/training/trainingRepository.ts` reads normalized Supabase historical rows and stores completed runs in `op_backtest_runs`.
- `src/lib/sports/training/historicalIngestion.ts` validates normalized provider payloads and writes leagues, teams, fixtures, team features, odds snapshots, standings snapshots, player availability, lineups, weather, live event snapshots, news signals, feature snapshots, raw payload archives, and ingestion-run audit rows.
- `src/lib/sports/training/providerSync.ts` maps API-Football fixture history, optional API-Football event/context archives, NewsAPI article archives, OpenWeather forecast snapshots, and The Odds API historical h2h snapshots into the normalized ingestion payload.
- `src/lib/sports/training/historicalBackfill.ts` plans and executes capped multi-season/date provider imports for the 10-year corpus workflow.
- `src/lib/sports/training/corpusBackfillPlan.ts` turns the 10-year training objective into a read-only operating plan: 2016-2025 seasons, core football competitions, provider batches, required env, Supabase schema tables, the first dry-run command, and the later fixture-derived odds workload.
- `src/lib/sports/prediction/decisionLearningProfile.ts` converts the latest historical backtest into a live decision profile. Only real, training-ready data can activate learned thresholds.
- `/predictions/decision-engine` shows historical fixture, odds, event, news, context, feature, backtest readiness, and the 10-year backfill plan.
- `/api/sports/decision/training` exposes corpus counts and admin-triggered backtest runs.
- `/api/sports/decision/training/ingest?mode=demo` can generate explicitly marked synthetic demo fixtures for pipeline testing. Demo rows are counted separately and do not make the model training-ready.
- `/api/sports/decision/training/provider-sync?provider=api-football&league=39&season=2025&date=2025-08-01&includeEvents=1&includeNews=1&includeContext=1&includePlayerStats=1` dry-runs one API-Football fixture import with match-event, news, standings, availability, lineup, weather, and finished-match player-performance evidence. The response separates player rows fetched, normalized, stored, and readback-verified. `/api/sports/decision/training/provider-sync?provider=api-basketball&league=12&season=2025&date=2025-01-15` dry-runs basketball games. `/api/sports/decision/training/provider-sync?provider=api-tennis&date=2025-06-03` dry-runs tennis events. `/api/sports/decision/training/provider-sync?provider=the-odds-api&sportKey=soccer_epl&date=2025-08-01T12:00:00Z` dry-runs one historical odds snapshot import.
- `POST /api/sports/decision/training/football-odds-attach?date=2025-08-15T12:00:00Z&sportKey=soccer_epl&fixtureProvider=api_football&regions=uk&dryRun=1` matches The Odds API historical EPL events to stored API-Football fixture IDs by normalized home/away names and kickoff time. It accepts only coherent three-way bookmaker markets, previews no-vig rows first, and requires the admin header even in dry-run mode because the request spends provider credits. A closing request must also pass the actual returned snapshot timestamp through `closingWindowMinutes` before any row can receive `is_closing=true`; future events in the same provider response are rejected. Set `dryRun=0` only after every event matches; the write stores bookmaker rows under the existing fixture IDs without rewriting fixtures.
- `POST /api/sports/decision/training/football-historical-odds-backfill?mode=both&season=2021&maxJobs=10&execute=0` builds a canonical-fixture opening/closing plan without calling The Odds API. The response reports retention skips, exact jobs, stored completion checkpoints, remaining jobs, and estimated credits. Completed and audited no-match snapshots are automatically excluded, so an expanded fixture corpus or interrupted request does not repeat provider spend. `execute=1&dryRun=1` spends provider credits but writes nothing; `execute=1&dryRun=0` spends credits and stores matched rows. Historical featured-market calls currently cost 10 credits per region and EPL coverage begins at `2020-06-06T10:05:00Z`, so the 2016-2019 fixture corpus remains useful for team-strength training but needs another licensed source for bookmaker history.
- `/api/sports/decision/training/backfill?provider=api-football&league=39&seasons=2025&from=2025-08-01&to=2026-05-31&intervalDays=14&includeEvents=1&includeStandings=1&includeAvailability=1&includeLineups=1&maxJobs=30` splits a football season into non-overlapping date windows, keeping per-job event and context fan-out inside explicit caps. Without `from`/`to`, the route retains its season-level job behavior. Basketball can use `provider=api-basketball&league=12&seasonFrom=2025&seasonTo=2025`; tennis can use `provider=api-tennis&from=2025-01-01&to=2025-01-07`. Add `dryRun=0` only after checking provider quotas, Supabase env, and dry-run counts.
- `/api/sports/decision/training/football-provider-feature-storage-receipt?limit=3000&batches=1000&run=1` derives one unified chronological corpus across up to six stored EPL seasons without truncating the 2,280-fixture target. Pre-match Elo, rolling form, 20-match attack/defense strength, offseason Elo regression, and rest use only finished fixtures strictly before each kickoff. Exact simultaneous kickoffs resolve before any result updates state, and every feature row carries `football-provider-chronology-v2` provenance with prior-season evidence. Supabase upserts are capped at 250 rows per idempotent chunk; the compact receipt reports chronology, warm-up, cross-season, attempted-chunk, and completed-chunk counts. Model promotion remains locked until the stored holdout beats the no-vig market gates. Add `season=2025&limit=500` only for a deliberately isolated single-season rebuild.
- `/api/sports/decision/training/football-provider-residual-trainer?dryRun=1&limit=1000` trains a deterministic L2-regularized softmax correction around the no-vig opening market. It standardizes chronology/model-disagreement features on `train` rows, chooses regularization on `validation` rows, reports zero-variance or time-ineligible features, and never queries `test` rows. A candidate can queue one separately governed untouched-test run only after beating the opening market on both validation Brier and log loss. The route is read-only and cannot persist weights, apply a model, publish picks, or stake.
- `/api/sports/decision/training/corpus-plan` is the first stop after creating the Supabase project. It shows whether the first dry-run can run, which keys are missing, and why historical odds are a second pass: fixture imports should land first, then opening, pre-kickoff, and closing-line odds jobs can be generated around stored kickoff times.
- `/api/sports/decision/training/multi-sport-corpus-plan` keeps the original three-sport training objective visible. Football, basketball, and tennis now expose implemented dry-run provider paths and backtest runners, but learned guardrails stay inactive until real rows, odds snapshots, and stored backtest runs exist in the `op_` training spine.

The next provider-ingestion target is 10 years of finished football fixtures with opening/closing odds, pre-match team features, standings snapshots, player availability, lineups, event snapshots, news signals, and weather where relevant. The multi-sport target extends that contract to basketball pace/efficiency/rest/availability/spread-moneyline-total history and tennis Elo/surface/form/head-to-head/fatigue/round/player-news history. The code intentionally reports missing corpus volume and required dry-run proof rather than pretending the MVP is trained before those imports exist.

`GET /api/sports/decision/training/football-provider-feature-materializer` now reads normalized fixtures directly from stored `api_football` raw batches, attaches any `op_odds_snapshots` rows already reconciled to those fixture IDs, and preserves raw payload ID, ingestion run, and hash provenance. Demo materialization requires `demo=1`. The storage receipt writes only the provider-enriched feature rows; the retest bridge reads deterministic test/live splits, rejects missing evidence, and never unlocks learned weights, public picks, or staking by itself.

## Value Edge

Decimal odds are converted to raw implied probability, then normalized within the market to remove bookmaker margin where possible. Before edge ranking, the model probability is also nudged toward the no-vig market probability with a bounded market-prior weight:

```txt
rawImpliedProbability = 1 / decimalOdds
bookmakerMargin = sum(rawImpliedProbabilitiesForMarket) - 1
noVigImpliedProbability = rawImpliedProbability / sum(rawImpliedProbabilitiesForMarket)
marketPriorWeight = f(dataQuality, bookmakerMargin, selectionCount)
modelProbability = normalize(modelProbability * (1 - marketPriorWeight) + noVigImpliedProbability * marketPriorWeight)
edge = modelProbability - noVigImpliedProbability
expectedValue = modelProbability * decimalOdds - 1
```

Example: decimal odds `2.20` imply `45.45%` before margin removal. If the no-vig market probability is `43.80%` and the model estimates `52%`, the value edge is `+8.20%` and expected value is `+14.40%` per unit.

OddsPadi only shows a best pick when edge and expected value are both positive and confidence is acceptable. Otherwise it displays `No clear value found`.

## Sports Data Architecture

Core files:

- `src/lib/sports/types.ts`
- `src/lib/sports/providers/mockProvider.ts`
- `src/lib/sports/prediction/footballModel.ts`
- `src/lib/sports/prediction/basketballModel.ts`
- `src/lib/sports/prediction/tennisModel.ts`
- `src/lib/sports/prediction/contextAdjustment.ts`
- `src/lib/sports/prediction/odds.ts`
- `src/lib/sports/prediction/confidence.ts`
- `src/lib/sports/prediction/explainer.ts`
- `src/lib/sports/prediction/history.ts`

The UI currently enables football, basketball, and tennis. Cricket, rugby, and handball are represented as coming soon.

## Adding Real Sports APIs

Keep provider-specific code behind the `SportsDataProvider` interface:

```ts
getFixtures(date, sport)
getMatch(matchId)
getLiveScores(date, sport)
getOdds(matchId)
getTeamForm(teamId)
```

The first historical adapters are API-Football for football fixture results and event archives, API-Basketball for basketball game history, API-Tennis for tennis event history, and The Odds API for bookmaker h2h odds snapshots. The live football adapter can also scan NewsAPI headlines/descriptions for bounded team-news risk signals. Future enrichment adapters can be added for deeper box scores, SportMonks, TheSportsDB, bookmaker odds providers, and live scores providers.

The status endpoint and `/predictions/decision-engine` distinguish provider key configuration, historical-sync-ready adapters, and live decision runtime coverage. The live football adapter can use API-Football for fixtures, scores, lineups, injuries, suspensions, and standings, The Odds API for current H2H prices, and OpenWeather for venue-city forecast context. Basketball can use API-Basketball fixtures when that product is configured, or The Odds API fixture identity plus moneyline, spread, and total markets when it is not. Without a usable provider response, the app falls back to `mockSportsDataProvider`.

Do not hardcode keys. Use:

- `SPORTS_API_KEY`
- `API_FOOTBALL_KEY` or `APISPORTS_KEY`
- `ODDS_API_KEY`
- `THE_ODDS_API_KEY`
- `ODDS_API_FOOTBALL_SPORT_KEY` for the current football odds sport key; defaults to `soccer_epl`
- `ODDS_API_BASKETBALL_SPORT_KEY` for the current basketball competition; defaults to `basketball_nba`
- `ODDS_API_CACHE_TTL_MS` for current market snapshot reuse; defaults to five minutes
- `ODDS_API_ALLOW_HISTORICAL_RUNTIME=true` only for intentional paid historical lookups; it is off by default because historical requests cost substantially more credits
- `SPORTS_PROVIDER_CACHE_TTL_MS` to deduplicate fixture/context reads across dashboard panels; defaults to one minute for today and five minutes for other dates
- `API_FOOTBALL_ALLOW_HISTORICAL_CONTEXT=true` only when an intentional historical job needs finished-match event context
- `API_FOOTBALL_LEAGUE_IDS` to limit runtime fixtures to product leagues; the EPL MVP uses API-Football league `39`
- `API_FOOTBALL_MAX_ENRICHED_FIXTURES` and `API_FOOTBALL_ENRICHMENT_CONCURRENCY` to cap context/form fan-out; defaults are `12` and `4`
- `LIVE_SCORES_API_KEY`
- `NEWS_API_KEY`
- `NEWS_API_LANGUAGE` and `NEWS_API_PAGE_SIZE` for the NewsAPI team-news scan; defaults to `en` and `5`
- `WEATHER_API_KEY` or `OPENWEATHER_API_KEY`

## Supabase

Decision-run persistence is implemented as a server-only layer in `src/lib/sports/prediction/decisionPersistence.ts`.
The workspace is linked to the OddsPadi Supabase project:

```txt
project_ref=wncwtzqipnoqwmqlznqn
url=https://wncwtzqipnoqwmqlznqn.supabase.co
```

Set these env vars before enabling writes:

- `SUPABASE_PROJECT_REF`
- `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ODDSPADI_ADMIN_TOKEN`

Applied migrations:

- `20260624000100_oddspadi_decision_engine_foundation.sql`
- `20260624083650_add_decision_agent_trace.sql`
- `20260624085042_add_decision_learning_loop.sql`
- `20260624092659_add_historical_training_backtest_spine.sql`
- `20260624110117_add_decision_context_snapshot.sql`

Pending local migration:

- `20260630065841_add_ai_thought_episodes.sql`

The first migration creates:

- `op_model_versions`
- `op_decision_runs`
- `op_provider_ingestion_runs`
- `op_raw_provider_payloads`

The second migration adds the richer decision-agent trace fields to `op_decision_runs`: `health`, `calibration`, `agent_stages`, `contradiction_checks`, `scenario_matrix`, and `abstention_rules`.

The context snapshot migration adds `op_decision_runs.context_adjustment` so stored decisions preserve the context signals, bounded probability shifts, risk flags, and remaining missing signals that shaped the recommendation.

The pending thought-episode migration creates `op_ai_thought_episodes`, a server-only private trace table for AI control/operator episode snapshots. It is intended for audit, replay, and later calibration review; it does not expose hidden chain-of-thought or grant publish/train permissions.

The third migration adds learning-loop tables:

- `op_prediction_outcomes`
- `op_calibration_runs`

The fourth migration adds historical-data and training tables:

- `op_leagues`
- `op_teams`
- `op_fixtures`
- `op_fixture_team_features`
- `op_standings_snapshots`
- `op_odds_snapshots`
- `op_player_availability_snapshots`
- `op_lineup_snapshots`
- `op_live_match_events`
- `op_news_signals`
- `op_weather_snapshots`
- `op_training_feature_snapshots`
- `op_backtest_runs`

All OddsPadi `op_` tables have RLS enabled and are server-only for now: `anon` and `authenticated` grants are revoked, while `service_role` can write through API routes. Supabase advisors still need `SUPABASE_DB_PASSWORD` to run from this CLI profile.

The server Supabase client is guarded to the OddsPadi project ref `wncwtzqipnoqwmqlznqn`. If `SUPABASE_PROJECT_REF` or the configured URL points elsewhere, readiness becomes blocked and server writes refuse to initialize.

## Adding More Sports

Add a sport-specific model under `src/lib/sports/prediction/`, add provider mapping for that sport, then enable the sport in `src/lib/sports/service.ts`. Keep common odds and confidence utilities shared.

## Responsible Use

OddsPadi does not provide sure outcomes, fixed matches, or betting operations. It provides statistical sports analysis for informational purposes only. Prediction history includes losses because trust requires transparency.
