-- ============================================================
-- SCORECARD CELL VALUES (custom column data per row)
-- ============================================================
create table public.scorecard_cell_values (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references public.scorecards (id) on delete cascade,
  row_id uuid not null references public.scorecard_rows (id) on delete cascade,
  column_id uuid not null references public.scorecard_columns (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (row_id, column_id)
);

create index scorecard_cell_values_row_id_idx on public.scorecard_cell_values (row_id);
create index scorecard_cell_values_column_id_idx on public.scorecard_cell_values (column_id);
create index scorecard_cell_values_scorecard_id_idx on public.scorecard_cell_values (scorecard_id);

alter table public.scorecard_cell_values enable row level security;

create policy "scorecard_cell_values_all" on public.scorecard_cell_values for all
  using (tenant_id = (select tenant_id from public.users where id = auth.uid()));
