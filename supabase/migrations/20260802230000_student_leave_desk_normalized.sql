-- Student leave (§19c) — jsonb blob + normalized desk SoR

create table if not exists public.student_leave_state (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.student_leave_state enable row level security;

drop policy if exists "student_leave_state_tenant_all" on public.student_leave_state;
create policy "student_leave_state_tenant_all"
  on public.student_leave_state for all
  using (
    tenant_id in (
      select tenant_id from public.profiles where id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.profiles where id = auth.uid()
    )
  );

grant select, insert, update, delete on public.student_leave_state to authenticated;
grant all on public.student_leave_state to service_role;

create table if not exists public.student_leave_desk_requests (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  student_id text not null,
  from_date date not null,
  to_date date not null,
  leave_type text not null
    check (leave_type in ('SL', 'HD_AM', 'HD_PM', 'ML', 'OD', 'LL')),
  reason text not null default '',
  attachment_url text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by text not null default '',
  household_id text not null default '',
  created_at timestamptz not null default now(),
  decided_by text not null default '',
  decided_at timestamptz,
  decision_note text not null default '',
  attendance_applied boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.student_leave_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  request_count int not null default 0,
  pending_count int not null default 0,
  approved_count int not null default 0,
  last_request_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists student_leave_desk_requests_student_idx
  on public.student_leave_desk_requests (tenant_id, student_id, from_date desc);

create index if not exists student_leave_desk_requests_status_idx
  on public.student_leave_desk_requests (tenant_id, status, from_date desc);

comment on table public.student_leave_desk_requests is
  'Student leave requests — system of record (text ids match desk localStorage)';
comment on table public.student_leave_state is
  'Legacy jsonb blob for student leave during desk cutover';
