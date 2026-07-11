# OddsPadi workspace instructions

- For every live Supabase operation in this repository, use the repo-local or global `supabase_oddspadi` MCP server.
- The only valid Supabase project ref for OddsPadi is `wncwtzqipnoqwmqlznqn`.
- Before any live SQL, migration, schema, logs, or generated-types operation, verify that `get_project_url` returns `https://wncwtzqipnoqwmqlznqn.supabase.co`.
- Never use the generic `supabase`, `supabase_afrotools`, `supabase_latmtools`, or `supabase_salarypadi` connector for OddsPadi.
- If the active task exposes only a generic or mismatched Supabase connector, do not mutate the database. Reload the task so the named connector is discovered first.
