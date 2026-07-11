-- OddsPadi historical data and model-training spine.
-- Server-only by default: ingestion, historical features, odds archives, and
-- backtest outputs must flow through Next.js API routes using service_role.

create table if not exists public.op_leagues (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  provider text not null default 'manual',
  external_id text not null,
  name text not null,
  country text,
  strength numeric(8, 6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, sport, external_id)
);

create table if not exists public.op_teams (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  provider text not null default 'manual',
  external_id text not null,
  name text not null,
  country text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, sport, external_id)
);

create table if not exists public.op_fixtures (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  provider text not null default 'manual',
  external_id text not null,
  league_external_id text,
  season text,
  round text,
  kickoff_at timestamptz not null,
  status text not null check (status in ('scheduled', 'live', 'finished', 'postponed', 'cancelled')),
  home_team_external_id text not null,
  away_team_external_id text not null,
  home_score smallint check (home_score is null or home_score >= 0),
  away_score smallint check (away_score is null or away_score >= 0),
  home_xg numeric(8, 4) check (home_xg is null or home_xg >= 0),
  away_xg numeric(8, 4) check (away_xg is null or away_xg >= 0),
  neutral_venue boolean not null default false,
  venue text,
  country text,
  data_quality numeric(5, 4) not null default 0 check (data_quality >= 0 and data_quality <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, sport, external_id)
);

create table if not exists public.op_fixture_team_features (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.op_fixtures(id) on delete cascade,
  side text not null check (side in ('home', 'away')),
  team_external_id text not null,
  elo_rating numeric(9, 3),
  attack_strength numeric(8, 4),
  defense_strength numeric(8, 4),
  recent_form_points numeric(8, 4),
  recent_goals_for numeric(8, 4),
  recent_goals_against numeric(8, 4),
  rest_days numeric(8, 4),
  injuries_count integer not null default 0 check (injuries_count >= 0),
  suspensions_count integer not null default 0 check (suspensions_count >= 0),
  lineup_confirmed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fixture_id, side)
);

