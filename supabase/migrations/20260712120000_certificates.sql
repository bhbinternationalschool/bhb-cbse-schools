-- Issued certificates (TC, bonafide, character, fee clearance)

create table if not exists public.certificate_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('tc', 'bonafide', 'character', 'fee_clearance', 'fees_paid')),
  cert_no text not null,
  student_id uuid not null references public.students(id),
  household_id uuid references public.households(id),
  academic_year_code text not null,
  student_name text not null,
  admission_no text not null default '',
  pen text not null default '',
  apaar_id text not null default '',
  father_name text not null default '',
  mother_name text not null default '',
  dob date,
  gender text not null default '',
  class_label text not null default '',
  roll_no text not null default '',
  admission_date date,
  leaving_date date,
  reason_for_leaving text not null default '',
  last_class_studied text not null default '',
  promoted_to text not null default '',
  conduct text not null default 'Good',
  remarks text not null default '',
  -- CBSE Annexure-I extras (JSON or columns; demo stores in app payload)
  tc_json jsonb,
  open_balance_paise bigint not null default 0,
  dues_cleared boolean not null default false,
  override_dues boolean not null default false,
  issued_on date not null,
  issued_by text not null default '',
  inactivated_student boolean not null default false,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, cert_no)
);

create index if not exists certificate_issues_student_idx
  on public.certificate_issues (tenant_id, student_id, kind);

comment on table public.certificate_issues is
  'TC / bonafide / character / fee clearance; HOLD_TC and open dues gate TC issue';
