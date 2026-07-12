-- Exams & report cards — demo uses localStorage; schema for Supabase.

create table if not exists public.exam_terms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  code text not null,
  label text not null,
  max_marks int not null default 100,
  sort_order int not null default 0,
  is_active boolean not null default true,
  unique (tenant_id, academic_year_code, code)
);

create table if not exists public.exam_subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  max_marks int not null default 100,
  sort_order int not null default 0,
  is_active boolean not null default true,
  unique (tenant_id, code)
);

create table if not exists public.exam_subject_classes (
  subject_id uuid not null references public.exam_subjects(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  primary key (subject_id, class_id)
);

create table if not exists public.exam_mark_sheets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  exam_term_id uuid not null references public.exam_terms(id) on delete cascade,
  class_id uuid not null references public.classes(id),
  section_id uuid not null references public.sections(id),
  locked_at timestamptz,
  entered_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (tenant_id, academic_year_code, exam_term_id, section_id)
);

create table if not exists public.exam_marks (
  id uuid primary key default gen_random_uuid(),
  mark_sheet_id uuid not null references public.exam_mark_sheets(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.exam_subjects(id),
  marks_obtained numeric(6,2),
  grade text,
  remark text not null default '',
  unique (mark_sheet_id, student_id, subject_id)
);

create index if not exists exam_marks_student_idx
  on public.exam_marks (student_id);

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'academics.exams', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;
