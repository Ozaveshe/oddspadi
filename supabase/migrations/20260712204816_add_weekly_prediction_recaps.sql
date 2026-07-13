create table public.op_weekly_prediction_recaps (
  week_start date primary key,
  week_end date not null,
  graded_count integer not null check (graded_count >= 0),
  wins integer not null check (wins >= 0),
  losses integer not null check (losses >= 0),
  pushes integer not null default 0 check (pushes >= 0),
  voids integer not null default 0 check (voids >= 0),
  accuracy numeric not null check (accuracy between 0 and 1),
  roi numeric not null,
  best_call text,
  best_call_odds numeric,
  generated_at timestamptz not null default now()
);

comment on table public.op_weekly_prediction_recaps is
  'Complete weekly OddsPadi prediction recaps. Wins and losses are always stored together; server workers are the only writers.';

alter table public.op_weekly_prediction_recaps enable row level security;
revoke all on table public.op_weekly_prediction_recaps from public, anon, authenticated;
grant select on table public.op_weekly_prediction_recaps to anon, authenticated;

create policy "Weekly prediction recaps are readable"
  on public.op_weekly_prediction_recaps for select to anon, authenticated using (true);
