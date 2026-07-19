-- ============================================================
-- Organisational Structure Setup — template selector.
-- The onboarding wizard's org_positions generation is currently
-- private-corporate-only. JP will provide additional structures
-- (Public Company, Government of a Country, Non-Profit, UN, EU,
-- AU, Religious Organisation, others) at a later stage. This
-- column is only the selector, added ahead of time so a template
-- registry (mirroring plan-templates/) can be built onto it once
-- those structures are provided — nothing reads it yet.
-- ============================================================

alter table public.tenants add column if not exists org_structure_type text
  not null default 'private_corporate'
  check (org_structure_type in (
    'private_corporate',
    'public_company',
    'government',
    'non_profit',
    'un_organisation',
    'eu_organisation',
    'au_organisation',
    'religious_organisation',
    'other'
  ));
