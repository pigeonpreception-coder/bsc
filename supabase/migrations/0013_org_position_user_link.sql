-- ============================================================
-- Explicit link between an org position and the user who holds it.
-- Replaces fuzzy name-matching (org_positions.first_name/surname
-- vs. users.full_name) used by dashboard/daily-tasks/alerts logic.
-- ============================================================
alter table public.org_positions
  add column user_id uuid references public.users (id) on delete set null;

create index org_positions_user_id_idx on public.org_positions (user_id);
