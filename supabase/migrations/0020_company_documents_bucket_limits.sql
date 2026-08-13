-- ============================================================
-- The company-documents bucket was created with no file_size_limit or
-- allowed_mime_types (0007_business_strategic_profile.sql), so both the
-- 20MB size cap and the extension allow-list on the upload form
-- (FileUploadField.tsx) were client-side only and trivially bypassed
-- (e.g. a direct call to the Storage API). This enforces the same limits
-- server-side, at the bucket itself.
-- ============================================================
update storage.buckets
set
  file_size_limit = 20971520, -- 20MB, matching the client-side cap
  allowed_mime_types = array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
where id = 'company-documents';
