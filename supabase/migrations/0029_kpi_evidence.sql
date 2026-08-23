-- KPI evidence: supporting documents/screenshots attached to a scorecard
-- row's current actual value. Reuses the existing private company-documents
-- bucket (tenant-folder RLS already generalizes to any subfolder) rather
-- than standing up a new bucket/policy set.
alter table public.scorecard_rows
  add column if not exists evidence jsonb not null default '[]'::jsonb;

-- The bucket's allow-list (added in 0020) only covered Office/PDF types,
-- since it was built for business-profile documents. Evidence realistically
-- includes photos/screenshots too.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/webp'
]
where id = 'company-documents';
