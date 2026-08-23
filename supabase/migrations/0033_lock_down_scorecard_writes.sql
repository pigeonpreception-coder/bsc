-- Gap-scan finding: scorecards/scorecard_rows have carried a `for all`
-- RLS policy checking only tenant_id since 0001_init.sql -- fine when the
-- only authority question was "does this row belong to your tenant," but
-- the BSC governance workflow (0028) and score-editing authority
-- (0025/0027) both layer real, dynamic authorization on top (owner vs.
-- resolved manager vs. locked, self-approval blocking, admin-unlock-only)
-- that lives entirely in TypeScript, not SQL. Because most of the Server
-- Actions enforcing it use the RLS-scoped client, that application-layer
-- check was the ONLY thing stopping an authenticated tenant member from
-- writing directly to these tables via their own session and bypassing it
-- entirely -- e.g. self-approving a BSC with a direct PostgREST call.
--
-- Writes to both tables now require the service-role key; every Server
-- Action that legitimately writes to them already re-verifies tenant
-- ownership and role/authority itself (this codebase's established pattern
-- for every other admin-client caller — team/actions.ts, admin/actions.ts,
-- user-invite.ts, etc.) and has been switched to use it. Reads stay
-- tenant-scoped and unchanged — this is a write-path fix only.

drop policy if exists "scorecards_all" on public.scorecards;
create policy "scorecards_select" on public.scorecards for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "scorecards_write" on public.scorecards for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "scorecard_rows_all" on public.scorecard_rows;
create policy "scorecard_rows_select" on public.scorecard_rows for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "scorecard_rows_write" on public.scorecard_rows for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- scorecard_versions is this workflow's audit/history trail -- give it the
-- same tamper-resistant shape audit_log already has (select + insert only,
-- no update/delete) rather than the permissive `for all` it was
-- accidentally given when it was added alongside 0028's other tables.
drop policy if exists "scorecard_versions_all" on public.scorecard_versions;
create policy "scorecard_versions_select" on public.scorecard_versions for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "scorecard_versions_insert" on public.scorecard_versions for insert
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());
