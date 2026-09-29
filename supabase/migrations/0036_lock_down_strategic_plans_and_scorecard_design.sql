-- Gap-scan finding (17th pass), same shape as 0033/0035: a tenant-only
-- `for all` policy on tables where application code already restricts
-- writes to company_admin, or to a specific workflow transition, but never
-- enforced that at the database layer.
--
-- strategic_plans.status gates whether this tenant's Balanced Scorecards go
-- live at all (generateCascadedBSCs requires status = 'active'; see §35 of
-- the current-state assessment) and approveStrategicPlan() fires a
-- tenant-wide notification exactly once on the transition into 'active'. A
-- direct client write could flip status to 'active' without ever going
-- through that gate (skipping the notification and the company_admin
-- check), or edit the business-profile fields that feed every AI generation
-- prompt for this plan (saveBusinessProfileDraft, company_admin-gated in
-- app code only). scorecard_columns/scorecard_cell_values are scorecard
-- *design* data (column definitions, per-cell values like targets and
-- baselines) that feed directly into the performance-scoring engine —
-- add/delete/rename-column and cell-value writes were all company_admin-only
-- in app code (column-actions.ts) but not in RLS.
--
-- Every writer of all three tables already goes through the service-role
-- key as of this same commit (shared.ts's requireCompanyAdminForPlan,
-- questionnaire/actions.ts's saveBusinessProfileDraft, and all four
-- functions in column-actions.ts) — this migration is what actually makes
-- that the only path.
--
-- Deliberately not extended to the remaining tenant-only `for all` tables
-- this pass looked at (strategic_objectives, strategic_themes, plan_sections,
-- plan_documents, strategic_objective_themes, strategy_map_connections,
-- ai_sessions): every writer of those already uses the admin client (the AI
-- generation pipeline was hardened with internal tenant assertions in
-- earlier passes), so there is no active app-level authorization bypass to
-- close the way there was for the three tables above -- tightening their
-- RLS too is real, lower-urgency follow-up work, not done here to keep this
-- pass reviewable.

drop policy if exists "strategic_plans_all" on public.strategic_plans;
create policy "strategic_plans_select" on public.strategic_plans for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "strategic_plans_write" on public.strategic_plans for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "scorecard_columns_all" on public.scorecard_columns;
create policy "scorecard_columns_select" on public.scorecard_columns for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "scorecard_columns_write" on public.scorecard_columns for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "scorecard_cell_values_all" on public.scorecard_cell_values;
create policy "scorecard_cell_values_select" on public.scorecard_cell_values for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "scorecard_cell_values_write" on public.scorecard_cell_values for all
  using (public.is_super_admin()) with check (public.is_super_admin());
