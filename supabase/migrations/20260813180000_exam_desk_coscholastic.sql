-- NEP 2020 HPC co-scholastic domain ratings (socio-emotional, psychomotor),
-- one row per student x domain per mark sheet — same shape as the existing
-- exam_desk_marks table (one row per student x subject).

create table if not exists public.exam_desk_coscholastic (
  id text primary key,
  mark_sheet_id text not null references public.exam_desk_sheets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  domain text not null,
  rating text not null default '',
  unique (mark_sheet_id, student_id, domain)
);

create index if not exists exam_desk_coscholastic_student_idx
  on public.exam_desk_coscholastic (tenant_id, student_id);

comment on table public.exam_desk_coscholastic is
  'NEP 2020 HPC co-scholastic domain ratings (socio-emotional, psychomotor) — one row per student x domain per exam_desk_sheets row.';

grant all on public.exam_desk_coscholastic to service_role;

notify pgrst, 'reload schema';
