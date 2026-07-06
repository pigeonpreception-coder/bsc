-- ============================================================
-- ORG POSITIONS (organisational hierarchy tree)
-- ============================================================
create table public.org_positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  position_type text not null
    check (position_type in ('board', 'executive', 'non_executive')),
  office_department_name text not null,
  job_title text not null,
  first_name text,
  surname text,
  reports_to_id uuid references public.org_positions (id) on delete set null,
  custom_fields jsonb not null default '{}',
  bsc_level text
    check (bsc_level in ('corporate', 'executive', 'departmental', 'individual')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index org_positions_tenant_id_idx on public.org_positions (tenant_id);
create index org_positions_reports_to_idx on public.org_positions (reports_to_id);

-- ============================================================
-- POSITION SCORECARDS (links positions to generated scorecards)
-- ============================================================
create table public.position_scorecards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  position_id uuid not null references public.org_positions (id) on delete cascade,
  scorecard_id uuid not null references public.scorecards (id) on delete cascade,
  scorecard_scope text not null
    check (scorecard_scope in ('office_department', 'individual')),
  created_at timestamptz not null default now()
);

create index position_scorecards_tenant_id_idx on public.position_scorecards (tenant_id);
create index position_scorecards_position_id_idx on public.position_scorecards (position_id);

-- ============================================================
-- Extend scorecards check constraint to support 'executive' type
-- ============================================================
alter table public.scorecards drop constraint if exists scorecards_scorecard_type_check;
alter table public.scorecards add constraint scorecards_scorecard_type_check
  check (scorecard_type in ('corporate', 'executive', 'departmental', 'individual'));

-- ============================================================
-- Track onboarding completion per tenant
-- ============================================================
alter table public.tenants add column if not exists onboarding_completed boolean not null default false;

-- ============================================================
-- RLS
-- ============================================================
alter table public.org_positions enable row level security;
alter table public.position_scorecards enable row level security;

create policy "org_positions_all" on public.org_positions for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy "position_scorecards_all" on public.position_scorecards for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());
