-- Safina BSC Platform — Phase 1 schema
-- Multi-tenant: every tenant-scoped table carries tenant_id and is protected by RLS.

create extension if not exists "pgcrypto";

-- ============================================================
-- TENANTS
-- ============================================================
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  license_tier text not null default 'basic'
    check (license_tier in ('basic', 'professional', 'enterprise')),
  license_status text not null default 'active'
    check (license_status in ('active', 'suspended', 'expired')),
  license_start date,
  license_end date,
  created_by uuid, -- super_admin user id (FK added after users table exists)
  created_at timestamptz not null default now()
);

-- ============================================================
-- USERS (profile table mirroring auth.users)
-- ============================================================
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null
    check (role in ('super_admin', 'company_admin', 'manager', 'staff', 'viewer')),
  tenant_id uuid references public.tenants (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint tenant_required_unless_super_admin
    check (role = 'super_admin' or tenant_id is not null)
);

alter table public.tenants
  add constraint tenants_created_by_fkey
  foreign key (created_by) references public.users (id);

create index users_tenant_id_idx on public.users (tenant_id);

-- ============================================================
-- Helper functions (SECURITY DEFINER to avoid RLS recursion)
-- ============================================================
create or replace function public.current_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select tenant_id from public.users where id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_role() = 'super_admin', false);
$$;

-- ============================================================
-- USER PERMISSIONS (fine-grained, resource-level access)
-- ============================================================
create table public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  resource_type text not null,
  resource_id uuid not null,
  permission_level text not null
    check (permission_level in ('view', 'edit', 'admin')),
  created_at timestamptz not null default now()
);

create index user_permissions_tenant_id_idx on public.user_permissions (tenant_id);
create index user_permissions_user_id_idx on public.user_permissions (user_id);

-- ============================================================
-- STRATEGIC PLANS
-- ============================================================
create table public.strategic_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_name text not null,
  vision text,
  mission text,
  values text[],
  strategic_period_years int,
  period_start date,
  period_end date,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  questionnaire_answers jsonb not null default '{}'::jsonb,
  ai_generated_content jsonb,
  created_at timestamptz not null default now()
);

create index strategic_plans_tenant_id_idx on public.strategic_plans (tenant_id);

-- ============================================================
-- STRATEGIC OBJECTIVES
-- ============================================================
create table public.strategic_objectives (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.strategic_plans (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  perspective text not null
    check (perspective in ('Financial', 'Customer', 'Internal Process', 'Learning & Growth')),
  objective_text text not null,
  weight numeric,
  created_at timestamptz not null default now()
);

create index strategic_objectives_tenant_id_idx on public.strategic_objectives (tenant_id);
create index strategic_objectives_plan_id_idx on public.strategic_objectives (plan_id);

-- ============================================================
-- SCORECARDS
-- ============================================================
create table public.scorecards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid references public.strategic_plans (id) on delete cascade,
  scorecard_type text not null
    check (scorecard_type in ('corporate', 'departmental', 'individual')),
  name text not null,
  department_name text,
  owner_user_id uuid references public.users (id),
  parent_scorecard_id uuid references public.scorecards (id),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now()
);

create index scorecards_tenant_id_idx on public.scorecards (tenant_id);
create index scorecards_plan_id_idx on public.scorecards (plan_id);
create index scorecards_parent_idx on public.scorecards (parent_scorecard_id);

