-- Events & academic calendar (Phase 6) — school-authored events with
-- WhatsApp button-reply RSVP. Server-authoritative (not local-first
-- desk-sync): the WA webhook that records an RSVP has no access to a
-- browser's localStorage, so the RSVP write must land in Supabase directly
-- regardless, and the event row it references may as well live there too.

create table if not exists public.school_events (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  title text not null,
  description text not null default '',
  kind text not null default 'other',
  starts_on date not null,
  ends_on date not null,
  start_time text not null default '',
  location text not null default '',
  class_ids jsonb not null default '[]'::jsonb,
  rsvp_enabled boolean not null default false,
  is_active boolean not null default true,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.school_events enable row level security;

create policy school_events_tenant_all
  on public.school_events
  for all
  using (is_tenant_member(tenant_id));

create index if not exists school_events_tenant_range_idx
  on public.school_events (tenant_id, academic_year_code, starts_on, ends_on);

create table if not exists public.event_rsvps (
  id text primary key, -- `${eventId}|${householdId}`
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id text not null references public.school_events(id) on delete cascade,
  household_id text not null,
  choice text, -- yes | no | maybe | null (not yet responded)
  responded_at timestamptz,
  reminded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (event_id, household_id)
);

alter table public.event_rsvps enable row level security;

create policy event_rsvps_tenant_all
  on public.event_rsvps
  for all
  using (is_tenant_member(tenant_id));

create index if not exists event_rsvps_event_idx
  on public.event_rsvps (tenant_id, event_id);

grant select, insert, update, delete on public.school_events to service_role;
grant select, insert, update, delete on public.event_rsvps to service_role;

notify pgrst, 'reload schema';
