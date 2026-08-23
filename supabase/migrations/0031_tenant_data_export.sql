-- Tenant data export produces a structured JSON dump, uploaded to the same
-- private company-documents bucket used for every other tenant document.
-- Its MIME allow-list (0020, widened for images in 0029) didn't cover
-- application/json.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/json'
]
where id = 'company-documents';
