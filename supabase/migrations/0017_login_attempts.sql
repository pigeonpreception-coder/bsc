-- ============================================================
-- Login rate limiting. Attempts happen pre-auth (no tenant_id to
-- scope by, and often no resolvable user yet), so this is a global
-- table written only by the service-role client via src/lib/rate-limit.ts
-- — not by RLS-scoped clients. RLS is still enabled with zero policies
-- so no anon/authenticated session can read or write it either way.
-- ============================================================
create table public.login_attempts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  ip_address text,
  success boolean not null,
  attempted_at timestamptz not null default now()
);

create index login_attempts_email_idx on public.login_attempts (email, attempted_at);
create index login_attempts_ip_idx on public.login_attempts (ip_address, attempted_at);

alter table public.login_attempts enable row level security;
