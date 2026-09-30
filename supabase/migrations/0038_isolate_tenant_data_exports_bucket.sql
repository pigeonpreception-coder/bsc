-- Gap-scan finding (18th pass): exportTenantData() (data-export-actions.ts,
-- company_admin-only in application code) writes its full JSON dump -- every
-- user's role/status, every scorecard and row, the entire audit trail up to
-- 5000 entries, the strategic plan -- into the `company-documents` bucket.
-- That bucket's own storage RLS (0007_business_strategic_profile.sql) only
-- ever checks the tenant-folder prefix, not role: any tenant member can
-- list and download anything under their tenant's folder, which is the
-- correct, intended behavior for the things that bucket was built for
-- (KPI evidence, uploaded company/strategic-plan documents, generated plan
-- PDFs/DOCX -- all things a non-admin tenant member is meant to read). The
-- signed URL returned to the admin who triggered the export adds no real
-- protection here, since any other tenant member could reach the same file
-- directly through the Storage API with their own session, entirely
-- bypassing the company_admin gate exportTenantData() itself enforces.
--
-- Fix: a dedicated private bucket for exports, so the broad tenant-read
-- policy the other bucket legitimately needs doesn't leak onto this one.
-- SELECT (and, for symmetry, INSERT/UPDATE/DELETE, even though the only
-- writer is the service-role admin client, which bypasses RLS regardless)
-- require both the tenant-folder match and company_admin.

insert into storage.buckets (id, name, public)
values ('tenant-data-exports', 'tenant-data-exports', false)
on conflict (id) do nothing;

create policy "tenant_data_exports_select" on storage.objects for select
  using (
    bucket_id = 'tenant-data-exports'
    and (
      public.is_super_admin()
      or ((storage.foldername(name))[1] = public.current_tenant_id()::text and public.current_role() = 'company_admin')
    )
  );

create policy "tenant_data_exports_insert" on storage.objects for insert
  with check (
    bucket_id = 'tenant-data-exports'
    and (
      public.is_super_admin()
      or ((storage.foldername(name))[1] = public.current_tenant_id()::text and public.current_role() = 'company_admin')
    )
  );

create policy "tenant_data_exports_update" on storage.objects for update
  using (
    bucket_id = 'tenant-data-exports'
    and (
      public.is_super_admin()
      or ((storage.foldername(name))[1] = public.current_tenant_id()::text and public.current_role() = 'company_admin')
    )
  );

create policy "tenant_data_exports_delete" on storage.objects for delete
  using (
    bucket_id = 'tenant-data-exports'
    and (
      public.is_super_admin()
      or ((storage.foldername(name))[1] = public.current_tenant_id()::text and public.current_role() = 'company_admin')
    )
  );
