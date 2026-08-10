-- Entity intelligence hubs: the competition/team read module filters
-- op_fixtures by league_external_id with kickoff windows and status. The
-- home/away team + kickoff indexes already exist (20260624092659); the league
-- filters had none, so a competition hub read was a table scan.

create index if not exists op_fixtures_league_kickoff_idx
  on public.op_fixtures (league_external_id, kickoff_at desc);

create index if not exists op_fixtures_league_status_idx
  on public.op_fixtures (league_external_id, status);
