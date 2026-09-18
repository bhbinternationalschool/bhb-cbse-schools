-- Exam rooms, and the seat each child sits in.
--
-- WHY: the seating plan is printed in the office, pasted on the benches and
-- carried by the invigilator — three people on three devices. Invigilation
-- (lib/examInvigilation.ts) kept its duty roster in localStorage and says so
-- in its own header; a seating plan cannot afford that, because the slip on
-- the desk and the sheet in the invigilator's hand have to be the same plan.
--
-- Both ride the existing exam desk sync (exam_desk_*), so they hydrate with
-- everything else rather than needing a second path.

create table if not exists public.exam_desk_rooms (
  tenant_id uuid not null,
  id text not null,
  name text not null,
  benches smallint not null default 0 check (benches >= 0),
  -- Two or three. This school has both, and a bench of seven would quietly
  -- break every arrangement built on it.
  seats_per_bench smallint not null default 2 check (seats_per_bench in (2, 3)),
  is_active boolean not null default true,
  note text not null default '',
  sort_order smallint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create table if not exists public.exam_desk_seating (
  tenant_id uuid not null,
  id text not null,
  academic_year_code text not null,
  exam_term_id text not null,
  generated_at timestamptz not null default now(),
  generated_by text not null default '',
  -- [{roomId, benchNumber, seatNumber, studentId, classId}] — one plan per
  -- exam, so a child finds the same bench on every paper of it.
  seats jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, academic_year_code, exam_term_id)
);

alter table public.exam_desk_rooms enable row level security;
alter table public.exam_desk_seating enable row level security;

grant all on public.exam_desk_rooms to service_role;
grant all on public.exam_desk_seating to service_role;
