-- Manual task assignment: distinguishes a person-assigned daily_tasks row
-- from an AI-generated one (assigned_by is null) without a redundant
-- enum/source column — who assigned it *is* the "is this manual" signal.
alter table public.daily_tasks
  add column if not exists assigned_by uuid references public.users(id) on delete set null;

create index if not exists daily_tasks_assigned_by_idx on public.daily_tasks (assigned_by);
