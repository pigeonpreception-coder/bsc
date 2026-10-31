-- Gap-scan finding (20th pass): MFA for super_admin (§22) is enforced only
-- in middleware.ts. That runs on requests to the Next.js app, not on calls
-- straight to Supabase's REST/Storage APIs with the public anon key and a
-- session JWT. A super_admin who has TOTP enrolled but only entered their
-- password holds an `aal1` session: middleware would bounce them to the
-- challenge page, but a direct API call with that same JWT sails through
-- every `is_super_admin()` policy in the schema -- cross-tenant read and
-- write on essentially every table, with no audit_log entry. A phished or
-- leaked super_admin password was therefore enough, TOTP or not.
--
-- Fix: is_super_admin() itself now also requires the JWT's `aal` claim to be
-- 'aal2' (Supabase's documented way to enforce MFA in RLS). This is a no-op
-- for any compliant session: super_admin must already enroll and clear the
-- challenge to get past middleware to any admin page, and the service-role
-- key (every server action) has no auth.uid() and bypasses RLS entirely.
-- It only closes the direct-API path. company_admin is deliberately not
-- changed here: their reach through RLS is their own tenant, which any
-- member of it can already read, and every company_admin-only write was
-- moved to the service role in 0033-0039.

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_role() = 'super_admin', false)
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
