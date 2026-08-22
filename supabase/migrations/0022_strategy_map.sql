-- ============================================================
-- Strategy Map Generation Engine — cause-and-effect connections between a
-- plan's strategic objectives, plus the row position each objective ends
-- up at after the deterministic crossing-free layout pass.
-- ============================================================

alter table public.strategic_objectives add column if not exists map_order int;

create table public.strategy_map_connections (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.strategic_plans (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  from_objective_id uuid not null references public.strategic_objectives (id) on delete cascade,
  to_objective_id uuid not null references public.strategic_objectives (id) on delete cascade,
  connection_type text not null check (connection_type in ('vertical', 'lateral')),
  created_at timestamptz not null default now()
);

create index strategy_map_connections_tenant_id_idx on public.strategy_map_connections (tenant_id);
create index strategy_map_connections_plan_id_idx on public.strategy_map_connections (plan_id);

alter table public.strategy_map_connections enable row level security;

create policy "strategy_map_connections_all" on public.strategy_map_connections for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());
