-- Asian quarter lines, which the settlement vocabulary could not express.
--
-- A quarter line splits the stake between the two neighbouring half lines, so
-- it can return half a win or half a loss. The existing enum has won, lost,
-- push, void and cancelled — none of which is that. Every quarter-line claim
-- therefore had to sit at needs_review forever, in a market this book already
-- publishes.
--
-- The alternative to adding these was collapsing a quarter line onto its
-- nearest half, which misprices every one of them by half a stake and does so
-- invisibly.
--
-- This changes accounting, and the change has to be applied consistently
-- wherever the enum is aggregated:
--
--   accuracy denominator  a half win is a played pick and counts; a push
--                         still does not
--   ROI                   half_won pays (odds - 1) / 2, half_lost costs 0.5
--
-- Consumers: canonicalReads.ts, ledgerMetrics.ts, advancedMetrics.ts and the
-- public results surfaces. return_multiple is stored rather than re-derived at
-- each call site, because a half win is precisely the case an ad-hoc ROI
-- calculation gets wrong.

alter table public.op_publications drop constraint if exists op_publications_settlement_status_check;
alter table public.op_publications add constraint op_publications_settlement_status_check
  check (settlement_status in (
    'unsettled', 'won', 'half_won', 'push', 'half_lost', 'lost', 'void', 'cancelled', 'pending_verification'
  ));

alter table public.op_publication_settlements drop constraint if exists op_publication_settlements_status_check;
alter table public.op_publication_settlements add constraint op_publication_settlements_status_check
  check (status in (
    'won', 'half_won', 'push', 'half_lost', 'lost', 'void', 'cancelled', 'pending_verification'
  ));

alter table public.op_publication_settlements
  add column if not exists return_multiple numeric,
  add column if not exists market_key text,
  add column if not exists rule_version text,
  add column if not exists settlement_basis text,
  add column if not exists result_id uuid references public.op_fixture_results (id) on delete set null;

comment on column public.op_publication_settlements.return_multiple is
  'Profit per unit staked. won: odds-1. half_won: (odds-1)/2. push/void: 0. half_lost: -0.5. lost: -1. Stored so ROI cannot be re-derived incorrectly per consumer.';
comment on column public.op_publication_settlements.market_key is
  'Canonical market key the verdict was produced under, e.g. football.asian_handicap.regulation.';
comment on column public.op_publication_settlements.rule_version is
  'Version of the settlement rule that produced this verdict. A re-settle under a new rule version supersedes rather than overwrites.';
comment on column public.op_publication_settlements.settlement_basis is
  'What the score was read at: regulation, full_game_including_ot, sets, match_award and so on. Declared on the verdict so a reader never has to infer it.';
comment on column public.op_publication_settlements.result_id is
  'The canonical result revision this verdict was produced from. A corrected result produces a new settlement pointing at the new revision.';

-- A verdict produced by the versioned engine carries its provenance. Rows
-- predating the engine legitimately have none, so the constraint is written to
-- allow all-or-nothing rather than demanding it of history.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'op_publication_settlements_provenance_coherent') then
    alter table public.op_publication_settlements
      add constraint op_publication_settlements_provenance_coherent
      check (
        (market_key is null and rule_version is null and settlement_basis is null)
        or (market_key is not null and rule_version is not null and settlement_basis is not null)
      );
  end if;
end
$$;
