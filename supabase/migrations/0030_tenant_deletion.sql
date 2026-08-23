-- Tenant deletion: every tenant_id FK in this schema is already
-- `on delete cascade`, so deleting a tenants row today already cascades its
-- entire relational footprint in one atomic transaction. The one exception
-- worth changing: audit_log.tenant_id was also `cascade`, which would erase
-- the tenant's own audit trail -- including the record of its creation,
-- every license change, and the deletion event itself -- at the exact
-- moment that trail matters most. Switched to `set null` so audit rows
-- survive; their own old_value/new_value payloads already carry most of the
-- identifying context (e.g. create_tenant's payload includes company_name).
alter table public.audit_log drop constraint if exists audit_log_tenant_id_fkey;
alter table public.audit_log
  add constraint audit_log_tenant_id_fkey
  foreign key (tenant_id) references public.tenants (id) on delete set null;
