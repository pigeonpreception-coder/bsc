-- ============================================================
-- ai_generated_content was the old single-shot Strategic Plan
-- generation flow's storage column. That flow was fully removed
-- (replaced by the Strategic Plan Document Generator) and nothing
-- in the codebase reads or writes this column anymore.
-- ============================================================
alter table public.strategic_plans drop column if exists ai_generated_content;
