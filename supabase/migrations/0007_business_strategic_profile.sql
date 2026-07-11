-- ============================================================
-- BUSINESS PROFILE & STRATEGIC PROFILE — extend strategic_plans
-- ============================================================

-- `values` was a plain text[] ("Integrity", "Excellence", ...).
-- The new UI needs {name, description} pairs, so convert losslessly:
-- old strings become {name: <string>, description: ''}.
alter table public.strategic_plans add column values_new jsonb;

update public.strategic_plans
set values_new = (
  select coalesce(jsonb_agg(jsonb_build_object('name', v, 'description', '')), '[]'::jsonb)
  from unnest(values) as v
);

alter table public.strategic_plans drop column values;
alter table public.strategic_plans rename column values_new to values;
alter table public.strategic_plans alter column values set default '[]'::jsonb;
alter table public.strategic_plans alter column values set not null;

-- Section 1: Business Profile
alter table public.strategic_plans add column overall_strategic_goal text;
alter table public.strategic_plans add column strategic_priorities jsonb not null default '[]'::jsonb;
alter table public.strategic_plans add column industry text;
alter table public.strategic_plans add column industry_other text;
alter table public.strategic_plans add column sector text;
alter table public.strategic_plans add column sector_other text;
alter table public.strategic_plans add column business_description text;
alter table public.strategic_plans add column business_background text;
alter table public.strategic_plans add column business_direction text;
alter table public.strategic_plans add column company_profile_url text;
alter table public.strategic_plans add column website_url text;

-- Section 2: Strategic Profile
alter table public.strategic_plans add column financial_year_start date;
alter table public.strategic_plans add column vision_achievement_date date;
alter table public.strategic_plans add column key_customers jsonb not null default '[]'::jsonb;
alter table public.strategic_plans add column key_stakeholders jsonb not null default '[]'::jsonb;
alter table public.strategic_plans add column additional_info text;

-- Draft autosave bookkeeping
alter table public.strategic_plans add column last_saved_at timestamptz;

-- ============================================================
-- STORAGE: company profile document upload
-- Private bucket — files served via short-lived signed URLs, not
-- public links. Path convention: {tenant_id}/company-profile/{filename}
-- ============================================================
insert into storage.buckets (id, name, public)
values ('company-documents', 'company-documents', false)
on conflict (id) do nothing;

create policy "company_documents_select" on storage.objects for select
  using (
    bucket_id = 'company-documents'
    and (public.is_super_admin() or (storage.foldername(name))[1] = public.current_tenant_id()::text)
  );

create policy "company_documents_insert" on storage.objects for insert
  with check (
    bucket_id = 'company-documents'
    and (public.is_super_admin() or (storage.foldername(name))[1] = public.current_tenant_id()::text)
  );

create policy "company_documents_update" on storage.objects for update
  using (
    bucket_id = 'company-documents'
    and (public.is_super_admin() or (storage.foldername(name))[1] = public.current_tenant_id()::text)
  );

create policy "company_documents_delete" on storage.objects for delete
  using (
    bucket_id = 'company-documents'
    and (public.is_super_admin() or (storage.foldername(name))[1] = public.current_tenant_id()::text)
  );
