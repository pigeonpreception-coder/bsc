-- Correction to 0027: the KPI-score approval workflow it built operates on
-- individual scorecard_rows. The actual governance unit is the whole BSC --
-- scorecards.owner_user_id has existed since 0001/onboarding for exactly
-- this purpose (one owner per scorecard) but was never wired to a workflow.
-- This migration moves workflow state from scorecard_rows to scorecards and
-- removes it from scorecard_rows. No live Supabase project has run 0027 yet
-- (pre-launch), so this freely reshapes rather than layering a shim.

alter table public.scorecard_rows drop constraint if exists scorecard_rows_approval_status_check;
drop index if exists scorecard_rows_workflow_state_idx;

alter table public.scorecard_rows
  drop column if exists approval_status,
  drop column if exists edited_by,
  drop column if exists first_approved_by,
  drop column if exists first_approved_at,
  drop column if exists first_approval_comments,
  drop column if exists final_approved_by,
  drop column if exists final_approved_at,
  drop column if exists final_approval_comments,
  drop column if exists rejected_by,
  drop column if exists rejected_at,
  drop column if exists rejected_level,
  drop column if exists rejection_reason,
  drop column if exists amendment_requested_by,
  drop column if exists amendment_requested_at,
  drop column if exists amendment_reason;

drop table if exists public.scorecard_row_versions;

-- workflow_status is deliberately separate from scorecards.status (which
-- already means draft/active/archived for the plan-cycle concept) -- this
-- is the BSC review/approval/lock state, a different axis entirely.
alter table public.scorecards
  add column if not exists workflow_status text not null default 'owner_editing' check (workflow_status in (
    'owner_editing', 'pending_manager_review', 'pending_final_review', 'locked'
  )),
  add column if not exists version_major integer not null default 1,
  add column if not exists version_minor integer not null default 0,
  add column if not exists agreed_by uuid references public.users(id) on delete set null,
  add column if not exists agreed_at timestamptz,
  add column if not exists first_approved_by uuid references public.users(id) on delete set null,
  add column if not exists first_approved_at timestamptz,
  add column if not exists first_approval_comments text,
  add column if not exists final_approved_by uuid references public.users(id) on delete set null,
  add column if not exists final_approved_at timestamptz,
  add column if not exists final_approval_comments text,
  add column if not exists locked_at timestamptz,
  add column if not exists rejected_by uuid references public.users(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_level text check (rejected_level in ('first', 'final')),
  add column if not exists rejection_reason text,
  add column if not exists unlocked_by uuid references public.users(id) on delete set null,
  add column if not exists unlocked_at timestamptz,
  add column if not exists unlock_reason text;

create index if not exists scorecards_workflow_status_idx
  on public.scorecards (tenant_id, workflow_status)
  where workflow_status in ('pending_manager_review', 'pending_final_review');

-- One row per workflow event (agree / first-approve / final-approve /
-- reject / unlock), each carrying a full snapshot of that scorecard's rows
-- at that moment -- satisfies both the "final approved snapshot" and the
-- "compare original vs proposed version" requirements from one structure,
-- diffable client-side against the jsonb without a separate diff table.
create table public.scorecard_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scorecard_id uuid not null references public.scorecards(id) on delete cascade,
  version_major integer not null,
  version_minor integer not null,
  workflow_status text not null,
  event text not null check (event in ('agreed', 'first_approved', 'finally_approved', 'rejected', 'unlocked')),
  actor_id uuid references public.users(id) on delete set null,
  comments text,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index scorecard_versions_scorecard_idx on public.scorecard_versions (scorecard_id, version_major, version_minor);

alter table public.scorecard_versions enable row level security;

create policy "scorecard_versions_all" on public.scorecard_versions for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());
