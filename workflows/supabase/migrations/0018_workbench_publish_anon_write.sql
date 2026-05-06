-- Allow the workbench (which connects to the ClinOps project via the
-- publishable anon key — see src/integrations/supabase/clinopsClient.ts) to
-- read and update publish_status and shift_recommendations. Without this,
-- clicking the "Posted to Homebase" / EHR checkboxes silently fails RLS and
-- the box never visually checks. Aligns these two tables with the rest of
-- the ClinOps schema, which already uses {anon, authenticated} for ui access.

drop policy if exists "publish_status read authenticated" on public.publish_status;
drop policy if exists "publish_status write authenticated" on public.publish_status;

create policy "publish_status ui read"
  on public.publish_status
  for select
  to anon, authenticated
  using (true);

create policy "publish_status ui write"
  on public.publish_status
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "ui update publish_status" on public.shift_recommendations;

create policy "shift_recommendations ui update"
  on public.shift_recommendations
  for update
  to anon, authenticated
  using (true)
  with check (true);
