-- ============================================================
-- Rescale scorecard_columns.column_order so custom columns can be
-- inserted anywhere among the 16 fixed template columns, not just
-- appended after all of them.
--
-- The 16 fixed columns (perspective through status) now occupy fixed
-- code-level slots 100, 200, 300, ... 1600 (100 apart) — see
-- FIXED_COLUMNS in ScorecardTable.tsx. Existing custom columns, which
-- always rendered after every fixed column, are moved to start at
-- 1700+ so they keep rendering in the same relative order as before.
-- No column type change needed — column_order stays a plain int;
-- there's ample integer room (10 apart) for future in-between inserts.
-- ============================================================
update public.scorecard_columns
set column_order = 1700 + (column_order * 10);
