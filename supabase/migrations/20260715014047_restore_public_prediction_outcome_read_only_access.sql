-- Keep the sanitized legacy outcome projection available for independent
-- record-count and freshness verification. Product accuracy and ROI continue
-- to read only op_public_picks; this projection remains explicitly paper-only.

alter table public.op_public_prediction_outcomes enable row level security;

revoke all on table public.op_public_prediction_outcomes
  from public, anon, authenticated;
grant select on table public.op_public_prediction_outcomes
  to anon, authenticated;

drop policy if exists "Public outcomes are readable"
  on public.op_public_prediction_outcomes;
create policy "Public outcomes are readable"
  on public.op_public_prediction_outcomes
  for select
  to anon, authenticated
  using (true);
