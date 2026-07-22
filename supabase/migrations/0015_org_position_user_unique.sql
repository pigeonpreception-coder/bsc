-- ============================================================
-- Enforce "one user holds at most one position" at the database
-- level, not just in application logic. A race between two nearly
-- simultaneous assignments now fails with a clear constraint error
-- instead of silently linking one user to two positions.
--
-- Replaces the plain (non-unique) index from migration 0013 — a
-- unique index already serves lookups just as well, so there's no
-- need to keep both.
-- ============================================================
drop index if exists public.org_positions_user_id_idx;

create unique index org_positions_user_id_unique_idx
  on public.org_positions (user_id)
  where user_id is not null;
