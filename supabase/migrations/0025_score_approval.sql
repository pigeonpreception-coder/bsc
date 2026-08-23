-- Score approval workflow: a manager/staff edit to a KPI's "actual" value
-- goes into pending_approval until a company_admin reviews it. Defaults to
-- 'approved' so existing rows (and rows with no actual yet) don't suddenly
-- appear to need review.
alter table public.scorecard_rows
  add column if not exists approval_status text not null default 'approved'
    check (approval_status in ('pending_approval', 'approved', 'rejected')),
  add column if not exists approved_by uuid references public.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists rejection_reason text;

create index if not exists scorecard_rows_pending_approval_idx
  on public.scorecard_rows (tenant_id)
  where approval_status = 'pending_approval';
