-- Outcomes must carry their own model identity.
--
-- Calibration groups settled outcomes into (model_key, engine_version) cohorts
-- and needs 30 in one cohort before a profile can be promoted. An outcome with
-- no identity is dropped from every cohort, and the only identity available was
-- a join through `decision_run_id`.
--
-- Measured in production on 2026-08-03:
--
--   football   550 settled outcomes,   38 carry decision_run_id  (largest cohort 37)
--   tennis   1,000 settled outcomes,    0 carry decision_run_id  (largest cohort  0)
--
-- So 93% of football evidence and 100% of tennis evidence was discarded, no
-- calibration profile could ever be promoted, and "empirical 95% value floor is
-- unavailable" became the single largest publication blocker — 3,830 of the
-- 7,687 decisions that already cleared the numeric gate.
--
-- The columns are nullable on purpose. An outcome whose model cannot be
-- established must stay unattributed and keep being excluded; inventing an
-- attribution to enlarge the sample would corrupt the calibration it feeds.

alter table public.op_prediction_outcomes
  add column if not exists model_key text,
  add column if not exists engine_version text;

comment on column public.op_prediction_outcomes.model_key is
  'Model that produced the prediction, e.g. tennis-surface-elo-v5. Null means the attribution is unknown and the row is excluded from calibration cohorts.';
comment on column public.op_prediction_outcomes.engine_version is
  'Decision engine version that produced the prediction. Paired with model_key to form the calibration cohort key.';

-- Cohort assembly reads (sport, model_key, engine_version) for settled rows.
create index if not exists op_prediction_outcomes_cohort_idx
  on public.op_prediction_outcomes (sport, model_key, engine_version)
  where result <> 'pending';

-- Calibration also scans settled rows by recency per sport. Without this the
-- ordered read is a sequential scan and trips the statement timeout as the
-- table grows.
create index if not exists op_prediction_outcomes_sport_settled_idx
  on public.op_prediction_outcomes (sport, settled_at desc)
  where result <> 'pending';
