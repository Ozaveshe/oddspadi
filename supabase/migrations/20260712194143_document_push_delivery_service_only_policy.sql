-- The scheduler uses a server secret and bypasses RLS. Client roles retain no
-- grants; this explicit false policy documents that delivery receipts are not
-- a user-facing Data API surface and keeps the database advisor unambiguous.
create policy "push delivery receipts are service only"
  on public.op_push_notification_deliveries for select
  to authenticated
  using (false);
