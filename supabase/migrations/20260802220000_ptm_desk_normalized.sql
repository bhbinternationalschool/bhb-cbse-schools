-- PTM scheduler — normalized SoR (text ids aligned with SIS / staff)

create table if not exists public.ptm_desk_events (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  name text not null default '',
  event_date date not null,
  end_date date not null,
  class_ids_json jsonb not null default '[]'::jsonb,
  mode text not null default 'in_person'
    check (mode in ('in_person', 'video', 'phone')),
  note text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ptm_desk_slots (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id text not null references public.ptm_desk_events(id) on delete cascade,
  teacher_staff_id text not null default '',
  teacher_name text not null default '',
  start_at text not null default '',
  end_at text not null default '',
  capacity int not null default 1 check (capacity >= 1),
  room_or_link text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.ptm_desk_bookings (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id text not null references public.ptm_desk_events(id) on delete cascade,
  slot_id text not null references public.ptm_desk_slots(id) on delete cascade,
  student_id text not null,
  parent_name text not null default '',
  household_id text not null default '',
  status text not null default 'booked'
    check (status in ('booked', 'cancelled', 'completed', 'no_show')),
  booked_at timestamptz not null default now(),
  whatsapp_confirmed_at text not null default '',
  whatsapp_reminded_at text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.ptm_desk_feedback (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id text not null references public.ptm_desk_bookings(id) on delete cascade,
  student_id text not null,
  strengths text not null default '',
  areas text not null default '',
  follow_up text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now(),
  unique (booking_id)
);

create table if not exists public.ptm_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  event_count int not null default 0,
  slot_count int not null default 0,
  booking_count int not null default 0,
  feedback_count int not null default 0,
  last_booked_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists ptm_desk_events_tenant_date_idx
  on public.ptm_desk_events (tenant_id, event_date desc);

create index if not exists ptm_desk_slots_event_idx
  on public.ptm_desk_slots (tenant_id, event_id);

create index if not exists ptm_desk_bookings_student_idx
  on public.ptm_desk_bookings (tenant_id, student_id, status);

comment on table public.ptm_desk_events is
  'PTM events — system of record (text ids match desk localStorage)';
