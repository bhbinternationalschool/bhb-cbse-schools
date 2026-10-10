-- Asking a family where their child actually waits for the bus.
--
-- WHY THIS EXISTS
-- On 2026-09-12 not one riding child had a boarding pin: sis_student_transport_point
-- was empty, no rider household had a Google geocode, 88 of 117 were located
-- only by a census village centroid and 29 by nothing at all. A centroid is
-- the right village and the wrong corner — good enough to choose a route,
-- useless for telling a driver where to stop, and the reason the AI boarding
-- suggestion has to refuse to choose between two stops 400 m apart.
--
-- The family knows exactly where their child stands. This records the state
-- of asking them over WhatsApp.
--
-- WHY THE ASK IS RECORDED AT ALL
-- A location message from a parent is ambiguous — the transport bot already
-- invites one when reporting a problem ("share location + brief issue"). So a
-- pin is only taken as a boarding point when we actually asked that household
-- for one. Without this row, an inbound location keeps its old meaning.
--
-- DECLINED IS A REAL ANSWER AND IS KEPT
-- The request says in plain Hindi that transport continues unchanged if the
-- family would rather not send it. A family that says no must not be asked
-- again next term by someone running the same job, so their refusal is
-- recorded as deliberately as their consent.

create table if not exists public.sis_transport_pin_request (
  household_id text primary key
    references public.sis_households(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  /**
   * asked     — the request went out, nothing back yet.
   * pinned    — a location arrived and was written to the household's riders.
   * declined  — the family said no. Do not ask again.
   * failed    — the send itself did not reach them (no number, Meta refused).
   *
   * "failed" is separate from "asked" on purpose: a family we never actually
   * reached has not ignored us, and lumping the two together would report a
   * response rate that flatters the send.
   */
  status text not null default 'asked'
    check (status in ('asked', 'pinned', 'declined', 'failed')),

  asked_at timestamptz not null default now(),
  responded_at timestamptz,
  /** How many times this household has been asked. */
  ask_count int not null default 1,
  /** Staff who sent the most recent request. */
  asked_by text not null default '',
  /** Why a send failed, or what the family said when declining. */
  note text not null default '',
  updated_at timestamptz not null default now()
);

comment on table public.sis_transport_pin_request is
  'Per-household state of the WhatsApp "share your boarding point" request. An inbound location counts as a boarding pin only for a household with an open request here.';

create index if not exists sis_transport_pin_request_status_idx
  on public.sis_transport_pin_request (tenant_id, status);

/* ─── RLS + grants ─────────────────────────────────────────── */
-- Every new table needs the service_role grant spelled out, or the server's
-- writes fail with a bare 42501 that reads like a bug in the caller.

alter table public.sis_transport_pin_request enable row level security;

drop policy if exists sis_transport_pin_request_tenant_read on public.sis_transport_pin_request;
create policy sis_transport_pin_request_tenant_read
  on public.sis_transport_pin_request
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

grant select on public.sis_transport_pin_request to authenticated;
grant select, insert, update, delete on public.sis_transport_pin_request to service_role;

notify pgrst, 'reload schema';
