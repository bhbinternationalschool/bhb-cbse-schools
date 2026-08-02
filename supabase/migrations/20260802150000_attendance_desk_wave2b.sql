-- Wave 2b — attendance policy, absent nudges, exceptions

alter table public.attendance_desk_sync_meta
  add column if not exists ancillary_updated_at timestamptz,
  add column if not exists nudge_count int not null default 0,
  add column if not exists exception_count int not null default 0,
  add column if not exists open_exception_count int not null default 0;

create table if not exists public.attendance_desk_policy (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  teacher_cutoff_time text not null default '10:30',
  lock_teachers_after_cutoff boolean not null default true,
  absent_nudge_enabled boolean not null default true,
  absent_nudge_max_open int not null default 12 check (absent_nudge_max_open between 1 and 40),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_desk_absent_nudges (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  register_id text not null default '',
  attendance_date date not null,
  section_id text not null default '',
  academic_year_code text not null,
  mobile text not null default '',
  message text not null default '',
  sent_at timestamptz not null default now(),
  sent_by text not null default '',
  nudge_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists attendance_desk_nudges_student_idx
  on public.attendance_desk_absent_nudges (tenant_id, student_id, sent_at desc);

create table if not exists public.attendance_desk_exceptions (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in (
    'present_on_leave', 'late_on_leave', 'absent_no_whatsapp',
    'perfect_present_streak', 'parent_dispute'
  )),
  status text not null default 'open' check (status in ('open', 'resolved')),
  student_id text not null,
  academic_year_code text not null,
  class_id text not null default '',
  section_id text not null default '',
  attendance_date date not null,
  register_id text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text not null default '',
  resolve_note text not null default '',
  exception_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists attendance_desk_exceptions_open_idx
  on public.attendance_desk_exceptions (tenant_id, status, attendance_date desc)
  where status = 'open';

comment on table public.attendance_desk_policy is
  'Tenant attendance desk policy — teacher cut-off and absent nudge settings';
comment on table public.attendance_desk_absent_nudges is
  'WhatsApp absent nudge log — rebuilt on desk sync';
comment on table public.attendance_desk_exceptions is
  'Attendance exception inbox — leave conflicts, disputes, streaks';
