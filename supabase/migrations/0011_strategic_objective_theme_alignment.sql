-- ============================================================
-- Corporate Strategic Objectives are generated independently of
-- Strategic Themes (16-24 objectives, distributed across the 4
-- canonical BSC perspectives), then aligned to themes afterwards.
-- One objective can align with more than one theme (even all 4),
-- so a single theme_id foreign key on strategic_objectives can't
-- model this — replaced with a many-to-many junction table.
-- ============================================================

alter table public.strategic_objectives drop column if exists theme_id;

create table public.strategic_objective_themes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.strategic_plans (id) on delete cascade,
  objective_id uuid not null references public.strategic_objectives (id) on delete cascade,
  theme_id uuid not null references public.strategic_themes (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (objective_id, theme_id)
);

create index strategic_objective_themes_tenant_id_idx on public.strategic_objective_themes (tenant_id);
create index strategic_objective_themes_plan_id_idx on public.strategic_objective_themes (plan_id);
create index strategic_objective_themes_objective_idx on public.strategic_objective_themes (objective_id);
create index strategic_objective_themes_theme_idx on public.strategic_objective_themes (theme_id);

alter table public.strategic_objective_themes enable row level security;

create policy "strategic_objective_themes_all" on public.strategic_objective_themes for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());
