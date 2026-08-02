-- Student attendance registers — normalized SoR (text ids aligned with sis_students)

create table if not exists public.attendance_desk_registers (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  campus_id text not null default '',
  class_id text not null,
  section_id text not null,
  attendance_date date not null,
  marked_by text not null default '',
  marked_at timestamptz not null default now(),
  remark text not null default '',
  register_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (tenant_id, section_id, academic_year_code, attendance_date)
);

create table if not exists public.attendance_desk_marks (
  id text primary key,
  register_id text not null references public.attendance_desk_registers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  status text not null check (status in ('P', 'A', 'L', 'HD', 'LE')),
  note text not null default '',
  unique (register_id, student_id)
);

create table if not exists public.attendance_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  register_count int not null default 0,
  last_marked_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists attendance_desk_registers_tenant_date_idx
  on public.attendance_desk_registers (tenant_id, attendance_date desc);

create index if not exists attendance_desk_registers_section_idx
  on public.attendance_desk_registers (tenant_id, section_id, attendance_date desc);

create index if not exists attendance_desk_marks_student_idx
  on public.attendance_desk_marks (tenant_id, student_id);

comment on table public.attendance_desk_registers is
  'Section daily attendance registers — system of record (text ids match desk localStorage)';
