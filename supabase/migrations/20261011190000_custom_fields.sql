/*
 * Custom fields (old SStudy ERP: Configuration → Custom Field). The office
 * adds fields to student and staff records from Masters → Custom fields,
 * without a code change (lib/customFields).
 *
 * The VALUES live in their own table, one row per (record, field), each
 * with its own updated_at — never inside sis_students / sis_staff. Student
 * records have been corrupted several times by whole-record saves
 * (erp-sis-students-profile-column, erp-parent-contacts-and-aadhaar), so a
 * custom-field edit must not be able to rewrite or blank a built-in field,
 * and a stale tab must not overwrite a newer value: the app writes a value
 * only while the row still holds the updated_at it was loaded at
 * (compare-and-set; "" = insert-only).
 *
 * entity_id is the SIS row id (sis_students.id / sis_staff.id, both text).
 * No foreign key to those tables: a record admitted in the browser reaches
 * sis_students on the roster's background push, possibly after its custom
 * values are saved.
 *
 * A field with values cannot be hard-deleted (on delete restrict);
 * deactivating hides it and keeps the values.
 */

create table if not exists public.custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_type text not null check (entity_type in ('student', 'staff')),
  label_en text not null check (length(btrim(label_en)) between 1 and 60),
  label_hi text not null default '',
  field_type text not null check (field_type in ('text', 'number', 'date', 'choice', 'yes_no')),
  /** choice: the allowed answers, a JSON array of strings. [] otherwise. */
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  required_on_new boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by text not null default '',
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of the values' composite key: a value can only name a field of
  -- its own entity type.
  unique (id, entity_type)
);

-- One label per entity type (case-insensitive), active or not: the import
-- matches columns by label, so two fields called "House" would be a guess.
create unique index if not exists custom_field_defs_label_uidx
  on public.custom_field_defs (tenant_id, entity_type, lower(btrim(label_en)));
create index if not exists custom_field_defs_entity_idx
  on public.custom_field_defs (tenant_id, entity_type, sort_order);

create table if not exists public.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_type text not null check (entity_type in ('student', 'staff')),
  entity_id text not null check (length(entity_id) between 1 and 120),
  field_id uuid not null,
  /** Stored canonical: date ISO YYYY-MM-DD, number plain, yes_no 'yes'/'no'. */
  value text not null default '' check (length(value) <= 2000),
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, entity_type, entity_id, field_id),
  foreign key (field_id, entity_type)
    references public.custom_field_defs (id, entity_type) on delete restrict
);

create index if not exists custom_field_values_field_idx
  on public.custom_field_values (tenant_id, entity_type, field_id);

alter table public.custom_field_defs enable row level security;
alter table public.custom_field_values enable row level security;

drop policy if exists custom_field_defs_tenant_read on public.custom_field_defs;
create policy custom_field_defs_tenant_read
  on public.custom_field_defs
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists custom_field_values_tenant_read on public.custom_field_values;
create policy custom_field_values_tenant_read
  on public.custom_field_values
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- Spelled out: a new table without the service_role grant fails as a bare
-- 42501 that reads like a bug in the caller (erp-supabase-new-table-grant).
grant select on public.custom_field_defs to authenticated;
grant select on public.custom_field_values to authenticated;
grant select, insert, update, delete on public.custom_field_defs to service_role;
grant select, insert, update, delete on public.custom_field_values to service_role;

notify pgrst, 'reload schema';
