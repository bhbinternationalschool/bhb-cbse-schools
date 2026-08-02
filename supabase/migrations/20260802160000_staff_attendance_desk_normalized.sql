-- Staff attendance desk — normalized SoR (text ids aligned with sis_staff)

create table if not exists public.staff_attendance_desk_registers (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  attendance_date date not null,
  marked_by text not null default '',
  marked_at timestamptz not null default now(),
  remark text not null default '',
  register_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (tenant_id, academic_year_code, attendance_date)
);

create table if not exists public.staff_attendance_desk_marks (
  id text primary key,
  register_id text not null references public.staff_attendance_desk_registers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id text not null,
  status text not null check (status in ('P', 'A', 'L', 'HD', 'LE')),
  note text not null default '',
  in_time text not null default '',
  out_time text not null default '',
  punch_way text not null default '',
  mark_json jsonb not null default '{}'::jsonb,
  unique (register_id, staff_id)
);

create table if not exists public.staff_attendance_desk_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  allow_self_punch boolean not null default true,
  auto_apply_rules_on_save boolean not null default false,
  sync_leave_to_attendance boolean not null default true,
  allow_whatsapp_punch boolean not null default true,
  geofence_radius_m int not null default 150 check (geofence_radius_m > 0),
  max_location_accuracy_m int not null default 120 check (max_location_accuracy_m >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_attendance_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  register_count int not null default 0,
  last_marked_at timestamptz,
  settings_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists staff_attendance_desk_registers_date_idx
  on public.staff_attendance_desk_registers (tenant_id, attendance_date desc);

create index if not exists staff_attendance_desk_marks_staff_idx
  on public.staff_attendance_desk_marks (tenant_id, staff_id);

comment on table public.staff_attendance_desk_registers is
  'Staff daily attendance registers — system of record';
