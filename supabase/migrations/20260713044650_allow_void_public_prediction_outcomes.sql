alter table public.op_public_prediction_outcomes
  drop constraint op_public_prediction_outcomes_result_check;

alter table public.op_public_prediction_outcomes
  add constraint op_public_prediction_outcomes_result_check
  check (result in ('pending', 'won', 'lost', 'push', 'void'));
