-- ============================================================
-- User Profile Self-Management + Account Lifecycle.
-- status mirrors tenants.license_status's exact shape (a plain, unconstrained
-- default + check pattern already established for this kind of state).
-- ============================================================

alter table public.users add column if not exists phone text;
alter table public.users add column if not exists email_notifications_enabled boolean not null default true;
alter table public.users add column if not exists status text not null default 'active'
  check (status in ('active', 'suspended', 'deactivated'));
