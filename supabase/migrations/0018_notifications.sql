-- ============================================================
-- IN-APP NOTIFICATIONS
-- ============================================================
-- General-purpose, user-scoped notification channel. Distinct from
-- performance_alerts (KPI/task-driven, position-scoped, dashboard-page-only):
-- this covers any event a specific user should be told about wherever they
-- are in the app (position assignment, weekly advisory ready, etc.), shown
-- via a header bell rather than a single page's panel.

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  message text NOT NULL,
  link text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_tenant_idx ON public.notifications(tenant_id);
CREATE INDEX notifications_user_unread_idx ON public.notifications(user_id, is_read);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Same shape as every other tenant-scoped table here (e.g. daily_tasks):
-- RLS enforces the tenant boundary, app code filters to the specific user.
CREATE POLICY "notifications_all" ON public.notifications FOR ALL
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.current_tenant_id());
