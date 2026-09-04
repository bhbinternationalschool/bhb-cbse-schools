-- A parent asking for school transport, from the app.
--
-- Server-truth from the start — no desk slice, no localStorage — because
-- the people who act on it (owner, admin, principal, transport in-charge)
-- read it from both the web desk and the staff app, and a request that
-- lived in one browser's cache would be invisible to the other.
--
-- status: open (new) → contacted (office spoke to the family) → assigned
-- (rider created on the transport desk) or declined. The transport
-- assignment itself stays where it lives (transport desk); this row is the
-- conversation that leads to it.

create table if not exists public.transport_requests (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id text not null,
  student_id text not null,
  student_name text not null default '',
  class_label text not null default '',
  contact_name text not null default '',
  contact_mobile text not null default '',
  pickup_address text not null default '',
  locality text not null default '',
  landmark text not null default '',
  preferred_stop text not null default '',
  note text not null default '',
  status text not null default 'open'
    check (status in ('open', 'contacted', 'assigned', 'declined')),
  handling_note text not null default '',
  handled_by text not null default '',
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transport_requests_status_idx
  on public.transport_requests (tenant_id, status, created_at desc);
create index if not exists transport_requests_household_idx
  on public.transport_requests (tenant_id, household_id, created_at desc);

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the request "succeeds" while storing nothing.
grant all on public.transport_requests to service_role;

notify pgrst, 'reload schema';
