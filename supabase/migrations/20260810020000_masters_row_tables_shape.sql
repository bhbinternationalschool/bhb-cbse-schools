-- Stage 2.2 — bring the masters row tables to the data-layer contract.
--
-- SCHEMA ONLY. No data is copied, nothing is switched over, and no table is
-- added to desk_writable_tables — so nothing can write through the new path
-- yet. Copying the slices in is a separate, verifiable step.
--
-- Context from the Stage 2.1 audit, which overturned this stage's premise:
-- the plan assumed the typed masters tables "mostly already exist". They
-- exist and are unusable. All 20 are EMPTY except number_series (4 rows),
-- and NONE is referenced anywhere in apps/web — dead scaffolding from
-- 20260712230000_foundation_masters.sql, the same pattern as academic_years.
-- Concretely they were missing:
--
--   * updated_at on all 20 — so not one of them could carry a revision,
--     which desk_write_guarded requires. This alone blocks the stage.
--   * tenant_id on fee_structure_lines, sections and
--     special_fee_assignments. fee_structure_lines backs 268 rows of fee
--     structure; as designed it could not tell one school's fees from
--     another's.
--   * whole tables for concessions (26 rows of live data), installments
--     (24) and fee_head_categories (13).
--   * fields the app actually stores: classes had no is_active, sections
--     had three columns against four fields, and so on.
--
-- Approach: ALTER rather than drop-and-recreate. The tables are empty and
-- unreferenced so either is safe, but two tables meaning the same thing is
-- how the blob/desk split happened in the first place. Every statement here
-- is additive, so the previous Cloud Run revision keeps working.
--
-- Column shapes are taken from the live JSONB, not from the original
-- migration's guesses. List-valued fields (classIds, feeHeadIds, grades,
-- exceptionDates …) stay jsonb: they are genuinely lists, and inventing
-- join tables for them is Stage 2 scope creep.

