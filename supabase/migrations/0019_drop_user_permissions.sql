-- ============================================================
-- user_permissions was a resource-level ACL table (resource_type/
-- resource_id/permission_level) defined with RLS but never referenced by
-- any application code. Access control is coarse role-based (company_admin/
-- manager/staff/viewer) throughout the app; nothing needs per-resource
-- sharing today. See SAFINA_CURRENT_STATE_ASSESSMENT.md §9/§12.
-- ============================================================
drop table if exists public.user_permissions;
