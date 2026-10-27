-- Gap-scan finding (19th pass): company-documents' storage RLS
-- (0007_business_strategic_profile.sql) let any tenant member UPDATE and
-- DELETE any object under their tenant's folder, not only read and add.
-- That bucket holds KPI evidence (including for scorecards that are already
-- finally approved and locked), the uploaded company-profile and existing
-- strategic-plan documents that feed every AI generation prompt, and the
-- generated plan PDFs/DOCX. So any member could silently overwrite or
-- delete the evidence behind an approved BSC, or swap a source document
-- under the plan, through the Storage API directly.
--
-- Nothing in the app needs member-level update/delete: client code only
-- ever uploads new, uniquely named objects (FileUploadField.tsx and
-- EvidenceList.tsx use a Date.now() prefix; the former's `upsert: true` is
-- removed in the same commit since Storage upsert needs UPDATE permission),
-- "removing" evidence only edits the row's JSON, and the only deleters are
-- the service-role admin client (plan-export stale cleanup, deleteTenant),
-- which bypasses RLS. With no policy, UPDATE and DELETE are denied to
-- everyone but the service role. SELECT and INSERT stay tenant-wide.

drop policy if exists "company_documents_update" on storage.objects;
drop policy if exists "company_documents_delete" on storage.objects;
