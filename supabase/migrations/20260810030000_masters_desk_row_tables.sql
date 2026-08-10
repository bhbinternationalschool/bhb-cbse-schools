-- Stage 2.3 — masters row tables, in the app's own idiom.
--
-- The Stage 2.1/2.2 audit found this database holds TWO schemas:
--
--   A. An abandoned relational design — ~25 tables (classes, sections,
--      students, households, concession_rules, fee_installments …), all
--      uuid ids, fully FK-linked, ALL EMPTY, and with zero references
--      anywhere in apps/web.
--   B. What the app actually runs on — text ids like cls_p7bw8cpc, in
--      sis_* and *_desk_* tables. sis_students holds 711 rows.
--
-- The plan assumed A could receive the masters slices. It cannot:
-- classes.id is uuid while every class id is text, and the FK web points at
-- A's own duplicates (concession_grants.student_id -> students, not
-- sis_students; fee_structure_lines.installment_id -> fee_installments).
-- Adapting it would mean changing id types on 20 tables, dropping 15 FK
-- constraints and merging three pairs of duplicate tables — a schema merge,
-- not this stage.
--
-- Director's decision (2026-08-10): build fresh in the app's idiom and leave
-- the abandoned schema alone. These sit beside masters_desk_slices and
-- follow the same naming.
--
-- No cross-table foreign keys. The desk tables the app already uses mostly
-- do without them, and adding them before measuring referential drift in the
-- JSONB would fail the migration rather than reveal the drift. Integrity is
-- asserted in the copy step instead.

create table if not exists public.masters_desk_classes (
  id text primary key, tenant_id uuid not null,
  name text, sort_order integer not null default 0, group_code text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_sections (
  id text primary key, tenant_id uuid not null,
  class_id text, name text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_campuses (
  id text primary key, tenant_id uuid not null,
  code text, name text, is_primary boolean not null default false,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_academic_years (
  id text primary key, tenant_id uuid not null,
  code text, label text, starts_on date, ends_on date, status text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_academic_terms (
  id text primary key, tenant_id uuid not null,
  code text, label text, academic_year_code text,
  starts_on date, ends_on date, sort_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_subjects (
  id text primary key, tenant_id uuid not null,
  code text, name_en text, category text, sort_order integer not null default 0,
  is_elective boolean not null default false, parent_id text,
  cbse_group_id text, ncf_tag_id text, language_subtype text, co_scholastic_area text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_class_subjects (
  id text primary key, tenant_id uuid not null,
  class_id text, subject_id text,
  periods_per_week integer not null default 0,
  is_optional boolean not null default false,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_fee_head_categories (
  id text primary key, tenant_id uuid not null,
  code text, label text, sort_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_fee_heads (
  id text primary key, tenant_id uuid not null,
  code text, name_en text, name_hi text, category text, frequency text,
  sort_order integer not null default 0,
  is_optional boolean not null default false,
  is_refundable boolean not null default false,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_installments (
  id text primary key, tenant_id uuid not null,
  code text, label text, academic_year_code text, due_on date,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_fee_groups (
  id text primary key, tenant_id uuid not null,
  code text, name text, academic_year_code text, student_type text,
  class_ids jsonb not null default '[]'::jsonb,
  structure_published_at timestamptz, structure_published_by text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_fee_structure_lines (
  id text primary key, tenant_id uuid not null,
  fee_group_id text, class_id text, fee_head_id text, installment_id text,
  amount_paise bigint not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_late_fee_rules (
  id text primary key, tenant_id uuid not null,
  academic_year_code text, fee_head_id text,
  fee_head_ids jsonb not null default '[]'::jsonb,
  mode text, value numeric, grace_days integer not null default 0,
  max_amount_paise bigint,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_special_fees (
  id text primary key, tenant_id uuid not null,
  code text, name text, academic_year_code text, fee_head_id text,
  amount_paise bigint not null default 0, due_on date, reason text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_special_fee_assignments (
  id text primary key, tenant_id uuid not null,
  special_fee_id text, student_id text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_concession_kinds (
  id text primary key, tenant_id uuid not null,
  code text, label text, is_system boolean not null default false,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_concessions (
  id text primary key, tenant_id uuid not null,
  code text, name text, academic_year_code text, kind text, mode text,
  value numeric, notes text,
  documentation_required boolean not null default false,
  auto_approve_max_paise bigint,
  fee_head_ids jsonb not null default '[]'::jsonb,
  incompatible_codes jsonb not null default '[]'::jsonb,
  sibling_tiers jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_concession_grants (
  id text primary key, tenant_id uuid not null,
  concession_id text, student_id text, status text, reason text,
  sibling_child_no integer, effective_from date, effective_to date,
  created_at timestamptz not null default now(),
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_senior_streams (
  id text primary key, tenant_id uuid not null,
  code text, name_en text, traditional_label text, nep_note text,
  sort_order integer not null default 0,
  grades jsonb not null default '[]'::jsonb,
  core_codes jsonb not null default '[]'::jsonb,
  elective_codes jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_number_series (
  id text primary key, tenant_id uuid not null,
  code text, label text, prefix text,
  next_number bigint not null default 1, pad_width integer not null default 0,
  reset_on_ay boolean not null default false,
  include_session_in_prefix boolean not null default false,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

create table if not exists public.masters_desk_holidays (
  id text primary key, tenant_id uuid not null,
  title text, academic_year_code text, kind text, scope text, mode text,
  day_type text, applies_to text, group_code text, weekday integer,
  starts_on date, ends_on date, note text,
  paid_for_staff boolean not null default false,
  is_published boolean not null default false,
  published_at timestamptz, published_by text,
  working_override boolean not null default false,
  class_ids jsonb not null default '[]'::jsonb,
  exception_dates jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

-- schoolProfile, schoolTiming and midYearFeePolicy are single documents, not
-- collections. One row each rather than a table apiece.
create table if not exists public.masters_desk_settings (
  id text primary key, tenant_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  updated_at timestamptz not null default now());

do $$
declare t text;
begin
  foreach t in array array[
    'masters_desk_classes','masters_desk_sections','masters_desk_campuses',
    'masters_desk_academic_years','masters_desk_academic_terms',
    'masters_desk_subjects','masters_desk_class_subjects',
    'masters_desk_fee_head_categories','masters_desk_fee_heads',
    'masters_desk_installments','masters_desk_fee_groups',
    'masters_desk_fee_structure_lines','masters_desk_late_fee_rules',
    'masters_desk_special_fees','masters_desk_special_fee_assignments',
    'masters_desk_concession_kinds','masters_desk_concessions',
    'masters_desk_concession_grants','masters_desk_senior_streams',
    'masters_desk_number_series','masters_desk_holidays','masters_desk_settings']
  loop
    execute format('create index if not exists %I on public.%I (tenant_id)', t||'_tenant_idx', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- Deliberately NOT done: no rows added to desk_writable_tables, so
-- desk_write_guarded still refuses every one of these. Granting write access
-- is a separate review, after the app reads from them.
