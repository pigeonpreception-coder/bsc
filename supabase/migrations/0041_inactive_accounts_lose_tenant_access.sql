-- Gap-scan finding (21st pass): suspending or deactivating a user (§30),
-- or suspending/expiring a tenant, only revoked access inside the Next.js
-- app: getCurrentUser() returns null for them. Nothing touched their
-- Supabase session. Their access and refresh tokens kept working, and
-- current_tenant_id() -- which every tenant-scoped RLS policy and storage
-- policy is built on -- never looked at account or license status. So a
-- terminated employee, or every user of a suspended tenant, could keep
-- calling Supabase's REST and Storage APIs directly with their own session
-- and read all of the tenant's scorecards, users, audit trail and stored
-- documents indefinitely (refresh tokens don't expire on their own).
--
-- Fix: current_tenant_id() now returns NULL unless the caller's account is
-- 'active' AND their tenant's license is 'active'. A NULL tenant matches
-- no row in any `tenant_id = current_tenant_id()` policy, so reads and
-- writes alike are denied immediately, with no dependency on token expiry.
-- super_admin (tenant_id NULL, no tenant row) is unaffected: it never
-- relied on this function for its own access. The app-side checks
-- (getCurrentUser, login) were updated in the same commit to treat an
-- unreadable tenant row as blocked, since a suspended tenant's row is now
-- hidden from its own users rather than visible with status 'suspended'.

create or replace function public.current_tenant_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select u.tenant_id
  from public.users u
  join public.tenants t on t.id = u.tenant_id
  where u.id = auth.uid()
    and u.status = 'active'
    and t.license_status = 'active';
$$;
