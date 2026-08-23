-- SMS notification preference. Defaults to false (opt-in), unlike
-- email_notifications_enabled's opt-out default -- SMS costs real money per
-- message and needs a phone number to already be on file, so this shouldn't
-- fire for anyone who hasn't explicitly turned it on.
alter table public.users
  add column if not exists sms_notifications_enabled boolean not null default false;
