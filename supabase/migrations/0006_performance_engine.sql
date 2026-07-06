-- ============================================================
-- PERFORMANCE CASCADE ENGINE, DAILY TASKS & ALERTS
-- ============================================================

-- Configurable cascade weights per tenant
CREATE TABLE public.cascade_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  -- Individual staff: composite = own score (no weights needed)
  section_own_weight numeric NOT NULL DEFAULT 0.40,
  section_subordinate_weight numeric NOT NULL DEFAULT 0.60,
  department_own_weight numeric NOT NULL DEFAULT 0.30,
  department_subordinate_weight numeric NOT NULL DEFAULT 0.70,
  executive_own_weight numeric NOT NULL DEFAULT 0.25,
  executive_subordinate_weight numeric NOT NULL DEFAULT 0.75,
  corporate_own_weight numeric NOT NULL DEFAULT 0.20,
  corporate_subordinate_weight numeric NOT NULL DEFAULT 0.80,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Performance scores per scorecard/position
CREATE TABLE public.performance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scorecard_id uuid REFERENCES public.scorecards(id) ON DELETE CASCADE,
  position_id uuid REFERENCES public.org_positions(id) ON DELETE CASCADE,
  position_type text NOT NULL,
  own_performance_score numeric(5,2) DEFAULT 0,
  composite_performance_score numeric(5,2) DEFAULT 0,
  financial_score numeric(5,2) DEFAULT 0,
  customer_score numeric(5,2) DEFAULT 0,
  internal_process_score numeric(5,2) DEFAULT 0,
  learning_growth_score numeric(5,2) DEFAULT 0,
  kpis_on_track integer DEFAULT 0,
  kpis_at_risk integer DEFAULT 0,
  kpis_off_track integer DEFAULT 0,
  total_kpis integer DEFAULT 0,
  last_calculated timestamptz DEFAULT now(),
  snapshot_date date DEFAULT current_date
);

CREATE INDEX performance_scores_tenant_idx ON public.performance_scores(tenant_id);
CREATE INDEX performance_scores_scorecard_idx ON public.performance_scores(scorecard_id);
CREATE INDEX performance_scores_position_idx ON public.performance_scores(position_id);

-- Historical performance for trend charts
CREATE TABLE public.performance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scorecard_id uuid REFERENCES public.scorecards(id) ON DELETE CASCADE,
  position_id uuid REFERENCES public.org_positions(id) ON DELETE CASCADE,
  composite_performance_score numeric(5,2),
  own_performance_score numeric(5,2),
  snapshot_date date NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX performance_history_tenant_idx ON public.performance_history(tenant_id);
CREATE INDEX performance_history_position_date_idx ON public.performance_history(position_id, snapshot_date);

-- AI-generated daily tasks
CREATE TABLE public.daily_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  position_id uuid REFERENCES public.org_positions(id) ON DELETE CASCADE,
  scorecard_row_id uuid REFERENCES public.scorecard_rows(id) ON DELETE SET NULL,
  linked_objective text,
  linked_kpi text,
  task_title text NOT NULL,
  task_description text,
  task_priority text CHECK (task_priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
  status text CHECK (status IN ('untouched', 'in_progress', 'completed')) DEFAULT 'untouched',
  task_date date NOT NULL DEFAULT current_date,
  original_date date NOT NULL DEFAULT current_date,
  rollover_count integer DEFAULT 0,
  completion_rating integer CHECK (completion_rating BETWEEN 1 AND 5),
  completion_notes text,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX daily_tasks_tenant_idx ON public.daily_tasks(tenant_id);
CREATE INDEX daily_tasks_user_date_idx ON public.daily_tasks(user_id, task_date);

-- Task generation log
CREATE TABLE public.task_generation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  generation_date date NOT NULL DEFAULT current_date,
  tasks_generated integer DEFAULT 0,
  tasks_rolled_over integer DEFAULT 0,
  ai_prompt_summary text,
  created_at timestamptz DEFAULT now()
);

-- Performance alerts
CREATE TABLE public.performance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  position_id uuid REFERENCES public.org_positions(id) ON DELETE CASCADE,
  scorecard_row_id uuid REFERENCES public.scorecard_rows(id) ON DELETE CASCADE,
  alert_type text CHECK (alert_type IN ('kpi_off_track', 'kpi_at_risk', 'overdue_task', 'rollover_exceeded')),
  alert_message text,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX performance_alerts_tenant_idx ON public.performance_alerts(tenant_id);
CREATE INDEX performance_alerts_position_idx ON public.performance_alerts(position_id);

-- Weekly advisory notes
CREATE TABLE public.weekly_advisories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  position_id uuid REFERENCES public.org_positions(id) ON DELETE CASCADE,
  advisory_text text NOT NULL,
  week_start date NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX weekly_advisories_tenant_idx ON public.weekly_advisories(tenant_id);
CREATE INDEX weekly_advisories_position_week_idx ON public.weekly_advisories(position_id, week_start);

-- ============================================================
-- RLS for all new tables
-- ============================================================
ALTER TABLE public.cascade_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_generation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_advisories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cascade_weights_all" ON public.cascade_weights FOR ALL
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.current_tenant_id());

CREATE POLICY "performance_scores_all" ON public.performance_scores FOR ALL
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.current_tenant_id());

CREATE POLICY "performance_history_all" ON public.performance_history FOR ALL
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.current_tenant_id());

CREATE POLICY "daily_tasks_all" ON public.daily_tasks FOR ALL
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.current_tenant_id());

CREATE POLICY "task_generation_log_all" ON public.task_generation_log FOR ALL
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.current_tenant_id());

CREATE POLICY "performance_alerts_all" ON public.performance_alerts FOR ALL
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.current_tenant_id());

CREATE POLICY "weekly_advisories_all" ON public.weekly_advisories FOR ALL
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.current_tenant_id());
