-- Let tooling see which migrations this database thinks it has run.
--
-- Eleven migration files sat in the repo unrecorded in
-- `supabase_migrations.schema_migrations`, because they were applied through
-- the MCP path, which assigns its own version at apply time
-- (`20260803114025`) rather than using the filename (`20260803120000`). The
-- schema was correct, the ledger was correct about what *ran*, and the two
-- simply did not refer to the same things. A `supabase db push` against a
-- fresh environment would have re-run all eleven.
--
-- Nothing could detect that: `scripts/check-migrations.mjs` lints filenames
-- and never connects, and the ledger schema is not exposed through PostgREST,
-- so no script could read it. This is the missing half.
--
-- Read-only, returns nothing but version and name, and is revoked from anon
-- and authenticated — the migration history is operator information, not a
-- public listing of every schema change and its date.
create or replace function public.op_applied_migration_versions()
returns table (version text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.version, m.name
  from supabase_migrations.schema_migrations m
  order by m.version
$$;

comment on function public.op_applied_migration_versions is
  'Applied migration versions, for drift checks against supabase/migrations. Operator tooling only; revoked from anon and authenticated.';

revoke all on function public.op_applied_migration_versions() from public, anon, authenticated;
