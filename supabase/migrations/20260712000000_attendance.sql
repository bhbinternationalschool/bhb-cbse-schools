-- Daily class attendance registers (never gated by fee holds)

create table if not exists public.attendance_registers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  campus_id uuid,
  class_id uuid not null,
  section_id uuid not null,
  attendance_date date not null,
  marked_by text not null default '',
  marked_at timestamptz not null default now(),
  remark text not null default '',
  unique (tenant_id, section_id, attendance_date, academic_year_code)
);

create table if not exists public.attendance_marks (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references public.attendance_registers(id) on delete cascade,
  student_id uuid not null references public.students(id),
  status text not null check (status in ('P', 'A', 'L', 'HD', 'LE')),
  note text not null default '',
  unique (register_id, student_id)
);

create index if not exists attendance_registers_date_idx
  on public.attendance_registers (tenant_id, attendance_date);

create index if not exists attendance_marks_student_idx
  on public.attendance_marks (student_id, register_id);

comment on table public.attendance_registers is
  'Section daily register; marking is never blocked by fee_hold_policies';
