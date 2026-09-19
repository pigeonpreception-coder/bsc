-- Gap-scan finding (16th pass), two parts.
--
-- 1. CRITICAL: `users_update` (0001_init.sql) lets any user update their own
-- row (`id = auth.uid()`) with no `with check` and no column restriction, so
-- any signed-in user could set their own `role` (up to 'super_admin'),
-- `tenant_id` (into another tenant), or `status` directly through the API.
-- RLS cannot restrict columns, so a BEFORE UPDATE trigger guards them.
-- Callers with no auth.uid() (the service-role key, used by every legitimate
-- writer of these columns: team/actions.ts, admin/actions.ts, the
-- provision_tenant_user RPC) and super_admins pass through untouched. The
-- self-service fields (full_name, phone, notification preferences) stay
-- editable by their owner. `users_insert` had the same shape of problem (a
-- company_admin could insert a row with any role) and every legitimate insert
-- already goes through the service-role RPC, so it becomes super_admin-only.
--
-- 2. Tables that hold derived or governance-critical data but were writable
-- by any tenant member (tenant-only `for all`), exactly the 0033 pattern:
-- org_positions/position_scorecards (org_positions.reports_to_id resolves the
-- BSC approval chain, so rewriting it lets a member reroute their own
-- approvals), cascade_weights (changes everyone's composite score), and the
-- system-computed performance_scores, performance_history,
-- performance_alerts, weekly_advisories, task_generation_log. Reads stay
-- tenant-scoped; writes require the service-role key. Every writer was
-- switched to createAdminClient() in the preceding commit.

-- ================= users =================

create or replace function public.guard_users_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or public.is_super_admin() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.tenant_id is distinct from old.tenant_id
     or new.status is distinct from old.status then
    raise exception 'role, tenant_id and status can only be changed by a platform administrator'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_users_privileged_columns on public.users;
create trigger guard_users_privileged_columns
  before update on public.users
  for each row execute function public.guard_users_privileged_columns();

drop policy if exists "users_insert" on public.users;
create policy "users_insert" on public.users for insert
  with check (public.is_super_admin());

-- ================= service-role-write-only tables =================

drop policy if exists "org_positions_all" on public.org_positions;
create policy "org_positions_select" on public.org_positions for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "org_positions_write" on public.org_positions for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "position_scorecards_all" on public.position_scorecards;
create policy "position_scorecards_select" on public.position_scorecards for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "position_scorecards_write" on public.position_scorecards for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "cascade_weights_all" on public.cascade_weights;
create policy "cascade_weights_select" on public.cascade_weights for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "cascade_weights_write" on public.cascade_weights for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "performance_scores_all" on public.performance_scores;
create policy "performance_scores_select" on public.performance_scores for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "performance_scores_write" on public.performance_scores for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "performance_history_all" on public.performance_history;
create policy "performance_history_select" on public.performance_history for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "performance_history_write" on public.performance_history for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "performance_alerts_all" on public.performance_alerts;
create policy "performance_alerts_select" on public.performance_alerts for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "performance_alerts_write" on public.performance_alerts for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "weekly_advisories_all" on public.weekly_advisories;
create policy "weekly_advisories_select" on public.weekly_advisories for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "weekly_advisories_write" on public.weekly_advisories for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "task_generation_log_all" on public.task_generation_log;
create policy "task_generation_log_select" on public.task_generation_log for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "task_generation_log_write" on public.task_generation_log for all
  using (public.is_super_admin()) with check (public.is_super_admin());
