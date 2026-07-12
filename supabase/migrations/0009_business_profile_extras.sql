-- ============================================================
-- Section 1: existing Strategic Plan draft upload + arbitrary
-- supporting documents. Section 2: Key/Core Products & Services.
-- Columns only — strategic_plans already has tenant_id + RLS
-- from 0001, no new table.
-- ============================================================

alter table public.strategic_plans add column if not exists strategic_plan_document_url text;

-- Dynamic "add another document" list: [{ url, fileName }, ...]
alter table public.strategic_plans add column if not exists supporting_documents jsonb not null default '[]'::jsonb;

-- [{ description, status }, ...] — status one of
-- 'Primary (Key & Core)' | 'Secondary' | 'Augmented (Not Primary)'
alter table public.strategic_plans add column if not exists key_products_services jsonb not null default '[]'::jsonb;