-- ============================================================
-- SCORECARD ROWS (the 14-column FCTS template)
-- ============================================================
create table public.scorecard_rows (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references public.scorecards (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  perspective text not null
    check (perspective in ('Financial', 'Customer', 'Internal Process', 'Learning & Growth')),
  strategic_objective text not null,
  intended_result text,
  kpi text not null,
  baseline text,
  target text,
  actual text,
  unit text,
  weight numeric,
  initiative text,
  responsible_person uuid references public.users (id),
  timeline text,
  status text not null default 'on_track'
    check (status in ('on_track', 'at_risk', 'off_track')),
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index scorecard_rows_tenant_id_idx on public.scorecard_rows (tenant_id);
create index scorecard_rows_scorecard_id_idx on public.scorecard_rows (scorecard_id);
create index scorecard_rows_responsible_person_idx on public.scorecard_rows (responsible_person);

-- ============================================================
-- SCORECARD COLUMNS (custom column configs per scorecard)
-- ============================================================
create table public.scorecard_columns (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references public.scorecards (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  column_key text not null,
  column_label text not null,
  column_order int not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now()
);

create index scorecard_columns_tenant_id_idx on public.scorecard_columns (tenant_id);
create index scorecard_columns_scorecard_id_idx on public.scorecard_columns (scorecard_id);

-- ============================================================
-- PERFORMANCE SNAPSHOTS (history for trend charts)
-- ============================================================
create table public.performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  scorecard_row_id uuid not null references public.scorecard_rows (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  snapshot_date date not null default current_date,
  actual_value text,
  updated_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index performance_snapshots_tenant_id_idx on public.performance_snapshots (tenant_id);
create index performance_snapshots_row_id_idx on public.performance_snapshots (scorecard_row_id);

-- ============================================================
-- AUDIT LOG
-- ============================================================
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  user_id uuid references public.users (id),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  old_value jsonb,
  new_value jsonb,
  timestamp timestamptz not null default now()
);

create index audit_log_tenant_id_idx on public.audit_log (tenant_id);

-- ============================================================
-- AI SESSIONS
-- ============================================================
create table public.ai_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid references public.users (id),
  session_type text not null
    check (session_type in ('plan_generation', 'bsc_generation', 'advisory')),
  prompt_summary text,
  response_summary text,
  created_at timestamptz not null default now()
);

create index ai_sessions_tenant_id_idx on public.ai_sessions (tenant_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.user_permissions enable row level security;
alter table public.strategic_plans enable row level security;
alter table public.strategic_objectives enable row level security;
alter table public.scorecards enable row level security;
alter table public.scorecard_rows enable row level security;
alter table public.scorecard_columns enable row level security;
alter table public.performance_snapshots enable row level security;
alter table public.audit_log enable row level security;
alter table public.ai_sessions enable row level security;

-- TENANTS: super_admin sees/manages all; tenant members can read their own tenant
create policy "tenants_select" on public.tenants for select
  using (public.is_super_admin() or id = public.current_tenant_id());
create policy "tenants_insert" on public.tenants for insert
  with check (public.is_super_admin());
create policy "tenants_update" on public.tenants for update
  using (public.is_super_admin());
create policy "tenants_delete" on public.tenants for delete
  using (public.is_super_admin());

-- USERS: super_admin sees all; users see themselves and others in their tenant
create policy "users_select" on public.users for select
  using (
    public.is_super_admin()
    or id = auth.uid()
    or tenant_id = public.current_tenant_id()
  );
create policy "users_insert" on public.users for insert
  with check (
    public.is_super_admin()
    or (public.current_role() = 'company_admin' and tenant_id = public.current_tenant_id())
  );
create policy "users_update" on public.users for update
  using (
    public.is_super_admin()
    or id = auth.uid()
    or (public.current_role() = 'company_admin' and tenant_id = public.current_tenant_id())
  );
create policy "users_delete" on public.users for delete
  using (public.is_super_admin());

-- Generic tenant-scoped policy template applied to each remaining table:
-- readable/writable by super_admin or members of the same tenant.

create policy "user_permissions_all" on public.user_permissions for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy "strategic_plans_all" on public.strategic_plans for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy "strategic_objectives_all" on public.strategic_objectives for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy "scorecards_all" on public.scorecards for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy "scorecard_rows_all" on public.scorecard_rows for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy "scorecard_columns_all" on public.scorecard_columns for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy "performance_snapshots_all" on public.performance_snapshots for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy "audit_log_select" on public.audit_log for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "audit_log_insert" on public.audit_log for insert
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy "ai_sessions_all" on public.ai_sessions for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());
