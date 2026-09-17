-- Gap-scan finding (15th pass): notifications and daily_tasks hold data
-- that is genuinely personal to one user (a specific user's own alerts; a
-- specific user's own task list, completion ratings, and private
-- completion notes) -- but their RLS policies, unchanged since 0018/0006,
-- only ever checked the tenant boundary. That's the same shape 0033 already
-- fixed for the BSC governance workflow, except here the missing dimension
-- is "which user", not "which role" or "which workflow state".
--
-- Every read and write in the app already scopes correctly in application
-- code: notification-actions.ts and dashboard/layout.tsx filter notifications
-- to `user_id = <caller>`; dashboard/page.tsx and task-actions.ts's
-- updateTaskStatus filter daily_tasks to `user_id = <caller>`; tasks/page.tsx
-- filters to `assigned_by = <caller>` for the "tasks you've assigned" view.
-- But NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY are, by design,
-- exposed to every browser -- so any authenticated tenant member could call
-- the Supabase client directly with their own session and read, mark-read,
-- or delete every other tenant member's notifications, or read/edit any
-- other tenant member's daily task list and completion notes, entirely
-- bypassing the Server Actions that were the only thing enforcing the
-- per-user boundary.
--
-- Not touched here (same explicitly-scoped-out reasoning as 0033/the
-- current-state assessment's §40): the remaining tables still on a
-- tenant-only `for all` policy where the data is genuinely tenant-shared
-- (scorecard_columns, org_positions, plan_documents, etc.), and
-- performance_alerts, which shares this exact shape (app code checks
-- position_id, RLS doesn't) but is position- not user-scoped and deserves
-- its own look rather than being guessed at here.

-- ================= notifications =================
-- Insert stays tenant-wide on purpose: position assignment, task assignment,
-- and plan approval all legitimately create a notification for someone else
-- in the same tenant, from that actor's own non-admin session.

drop policy if exists "notifications_all" on public.notifications;

create policy "notifications_select" on public.notifications for select
  using (public.is_super_admin() or user_id = auth.uid());

create policy "notifications_insert" on public.notifications for insert
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy "notifications_update" on public.notifications for update
  using (public.is_super_admin() or user_id = auth.uid())
  with check (public.is_super_admin() or user_id = auth.uid());

create policy "notifications_delete" on public.notifications for delete
  using (public.is_super_admin());

-- ================= daily_tasks =================
-- Select/update admit the owner (their own task list/status) and, for
-- select only, the assigner (assignTask's "tasks you've assigned" view).
-- Insert admits self-generation (generateDailyTasks, called with the
-- caller's own session and user id, assigned_by left null) and assignment
-- by a company_admin/manager (assignTask, which already re-validates the
-- assignee's tenant and role in application code before this runs). Delete
-- isn't exposed to any role in the app today, so it's left super_admin-only
-- rather than guessed at.

drop policy if exists "daily_tasks_all" on public.daily_tasks;

create policy "daily_tasks_select" on public.daily_tasks for select
  using (public.is_super_admin() or user_id = auth.uid() or assigned_by = auth.uid());

create policy "daily_tasks_insert" on public.daily_tasks for insert
  with check (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and user_id = auth.uid())
    or (
      tenant_id = public.current_tenant_id()
      and assigned_by = auth.uid()
      and public.current_role() in ('company_admin', 'manager')
    )
  );

create policy "daily_tasks_update" on public.daily_tasks for update
  using (public.is_super_admin() or user_id = auth.uid())
  with check (public.is_super_admin() or user_id = auth.uid());

create policy "daily_tasks_delete" on public.daily_tasks for delete
  using (public.is_super_admin());
