-- Preserve the publication-time evidence floor used by the canonical decision.
-- Existing public picks remain valid and are reported as unscored until a
-- historical value can be proven; no value is inferred during migration.

alter table public.op_public_picks
  add column if not exists data_quality numeric(8, 6)
    check (data_quality is null or data_quality between 0 and 1);

comment on column public.op_public_picks.data_quality is
  'Canonical publication-time data quality. Null means the older public pick did not retain a verifiable score.';
