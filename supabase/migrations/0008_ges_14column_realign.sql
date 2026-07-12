-- ============================================================
-- Realign scorecard_rows to the platform-standard GES 14-column
-- template (per the bsc-generator skill, now the source of truth).
-- Data-preserving: renames existing columns rather than dropping,
-- so the Kodecamp test rows survive.
-- ============================================================

-- 1. Rename existing columns to their new template names (keeps data)
alter table public.scorecard_rows rename column weight to objective_weight;
alter table public.scorecard_rows rename column initiative to key_initiatives;
alter table public.scorecard_rows rename column timeline to measurement_frequency;

-- 2. Add the new columns the GES template needs
alter table public.scorecard_rows add column if not exists strategic_theme_alignment text;
alter table public.scorecard_rows add column if not exists perspective_weight numeric;
-- Some KPIs are "lower is better" (cost, days-to-resolve, error rate);
-- the RAG math flips the ratio for these.
alter table public.scorecard_rows add column if not exists lower_is_better boolean not null default false;

-- 3. Drop the columns the GES template removed
alter table public.scorecard_rows drop column if exists notes;

-- 4. Status (RAG): 4 states now, adding 'not_yet_measured'
alter table public.scorecard_rows drop constraint if exists scorecard_rows_status_check;
alter table public.scorecard_rows add constraint scorecard_rows_status_check
  check (status in ('not_yet_measured', 'on_track', 'at_risk', 'off_track'));
-- Rows with no Actual should read as not-yet-measured (recomputed by the app too)
update public.scorecard_rows set status = 'not_yet_measured' where actual is null or actual = '';

-- 5. Perspective: the classic 4 and the GES expanded labels both need to be
--    valid (Financial, Customer & Stakeholder, Internal Processes,
--    Organisational Capacity). Drop the rigid enum; the app validates and
--    orders perspectives, and a tenant's own labels shouldn't be rejected here.
alter table public.scorecard_rows drop constraint if exists scorecard_rows_perspective_check;
alter table public.strategic_objectives drop constraint if exists strategic_objectives_perspective_check;
