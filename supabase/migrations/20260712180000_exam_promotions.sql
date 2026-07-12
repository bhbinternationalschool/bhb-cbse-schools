-- Promotion / detain decisions + result-sheet policy flag.

alter table public.exam_policy
  add column if not exists require_all_subjects_pass_for_promotion boolean not null default true;

create table if not exists public.exam_promotions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  exam_term_id uuid not null references public.exam_terms(id) on delete cascade,
  academic_year_code text not null,
  from_class_id uuid not null references public.classes(id),
  from_section_id uuid not null references public.sections(id),
  decision text not null default 'pending'
    check (decision in ('pending', 'promoted', 'detained', 'conditional')),
  to_class_id uuid references public.classes(id),
  to_section_id uuid references public.sections(id),
  remark text not null default '',
  percent numeric(6,2) not null default 0,
  overall_grade text not null default '—',
  passed boolean not null default false,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  applied_to_sis_at timestamptz,
  unique (tenant_id, student_id, exam_term_id, academic_year_code)
);

create index if not exists exam_promotions_section_idx
  on public.exam_promotions (tenant_id, from_section_id, exam_term_id);
