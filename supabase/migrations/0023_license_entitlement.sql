-- ============================================================
-- License Entitlement Engine (Phase 1) — seat-limit enforcement.
-- Extends the existing license_tier/license_status model on tenants
-- rather than introducing a parallel licensing concept. Payment/checkout
-- is a separate, later phase; this only adds the entitlement fields and
-- the atomic seat-reservation mechanism every provisioning path needs.
-- ============================================================

alter table public.tenants add column if not exists max_users int;
alter table public.tenants add column if not exists is_unlimited_users boolean not null default false;

-- Existing tenants (created before this column existed) get the 'basic'
-- tier's default seat count rather than being left unenforced by accident.
update public.tenants set max_users = 10 where max_users is null and not is_unlimited_users;

alter table public.tenants add constraint tenants_max_users_check
  check (is_unlimited_users or max_users is not null);

-- ============================================================
-- Atomic seat reservation. A naive "check count, then insert" from
-- application code is two round trips and races under concurrency —
-- Supabase's JS client can't run a multi-statement atomic transaction, so
-- the check-and-insert has to happen together, server-side, in one
-- statement. `for update` locks this tenant's row for the duration of the
-- transaction: a second concurrent call for the SAME tenant blocks until
-- the first commits, then re-reads the now-current count. Different
-- tenants never block each other (the lock is per-row, not table-wide).
-- ============================================================
create or replace function public.provision_tenant_user(
  p_user_id uuid,
  p_tenant_id uuid,
  p_email text,
  p_full_name text,
  p_role text,
  p_department text default null
)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_users int;
  v_unlimited boolean;
  v_current_count int;
  v_row public.users;
begin
  select max_users, is_unlimited_users into v_max_users, v_unlimited
  from public.tenants
  where id = p_tenant_id
  for update;

  if not found then
    raise exception 'TENANT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not v_unlimited then
    select count(*) into v_current_count from public.users where tenant_id = p_tenant_id;
    if v_current_count >= coalesce(v_max_users, 0) then
      raise exception 'SEAT_LIMIT_REACHED:%', v_max_users using errcode = 'P0001';
    end if;
  end if;

  insert into public.users (id, tenant_id, email, full_name, role, department)
  values (p_user_id, p_tenant_id, p_email, p_full_name, p_role, p_department)
  returning * into v_row;

  return v_row;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which
-- would let any authenticated (or anon) client call this directly via
-- .rpc() — bypassing every role gate the application layer enforces
-- (addTeamMember's manager/staff/viewer restriction, createCompanyAdmin's
-- super_admin check) and inserting a users row for an arbitrary id they
-- don't own. Only the service-role (admin) client may call this.
revoke all on function public.provision_tenant_user(uuid, uuid, text, text, text, text) from public;
revoke all on function public.provision_tenant_user(uuid, uuid, text, text, text, text) from anon;
revoke all on function public.provision_tenant_user(uuid, uuid, text, text, text, text) from authenticated;
grant execute on function public.provision_tenant_user(uuid, uuid, text, text, text, text) to service_role;
