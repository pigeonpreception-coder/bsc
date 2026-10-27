-- Gap-scan finding (18th pass): closes out the tenant-only `for all` policy
-- backlog that §40/§42/§43 each explicitly deferred a piece of.
--
-- strategic_objectives, strategic_themes, plan_sections, plan_documents,
-- strategic_objective_themes, strategy_map_connections, and ai_sessions were
-- the last tables in the schema still carrying a tenant-only `for all`
-- policy from `0001_init.sql`/`0010_strategic_plan_document_generator.sql`/
-- `0011_strategic_objective_theme_alignment.sql`/`0022_strategy_map.sql`.
-- Re-traced every access site of all seven (fresh grep, every write and
-- every read) as of this commit: every single writer already goes through
-- `createAdminClient()` (the AI-generation pipeline was hardened with
-- internal tenant assertions in earlier passes, §18/§19), and the RLS-scoped
-- client is only ever used to read these tables (the plan detail page,
-- document-actions.ts's read-only queries). So unlike 0033/0035/0036, this
-- migration doesn't close an active application-level authorization bypass
-- -- it's the defense-in-depth step of actually making that the only path,
-- rather than something every future PR has to keep getting right by
-- convention. Same shape as always: tenant-scoped SELECT, service-role-only
-- write.
--
-- This clears the tenant-only `for all` backlog across the whole schema —
-- no table with this shape remains.

drop policy if exists "strategic_objectives_all" on public.strategic_objectives;
create policy "strategic_objectives_select" on public.strategic_objectives for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "strategic_objectives_write" on public.strategic_objectives for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "strategic_themes_all" on public.strategic_themes;
create policy "strategic_themes_select" on public.strategic_themes for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "strategic_themes_write" on public.strategic_themes for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "plan_sections_all" on public.plan_sections;
create policy "plan_sections_select" on public.plan_sections for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "plan_sections_write" on public.plan_sections for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "plan_documents_all" on public.plan_documents;
create policy "plan_documents_select" on public.plan_documents for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "plan_documents_write" on public.plan_documents for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "strategic_objective_themes_all" on public.strategic_objective_themes;
create policy "strategic_objective_themes_select" on public.strategic_objective_themes for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "strategic_objective_themes_write" on public.strategic_objective_themes for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "strategy_map_connections_all" on public.strategy_map_connections;
create policy "strategy_map_connections_select" on public.strategy_map_connections for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "strategy_map_connections_write" on public.strategy_map_connections for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "ai_sessions_all" on public.ai_sessions;
create policy "ai_sessions_select" on public.ai_sessions for select
  using (public.is_super_admin() or tenant_id = public.current_tenant_id());
create policy "ai_sessions_write" on public.ai_sessions for all
  using (public.is_super_admin()) with check (public.is_super_admin());