create table if not exists public.op_standings_snapshots (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  provider text not null default 'manual',
  league_external_id text not null,
  season text,
  team_external_id text not null,
  snapshot_at timestamptz not null,
  position integer check (position is null or position > 0),
  played integer not null default 0 check (played >= 0),
  points integer not null default 0,
  wins integer not null default 0 check (wins >= 0),
  draws integer not null default 0 check (draws >= 0),
  losses integer not null default 0 check (losses >= 0),
  goals_for integer not null default 0,
  goals_against integer not null default 0,
  form jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.op_odds_snapshots (
  id uuid primary key default gen_random_uuid(),
  fixture_external_id text not null,
  sport text not null,
  provider text not null,
  bookmaker text not null,
  market text not null,
  selection text not null,
  decimal_odds numeric(10, 4) not null check (decimal_odds > 1),
  implied_probability numeric(8, 6) check (implied_probability is null or (implied_probability >= 0 and implied_probability <= 1)),
  margin_adjusted_probability numeric(8, 6) check (
    margin_adjusted_probability is null or (margin_adjusted_probability >= 0 and margin_adjusted_probability <= 1)
  ),
  is_closing boolean not null default false,
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.op_player_availability_snapshots (
  id uuid primary key default gen_random_uuid(),
  fixture_external_id text not null,
  sport text not null,
  provider text not null,
  team_external_id text not null,
  player_external_id text,
  player_name text not null,
  status text not null check (status in ('available', 'doubtful', 'injured', 'suspended', 'unknown')),
  impact_score numeric(7, 4) not null default 0,
  reason text,
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.op_lineup_snapshots (
  id uuid primary key default gen_random_uuid(),
  fixture_external_id text not null,
  sport text not null,
  provider text not null,
  team_external_id text not null,
  lineup_status text not null check (lineup_status in ('predicted', 'confirmed', 'unavailable')),
  formation text,
  players jsonb not null default '[]'::jsonb,
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.op_live_match_events (
  id uuid primary key default gen_random_uuid(),
  fixture_external_id text not null,
  sport text not null,
  provider text not null,
  event_external_id text,
  minute smallint check (minute is null or (minute >= 0 and minute <= 130)),
  stoppage_minute smallint check (stoppage_minute is null or stoppage_minute >= 0),
  team_external_id text,
  player_external_id text,
  event_type text not null,
  event_value numeric(10, 4),
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, fixture_external_id, event_external_id)
);

create table if not exists public.op_news_signals (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  fixture_external_id text,
  provider text not null,
  source_name text,
  source_url text,
  published_at timestamptz,
  signal_type text not null check (signal_type in ('injury', 'lineup', 'weather', 'transfer', 'sentiment', 'tactical', 'other')),
  sentiment numeric(7, 4),
  confidence numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  impact_score numeric(7, 4) not null default 0,
  summary text not null default '',
  entities jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.op_weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  fixture_external_id text not null,
  sport text not null,
  provider text not null,
  observed_for timestamptz,
  temperature_c numeric(6, 2),
  precipitation_mm numeric(8, 3),
  wind_kph numeric(8, 3),
  humidity numeric(6, 3),
  condition text,
  impact_score numeric(7, 4) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.op_training_feature_snapshots (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  fixture_external_id text not null,
  model_key text not null,
  generated_at timestamptz not null default now(),
  label text,
  features jsonb not null default '{}'::jsonb,
  targets jsonb not null default '{}'::jsonb,
  split text not null default 'train' check (split in ('train', 'validation', 'test', 'live')),
  source text not null default 'provider',
  feature_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.op_backtest_runs (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  model_key text not null,
  engine_version text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  data_source text not null,
  train_window_start timestamptz,
  train_window_end timestamptz,
  test_window_start timestamptz,
  test_window_end timestamptz,
  sample_size integer not null default 0 check (sample_size >= 0),
  train_size integer not null default 0 check (train_size >= 0),
  test_size integer not null default 0 check (test_size >= 0),
  pick_count integer not null default 0 check (pick_count >= 0),
  brier_score numeric(10, 6),
  log_loss numeric(10, 6),
  roi_units numeric(14, 6),
  yield numeric(10, 6),
  average_edge numeric(10, 6),
  closing_line_value numeric(10, 6),
  market_breakdown jsonb not null default '{}'::jsonb,
  confidence_breakdown jsonb not null default '{}'::jsonb,
  learned_weights jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists op_leagues_sport_name_idx
  on public.op_leagues (sport, name);

create index if not exists op_teams_sport_name_idx
  on public.op_teams (sport, name);

create index if not exists op_fixtures_sport_kickoff_idx
  on public.op_fixtures (sport, kickoff_at desc);

create index if not exists op_fixtures_status_kickoff_idx
  on public.op_fixtures (status, kickoff_at desc);

create index if not exists op_fixtures_home_kickoff_idx
  on public.op_fixtures (home_team_external_id, kickoff_at desc);

create index if not exists op_fixtures_away_kickoff_idx
  on public.op_fixtures (away_team_external_id, kickoff_at desc);

create index if not exists op_fixture_team_features_team_idx
  on public.op_fixture_team_features (team_external_id, created_at desc);

create index if not exists op_standings_snapshots_team_idx
  on public.op_standings_snapshots (sport, team_external_id, snapshot_at desc);

create index if not exists op_odds_snapshots_fixture_market_idx
  on public.op_odds_snapshots (fixture_external_id, market, observed_at desc);

create index if not exists op_odds_snapshots_closing_idx
  on public.op_odds_snapshots (sport, market, is_closing, observed_at desc);

create index if not exists op_player_availability_fixture_idx
  on public.op_player_availability_snapshots (fixture_external_id, team_external_id, observed_at desc);

create index if not exists op_lineup_snapshots_fixture_idx
  on public.op_lineup_snapshots (fixture_external_id, team_external_id, observed_at desc);

create index if not exists op_live_match_events_fixture_idx
  on public.op_live_match_events (fixture_external_id, minute, observed_at desc);

create index if not exists op_news_signals_fixture_idx
  on public.op_news_signals (sport, fixture_external_id, created_at desc);

create index if not exists op_weather_snapshots_fixture_idx
  on public.op_weather_snapshots (fixture_external_id, created_at desc);

create index if not exists op_training_feature_snapshots_fixture_idx
  on public.op_training_feature_snapshots (sport, fixture_external_id, generated_at desc);

create index if not exists op_backtest_runs_sport_created_idx
  on public.op_backtest_runs (sport, created_at desc);

revoke all on
  public.op_leagues,
  public.op_teams,
  public.op_fixtures,
  public.op_fixture_team_features,
  public.op_standings_snapshots,
  public.op_odds_snapshots,
  public.op_player_availability_snapshots,
  public.op_lineup_snapshots,
  public.op_live_match_events,
  public.op_news_signals,
  public.op_weather_snapshots,
  public.op_training_feature_snapshots,
  public.op_backtest_runs
from anon, authenticated;

grant select, insert, update, delete on
  public.op_leagues,
  public.op_teams,
  public.op_fixtures,
  public.op_fixture_team_features,
  public.op_standings_snapshots,
  public.op_odds_snapshots,
  public.op_player_availability_snapshots,
  public.op_lineup_snapshots,
  public.op_live_match_events,
  public.op_news_signals,
  public.op_weather_snapshots,
  public.op_training_feature_snapshots,
  public.op_backtest_runs
to service_role;

alter table public.op_leagues enable row level security;
alter table public.op_teams enable row level security;
alter table public.op_fixtures enable row level security;
alter table public.op_fixture_team_features enable row level security;
alter table public.op_standings_snapshots enable row level security;
alter table public.op_odds_snapshots enable row level security;
alter table public.op_player_availability_snapshots enable row level security;
alter table public.op_lineup_snapshots enable row level security;
alter table public.op_live_match_events enable row level security;
alter table public.op_news_signals enable row level security;
alter table public.op_weather_snapshots enable row level security;
alter table public.op_training_feature_snapshots enable row level security;
alter table public.op_backtest_runs enable row level security;

comment on table public.op_fixtures is
  'Normalized fixtures and final scores for provider imports, historical model training, backtests, and live prediction context.';

comment on table public.op_odds_snapshots is
  'Bookmaker odds observations used to compute implied probability, bookmaker margin, value edge, and closing-line value.';

comment on table public.op_backtest_runs is
  'Stored OddsPadi training/backtest outputs. Used to calibrate model thresholds and prove whether value picks beat historical prices.';
