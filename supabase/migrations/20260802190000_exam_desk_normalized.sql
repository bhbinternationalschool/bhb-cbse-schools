-- Exam desk — normalized SoR (text ids aligned with desk localStorage)

create table if not exists public.exam_desk_terms (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label text not null,
  academic_year_code text not null,
  max_marks int not null default 100,
  sort_order int not null default 0,
  is_active boolean not null default true,
  starts_on date,
  ends_on date,
  note text not null default '',
  counts_toward_hy boolean not null default true,
  counts_toward_final boolean not null default true,
  weight_in_hy int not null default 20,
  weight_in_final int not null default 20,
  required_on_marksheet boolean not null default true,
  requires_separate_marksheet boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, academic_year_code, code)
);

create table if not exists public.exam_desk_subjects (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  class_ids jsonb not null default '[]'::jsonb,
  max_marks int not null default 100,
  sort_order int not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.exam_desk_date_sheet (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  exam_term_id text not null,
  class_id text not null,
  subject_id text not null,
  slot_date date not null,
  start_time text not null default '09:00',
  duration_minutes int not null default 60,
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_desk_sheets (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  exam_term_id text not null,
  class_id text not null,
  section_id text not null,
  locked_at timestamptz,
  entered_by text not null default '',
  updated_at timestamptz not null default now(),
  unique (tenant_id, academic_year_code, exam_term_id, section_id)
);

create table if not exists public.exam_desk_marks (
  id text primary key,
  mark_sheet_id text not null references public.exam_desk_sheets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  subject_id text not null,
  marks_obtained numeric(8,2),
  grade text not null default '—',
  remark text not null default '',
  unique (mark_sheet_id, student_id, subject_id)
);

create table if not exists public.exam_desk_policy (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  policy_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_desk_promotions (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  exam_term_id text not null,
  academic_year_code text not null,
  from_class_id text not null default '',
  from_section_id text not null default '',
  decision text not null default 'pending'
    check (decision in ('pending', 'promoted', 'detained', 'conditional')),
  to_class_id text not null default '',
  to_section_id text not null default '',
  remark text not null default '',
  percent numeric(6,2) not null default 0,
  overall_grade text not null default '—',
  passed boolean not null default false,
  decided_at timestamptz,
  decided_by text not null default '',
  applied_to_sis_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, student_id, exam_term_id, academic_year_code)
);

create table if not exists public.exam_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  term_count int not null default 0,
  subject_count int not null default 0,
  sheet_count int not null default 0,
  mark_count int not null default 0,
  promotion_count int not null default 0,
  last_sheet_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists exam_desk_sheets_term_idx
  on public.exam_desk_sheets (tenant_id, exam_term_id, section_id);

create index if not exists exam_desk_marks_student_idx
  on public.exam_desk_marks (tenant_id, student_id);

create index if not exists exam_desk_date_sheet_term_idx
  on public.exam_desk_date_sheet (tenant_id, exam_term_id, slot_date);

comment on table public.exam_desk_sheets is
  'Section mark sheets — system of record (text ids match desk localStorage)';
comment on table public.exam_desk_marks is
  'Per-student per-subject marks within a mark sheet';
