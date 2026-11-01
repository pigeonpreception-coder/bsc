-- Gap-scan finding (25th pass): a user can change their login email from the
-- account page (supabase.auth.updateUser({ email }), ProfileForm.tsx), which
-- updates auth.users only. public.users.email -- which every notification
-- email in the app reads (BSC review requests, SLA reminders and escalations,
-- plan approval, task assignment, account-status changes) and which the team
-- and admin pages display -- was never updated. After an email change,
-- company notifications kept going to the OLD address: typically a mailbox
-- the person no longer controls (a former employer, a compromised account
-- that prompted the change), carrying KPI and approval content.
--
-- Fix: a trigger on auth.users copies a changed email into public.users, so
-- the two cannot drift regardless of which code path (or the Auth dashboard)
-- changes it. GoTrue only writes auth.users.email after the change is
-- confirmed, so a pending, unconfirmed change does not propagate. The
-- column guard from 0035 does not cover email, and GoTrue's connection has
-- no auth.uid() anyway. public.users.email has no unique constraint, so the
-- update cannot fail the Auth operation.

create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_user_email on auth.users;
create trigger sync_user_email
  after update of email on auth.users
  for each row execute function public.sync_user_email();

-- Repair rows that already drifted before this trigger existed.
update public.users u
set email = a.email
from auth.users a
where a.id = u.id
  and a.email is not null
  and u.email is distinct from a.email;
