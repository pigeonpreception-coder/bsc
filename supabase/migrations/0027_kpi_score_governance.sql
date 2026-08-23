-- Replaces 0025's single-level, company_admin-only approval with a
-- two-level, organizational-hierarchy-resolved chain: immediate manager
-- (first, non-final) -> nearest executive-level position (final -- this
-- schema has no distinct "division" concept, see src/lib/approval-hierarchy.ts)
-- -> locked. No live Supabase project has run 0025 yet (pre-launch), so this
-- freely reshapes rather than layering a compatibility shim.

alter table public.scorecard_rows drop constraint if exists scorecard_rows_approval_status_check;

update public.scorecard_rows set approval_status = 'finally_approved' where approval_status = 'approved';
update public.scorecard_rows set approval_status = 'submitted' where approval_status = 'pending_approval';
update public.scorecard_rows set approval_status = 'correction_required' where approval_status = 'rejected';
update public.scorecard_rows set approval_status = 'not_submitted'
  where approval_status is null or approval_status not in ('finally_approved', 'submitted', 'correction_required');

alter table public.scorecard_rows
  add column if not exists edited_by uuid references public.users(id) on delete set null,
  add column if not exists first_approved_by uuid references public.users(id) on delete set null,
  add column if not exists first_approved_at timestamptz,
  add column if not exists first_approval_comments text,
  add column if not exists final_approved_by uuid references public.users(id) on delete set null,
  add column if not exists final_approved_at timestamptz,
  add column if not exists final_approval_comments text,
  add column if not exists rejected_by uuid references public.users(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_level text check (rejected_level in ('first', 'final')),
  add column if not exists amendment_requested_by uuid references public.users(id) on delete set null,
  add column if not exists amendment_requested_at timestamptz,
  add column if not exists amendment_reason text;

-- Carry the old single-level approval record onto the new final-approval
-- columns so a row already marked finally_approved doesn't lose who/when.
update public.scorecard_rows
  set final_approved_by = approved_by, final_approved_at = approved_at
  where approval_status = 'finally_approved' and approved_by is not null;

alter table public.scorecard_rows
  drop column if exists approved_by,
  drop column if exists approved_at;

alter table public.scorecard_rows alter column approval_status set default 'not_submitted';

alter table public.scorecard_rows add constraint scorecard_rows_approval_status_check check (
  approval_status in (
    'not_submitted', 'submitted', 'first_approved', 'finally_approved',
    'correction_required', 'amendment_requested', 'reopened'
  )
);

drop index if exists scorecard_rows_pending_approval_idx;
create index if not exists scorecard_rows_workflow_state_idx
  on public.scorecard_rows (tenant_id, approval_status)
  where approval_status in ('submitted', 'first_approved', 'amendment_requested');

-- Version history through the approval chain (spec's "preserve previous
-- versions" requirement) -- distinct from performance_snapshots, which only
-- ever recorded the raw actual-value text with no link to an approval cycle.
create table public.scorecard_row_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scorecard_row_id uuid not null references public.scorecard_rows(id) on delete cascade,
  version_number integer not null,
  actual text,
  computed_status text,
  approval_status text not null,
  event text not null check (event in (
    'submitted', 'first_approved', 'finally_approved', 'rejected', 'amendment_requested', 'reopened'
  )),
  actor_id uuid references public.users(id) on delete set null,
  comments text,
  created_at timestamptz not null default now()
);

create index scorecard_row_versions_row_idx on public.scorecard_row_versions (scorecard_row_id, version_number);

alter table public.scorecard_row_versions enable row level security;

create policy "scorecard_row_versions_all" on public.scorecard_row_versions for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());
