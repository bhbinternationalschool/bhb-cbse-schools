-- Per-exam HY/Final aggregate + marksheet flags; school exam policy JSON.

alter table public.exam_terms
  add column if not exists counts_toward_hy boolean not null default false,
  add column if not exists counts_toward_final boolean not null default false,
  add column if not exists weight_in_hy int not null default 0,
  add column if not exists weight_in_final int not null default 0,
  add column if not exists required_on_marksheet boolean not null default true,
  add column if not exists requires_separate_marksheet boolean not null default true;

create table if not exists public.exam_policy (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  pass_percent int not null default 33,
  default_ut_max_marks int not null default 40,
  default_term_max_marks int not null default 80,
  show_attendance_on_report boolean not null default true,
  require_all_subjects_for_report boolean not null default false,
  report_card_hold_from_stage text not null default 'S2',
  include_overall_grade boolean not null default true,
  include_components_in_hy_final_reports boolean not null default true,
  enforce_separate_marksheets_for_aggregate boolean not null default true,
  default_counts_toward_hy boolean not null default true,
  default_counts_toward_final boolean not null default true,
  default_weight_in_hy int not null default 20,
  default_weight_in_final int not null default 20,
  default_required_on_marksheet boolean not null default true,
  default_requires_separate_marksheet boolean not null default true,
  updated_at timestamptz not null default now()
);
