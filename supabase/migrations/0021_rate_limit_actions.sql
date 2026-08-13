-- ============================================================
-- Generalizes login_attempts to cover more than just login — password-reset
-- requests had no rate limiting at all, unlike login (see
-- SAFINA_CURRENT_STATE_ASSESSMENT.md §16). Existing rows default to
-- 'login' so nothing about the existing login rate limit changes.
-- ============================================================
alter table public.login_attempts add column action text not null default 'login';

create index login_attempts_action_email_idx on public.login_attempts (action, email, attempted_at);
create index login_attempts_action_ip_idx on public.login_attempts (action, ip_address, attempted_at);

drop index if exists public.login_attempts_email_idx;
drop index if exists public.login_attempts_ip_idx;
