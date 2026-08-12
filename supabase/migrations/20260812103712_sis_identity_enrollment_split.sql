-- SIS identity/enrollment split — Phase 1: new tables, additive only.
--
-- Plan: docs/SIS_IDENTITY_ENROLLMENT_SPLIT_PLAN.md
-- Phase 0 (2026-08-12) found: 719 sis_students rows, only 273 unique
-- admission numbers — every child gets a fresh row each academic year,
-- all marked active simultaneously, linked only by a free-text
-- admission_no with no stable ID. Zero genuine identity conflicts across
-- the 226 duplicated admission numbers (checked, not assumed).
--
-- This migration creates the two new tables and NOTHING else.
-- sis_students is not touched. No trigger, no backfill, no app code reads
-- these tables yet — that's Phase 2 and Phase 3. Reversible by dropping
-- both tables; there is nothing yet that depends on them.
--
-- sis_student_identities: one row per child, for life. Fields split out
-- of sis_students that do not vary by academic year.
--
-- sis_enrollments: one row per child per academic year. Fields that do
-- vary by year, linked back to the identity. unique(identity_id,
-- academic_year_code) is the constraint that makes the bug Phase 0 found
-- structurally impossible going forward — a child cannot get two active
-- enrollment rows for the same year.

create table if not exists public.sis_student_identities (
  id                    text primary key,
  tenant_id             uuid not null,

  admission_no          text not null,
  full_name             text not null default '',
  gender                text not null default '',
  dob                   date,

  father_name           text not null default '',
  mother_name           text not null default '',
  father_mobile         text not null default '',
  mother_mobile         text not null default '',
  father_aadhaar_last4  text not null default '',
  mother_aadhaar_last4  text not null default '',
  father_pan            text not null default '',
  mother_pan            text not null default '',
  guardian_relation     text not null default '',
  emergency_name        text not null default '',
  emergency_mobile      text not null default '',
  household_id          text not null default '',

  blood_group           text not null default '',
  religion              text not null default '',
  category              text not null default '',
  nationality           text not null default '',
  mother_tongue         text not null default '',
  place_of_birth        text not null default '',
  aadhaar_last4         text not null default '',

  pen                   text not null default '',
  pen_status            text not null default '',
  apaar_id              text not null default '',
  srn                   text not null default '',
  previous_school       text not null default '',
  previous_tc_no        text not null default '',
  previous_udise        text not null default '',

  docs                  jsonb not null default '{}'::jsonb,
  notes                 text not null default '',
  photo_url             text not null default '',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One admission number per tenant. Partial: historical rows with a blank
-- admission_no (seen in some seed data) must not collide with each other.
create unique index if not exists sis_student_identities_admission_no_key
  on public.sis_student_identities (tenant_id, admission_no)
  where admission_no <> '';

create index if not exists sis_student_identities_tenant_idx
  on public.sis_student_identities (tenant_id);

alter table public.sis_student_identities enable row level security;
revoke all on public.sis_student_identities from anon, authenticated;

create table if not exists public.sis_enrollments (
  id                          text primary key,
  tenant_id                   uuid not null,
  identity_id                 text not null
    references public.sis_student_identities (id),

  academic_year_code          text not null,
  class_id                    text not null default '',
  section_id                  text not null default '',
  campus_id                   text not null default '',
  roll_no                     text not null default '',
  fee_group_id                text not null default '',
  student_type                text not null default '',
  status                      text not null default 'active',
  joined_on                   date,

  -- Set when this row was created by promoting a prior year's enrollment,
  -- rather than a fresh admission. Null for a brand-new student. This is
  -- the audit trail Phase 4's promotion rewrite depends on.
  promoted_from_enrollment_id text
    references public.sis_enrollments (id),

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- A child has at most one enrollment per academic year. This is the
-- constraint that makes Phase 0's finding — the same admission number
-- with four simultaneously "active" rows — impossible to reintroduce
-- once Phase 4 switches the write path over.
create unique index if not exists sis_enrollments_identity_year_key
  on public.sis_enrollments (identity_id, academic_year_code);

create index if not exists sis_enrollments_tenant_idx
  on public.sis_enrollments (tenant_id);
create index if not exists sis_enrollments_class_section_idx
  on public.sis_enrollments (class_id, section_id);
create index if not exists sis_enrollments_identity_idx
  on public.sis_enrollments (identity_id);

alter table public.sis_enrollments enable row level security;
revoke all on public.sis_enrollments from anon, authenticated;
