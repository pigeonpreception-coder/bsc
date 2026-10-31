-- Gap-scan finding (22nd pass): audit_log carried a tenant-only SELECT and a
-- tenant-only INSERT policy since 0001_init.sql.
--
-- SELECT: every entry for the tenant -- every user's actions, with
-- old_value/new_value that hold whole rows (profile changes with phone
-- numbers, scorecard edits, team changes, who exported data) -- was
-- readable by any member through the API. No page in the app shows the
-- audit log to anyone; the only reader is the company_admin data export,
-- which uses the service role.
--
-- INSERT: any member could write an entry for their tenant naming anyone
-- as the actor ("user_id": the CEO, "action": "approve_..."), forging the
-- trail that exists to attribute actions.
--
-- Fix: reads are company_admin (own tenant) or super_admin; inserts must
-- name the caller as the actor. Every audit call site in the app already
-- passes the acting user's own id, and the ones that don't run on the
-- service-role client, which bypasses RLS, so nothing legitimate changes.

drop policy if exists "audit_log_select" on public.audit_log;
create policy "audit_log_select" on public.audit_log for select
  using (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.current_role() = 'company_admin')
  );

drop policy if exists "audit_log_insert" on public.audit_log;
create policy "audit_log_insert" on public.audit_log for insert
  with check (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and user_id = auth.uid())
  );