-- ── Shared shape ─────────────────────────────────────────────────────────
-- Every collection needs the same three things: an id, the tenant it
-- belongs to, and a revision the write guard can compare against.
do $$
declare t text;
begin
  foreach t in array array[
    'classes','sections','subjects','class_subjects','campuses',
    'academic_years','academic_terms','fee_heads','fee_groups',
    'fee_structure_lines','late_fee_rules','special_fees',
    'special_fee_assignments','concession_kinds','concession_grants',
    'senior_streams','number_series','holidays','departments','designations'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists tenant_id uuid', t);
    execute format(
      'alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format(
      'alter table public.%I add column if not exists is_active boolean not null default true', t);
    -- Scoping every read by tenant is mandatory in the repo; make it cheap.
    execute format(
      'create index if not exists %I on public.%I (tenant_id)',
      t || '_tenant_idx', t);
  end loop;
end $$;

-- ── Per-entity fields the live JSONB carries ─────────────────────────────
alter table public.classes
  add column if not exists sort_order  integer not null default 0,
  add column if not exists group_code  text;

alter table public.sections
  add column if not exists class_id    text;

alter table public.subjects
  add column if not exists code                text,
  add column if not exists name_en             text,
  add column if not exists category            text,
  add column if not exists sort_order          integer not null default 0,
  add column if not exists is_elective         boolean not null default false,
  add column if not exists parent_id           text,
  add column if not exists cbse_group_id       text,
  add column if not exists ncf_tag_id          text,
  add column if not exists language_subtype    text,
  add column if not exists co_scholastic_area  text;

alter table public.class_subjects
  add column if not exists class_id         text,
  add column if not exists subject_id       text,
  add column if not exists periods_per_week integer not null default 0,
  add column if not exists is_optional      boolean not null default false;

alter table public.campuses
  add column if not exists code       text,
  add column if not exists name       text,
  add column if not exists is_primary boolean not null default false;

alter table public.academic_terms
  add column if not exists code               text,
  add column if not exists label              text,
  add column if not exists academic_year_code text,
  add column if not exists starts_on          date,
  add column if not exists ends_on            date,
  add column if not exists sort_order         integer not null default 0;

alter table public.fee_heads
  add column if not exists code          text,
  add column if not exists name_en       text,
  add column if not exists name_hi       text,
  add column if not exists category      text,
  add column if not exists frequency     text,
  add column if not exists sort_order    integer not null default 0,
  add column if not exists is_optional   boolean not null default false,
  add column if not exists is_refundable boolean not null default false;

alter table public.fee_groups
  add column if not exists code                   text,
  add column if not exists name                   text,
  add column if not exists academic_year_code     text,
  add column if not exists student_type           text,
  -- A list of class ids; genuinely a list, so jsonb rather than a join table.
  add column if not exists class_ids              jsonb not null default '[]'::jsonb,
  add column if not exists structure_published_at timestamptz,
  add column if not exists structure_published_by text;

alter table public.fee_structure_lines
  add column if not exists fee_group_id   text,
  add column if not exists class_id       text,
  add column if not exists fee_head_id    text,
  add column if not exists installment_id text,
  add column if not exists amount_paise   bigint not null default 0;

alter table public.late_fee_rules
  add column if not exists academic_year_code text,
  add column if not exists fee_head_id        text,
  add column if not exists fee_head_ids       jsonb not null default '[]'::jsonb,
  add column if not exists mode               text,
  add column if not exists value              numeric,
  add column if not exists grace_days         integer not null default 0,
  add column if not exists max_amount_paise   bigint;

alter table public.special_fees
  add column if not exists code               text,
  add column if not exists name               text,
  add column if not exists academic_year_code text,
  add column if not exists fee_head_id        text,
  add column if not exists amount_paise       bigint not null default 0,
  add column if not exists due_on             date,
  add column if not exists reason             text;

alter table public.concession_kinds
  add column if not exists code      text,
  add column if not exists label     text,
  add column if not exists is_system boolean not null default false;

alter table public.concession_grants
  add column if not exists concession_id    text,
  add column if not exists student_id       text,
  add column if not exists status           text,
  add column if not exists reason           text,
  add column if not exists sibling_child_no integer,
  add column if not exists effective_from   date,
  add column if not exists effective_to     date,
  add column if not exists created_at       timestamptz not null default now();

alter table public.senior_streams
  add column if not exists code              text,
  add column if not exists name_en           text,
  add column if not exists traditional_label text,
  add column if not exists nep_note          text,
  add column if not exists sort_order        integer not null default 0,
  add column if not exists grades            jsonb not null default '[]'::jsonb,
  add column if not exists core_codes        jsonb not null default '[]'::jsonb,
  add column if not exists elective_codes    jsonb not null default '[]'::jsonb;

alter table public.number_series
  add column if not exists code                        text,
  add column if not exists label                       text,
  add column if not exists prefix                      text,
  add column if not exists next_number                 bigint not null default 1,
  add column if not exists pad_width                   integer not null default 0,
  add column if not exists reset_on_ay                 boolean not null default false,
  add column if not exists include_session_in_prefix   boolean not null default false;

alter table public.holidays
  add column if not exists title              text,
  add column if not exists academic_year_code text,
  add column if not exists kind               text,
  add column if not exists scope              text,
  add column if not exists mode               text,
  add column if not exists day_type           text,
  add column if not exists applies_to         text,
  add column if not exists group_code         text,
  add column if not exists weekday            integer,
  add column if not exists starts_on          date,
  add column if not exists ends_on            date,
  add column if not exists note               text,
  add column if not exists paid_for_staff     boolean not null default false,
  add column if not exists is_published       boolean not null default false,
  add column if not exists published_at       timestamptz,
  add column if not exists published_by       text,
  add column if not exists working_override   boolean not null default false,
  add column if not exists class_ids          jsonb not null default '[]'::jsonb,
  add column if not exists exception_dates    jsonb not null default '[]'::jsonb;

alter table public.special_fee_assignments
  add column if not exists special_fee_id text,
  add column if not exists student_id     text;

-- ── Tables that never existed ────────────────────────────────────────────
-- concessions holds 26 live rows in JSONB today, installments 24 and
-- fee_head_categories 13. Nothing to alter — these are new.
create table if not exists public.fee_head_categories (
  id          text primary key,
  tenant_id   uuid,
  code        text,
  label       text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);
create index if not exists fee_head_categories_tenant_idx
  on public.fee_head_categories (tenant_id);

create table if not exists public.installments (
  id                 text primary key,
  tenant_id          uuid,
  code               text,
  label              text,
  academic_year_code text,
  due_on             date,
  sort_order         integer not null default 0,
  is_active          boolean not null default true,
  updated_at         timestamptz not null default now()
);
create index if not exists installments_tenant_idx
  on public.installments (tenant_id);

create table if not exists public.concessions (
  id                       text primary key,
  tenant_id                uuid,
  code                     text,
  name                     text,
  academic_year_code       text,
  kind                     text,
  mode                     text,
  value                    numeric,
  notes                    text,
  documentation_required   boolean not null default false,
  auto_approve_max_paise   bigint,
  -- Lists, kept as lists.
  fee_head_ids             jsonb not null default '[]'::jsonb,
  incompatible_codes       jsonb not null default '[]'::jsonb,
  sibling_tiers            jsonb not null default '[]'::jsonb,
  is_active                boolean not null default true,
  updated_at               timestamptz not null default now()
);
create index if not exists concessions_tenant_idx
  on public.concessions (tenant_id);

-- ── Backfill tenant_id on the one table that already holds rows ──────────
-- number_series has 4 rows predating this shape. Single-tenant today, so
-- the resolution is unambiguous; a second tenant would make it not so, which
-- is why the composite-key cleanup is on the Stage 10 list.
update public.number_series ns
   set tenant_id = (select t.id from public.tenants t order by t.created_at limit 1)
 where ns.tenant_id is null;

-- ── Access posture, matching the rest of the desk tables ─────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'classes','sections','subjects','class_subjects','campuses',
    'academic_years','academic_terms','fee_heads','fee_groups',
    'fee_structure_lines','late_fee_rules','special_fees',
    'special_fee_assignments','concession_kinds','concession_grants',
    'senior_streams','number_series','holidays','departments','designations',
    'fee_head_categories','installments','concessions'
  ]
  loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- Deliberately NOT done here:
--   * no rows are added to desk_writable_tables, so desk_write_guarded still
--     refuses every one of these tables. Granting write access is a separate
--     review.
--   * no data is copied out of masters_desk_slices, which stays the source
--     of truth and stays readable.
