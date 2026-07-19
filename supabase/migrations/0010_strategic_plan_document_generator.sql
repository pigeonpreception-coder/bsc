-- ============================================================
-- Strategic Plan Document Generator — schema
-- Adds: tenants.client_type (template selector), plan_sections
-- (structured, editable section tree), strategic_themes (always
-- exactly 4 per plan, Section 5.2), plan_documents (export log),
-- and strategic_objectives.theme_id (links objectives to their
-- theme once Section 5 is built — unused until then).
-- ============================================================

-- ------------------------------------------------------------
-- Template selector per tenant. Only 'private_corporate_sme' is
-- implemented; other client types are reserved for later templates.
-- ------------------------------------------------------------
alter table public.tenants add column if not exists client_type text
  not null default 'private_corporate_sme'
  check (client_type in (
    'private_corporate_sme',
    'holding_group',
    'non_profit',
    'parastatal',
    'government',
    'international_org',
    'other'
  ));

-- ------------------------------------------------------------
-- PLAN SECTIONS — the document as a structured, editable tree,
-- not one large text blob, so a single section can be viewed,
-- edited, or regenerated without touching the rest of the plan.
-- ------------------------------------------------------------
create table public.plan_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.strategic_plans (id) on delete cascade,
  section_number text not null,        -- e.g. "2.3.3"
  section_title text not null,
  parent_section_id uuid references public.plan_sections (id) on delete cascade,
  depth int not null default 1,        -- 1 = "2", 2 = "2.3", 3 = "2.3.3"
  content text,                        -- rich text / markdown for this section
  is_placeholder boolean not null default false,   -- pending-framework sections (2.3.3, 5.3)
  is_dynamic boolean not null default false,        -- rendered live from other tables (2.4.1 org chart, 5.4 BSC), not AI prose
  is_ai_addable boolean not null default true,      -- true where AI may add extra subsections under this node
  sort_order int not null default 0,
  last_generated_at timestamptz,
  last_edited_by uuid references public.users (id),
  last_edited_at timestamptz,
  created_at timestamptz not null default now()
);

create index plan_sections_tenant_id_idx on public.plan_sections (tenant_id);
create index plan_sections_plan_id_idx on public.plan_sections (plan_id);
create index plan_sections_parent_idx on public.plan_sections (parent_section_id);

alter table public.plan_sections enable row level security;

create policy "plan_sections_all" on public.plan_sections for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

-- ------------------------------------------------------------
-- STRATEGIC THEMES — Section 5.2. Always exactly 4 per plan,
-- regardless of how many strategic priorities the client listed
-- in the questionnaire; the AI consolidates down to 4.
-- ------------------------------------------------------------
create table public.strategic_themes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.strategic_plans (id) on delete cascade,
  theme_number int not null check (theme_number between 1 and 4),
  title text not null,
  intended_result text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index strategic_themes_tenant_id_idx on public.strategic_themes (tenant_id);
create index strategic_themes_plan_id_idx on public.strategic_themes (plan_id);

alter table public.strategic_themes enable row level security;

create policy "strategic_themes_all" on public.strategic_themes for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

-- Link existing strategic_objectives to their parent theme.
-- Not populated until Section 5 generation exists.
alter table public.strategic_objectives add column if not exists theme_id uuid
  references public.strategic_themes (id) on delete cascade;

-- ------------------------------------------------------------
-- PLAN DOCUMENTS — export log (PDF/Word), Supabase Storage path.
-- ------------------------------------------------------------
create table public.plan_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.strategic_plans (id) on delete cascade,
  document_type text not null check (document_type in ('pdf', 'docx')),
  file_url text not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.users (id)
);

create index plan_documents_tenant_id_idx on public.plan_documents (tenant_id);
create index plan_documents_plan_id_idx on public.plan_documents (plan_id);

alter table public.plan_documents enable row level security;

create policy "plan_documents_all" on public.plan_documents for all
  using (public.is_super_admin() or tenant_id = public.current_tenant_id())
  with check (public.is_super_admin() or tenant_id = public.current_tenant_id());
