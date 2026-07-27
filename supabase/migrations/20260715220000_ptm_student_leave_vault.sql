-- PTM (§19b), student leave (§19c), document vault (§21a)

create table if not exists public.ptm_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  academic_year_code text not null,
  name text not null,
  event_date date not null,
  end_date date,
  class_ids text[] not null default '{}',
  mode text not null default 'in_person',
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ptm_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ptm_events(id) on delete cascade,
  teacher_staff_id text,
  teacher_name text,
  start_at text not null,
  end_at text not null,
  capacity integer not null default 1,
  room_or_link text
);

create table if not exists public.ptm_bookings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ptm_events(id) on delete cascade,
  slot_id uuid not null references public.ptm_slots(id) on delete cascade,
  student_id text not null,
  parent_name text,
  household_id text,
  status text not null default 'booked',
  booked_at timestamptz not null default now()
);

create table if not exists public.ptm_feedback (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.ptm_bookings(id) on delete cascade,
  student_id text not null,
  strengths text,
  areas text,
  follow_up text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.student_leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  academic_year_code text not null,
  student_id text not null,
  from_date date not null,
  to_date date not null,
  leave_type text not null,
  reason text,
  attachment_url text,
  status text not null default 'pending',
  requested_by text,
  household_id text,
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  attendance_applied boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists student_leave_student_idx
  on public.student_leave_requests (student_id, from_date);

create table if not exists public.vault_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  doc_type text not null,
  title text not null,
  file_url text,
  file_name text,
  issued_on date,
  expires_on date,
  reminder_days integer not null default 30,
  owner_role text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vault_documents_expires_idx
  on public.vault_documents (expires_on);

comment on table public.ptm_events is 'PTM days (§19b) — client localStorage until wired.';
comment on table public.student_leave_requests is 'Student leave (§19c) — client localStorage until wired.';
comment on table public.vault_documents is 'Document vault (§21a) — client localStorage until wired.';
