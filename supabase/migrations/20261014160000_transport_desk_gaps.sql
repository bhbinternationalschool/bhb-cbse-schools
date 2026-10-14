-- Transport gaps: what the fleet audit found that the office still has to settle.
--
-- WHY THIS EXISTS
-- On 14 Oct 2026 five weeks of Fleet Edge telemetry were checked against every
-- route, stop and rider. Most findings are not something the ERP can fix by
-- itself: a stop the bus never reaches needs someone to ask the driver where
-- those children really board, and a child billed for 11.2 km who lives 2.7 km
-- away is a fee decision. The director's rule (14 Oct): change the records
-- where it is safe, but do not change any student's transport fee — show the
-- gap in the ERP instead.
--
-- So each finding is a row here, with the billed and measured distances and
-- fees side by side. Settling a row records who decided and what; it does not
-- change a fee, an assignment or a stop. Those stay edits on the Transport
-- screen, made on purpose.
--
-- Rows are server-written (the audit, and the settle action). Browsers never
-- push this table, so a stale tab cannot reopen or erase a decision.

create table if not exists public.transport_desk_gaps (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  /**
   * fee_distance      — billed distance disagrees with where the child lives or boards.
   * stop_not_reached  — the serving vehicle never (or rarely) comes near the stop.
   * rider_stop        — the child's stop is wrong though the bus passes their home.
   * rider_bus         — the child may be on the wrong vehicle.
   * fleet_record      — a vehicle record or tracker is missing something.
   * driving           — speed, panic button, idling, unexplained trips.
   * decision          — a cost choice that is the director's to make.
   */
  kind text not null
    check (kind in ('fee_distance','stop_not_reached','rider_stop','rider_bus','fleet_record','driving','decision')),

  vehicle text not null default '',
  route_id text not null default '',
  stop_id text not null default '',
  student_id text not null default '',

  title text not null,
  detail text not null default '',

  billed_km numeric,
  straight_km numeric,
  road_km numeric,
  billed_fee_paise integer,
  policy_fee_paise integer,
  policy_fee_note text not null default '',

  /** Where the finding came from, e.g. "fleet-audit-2026-10-14". */
  source text not null default '',
  found_at timestamptz not null default now(),

  status text not null default 'open' check (status in ('open','settled','dismissed')),
  settled_at timestamptz,
  settled_by text not null default '',
  settle_note text not null default '',
  updated_at timestamptz not null default now()
);

comment on table public.transport_desk_gaps is
  'Fleet-audit findings the transport office still has to settle. Read-only evidence: settling a row never changes a fee, stop or assignment.';

create index if not exists transport_desk_gaps_open_idx
  on public.transport_desk_gaps (tenant_id, status, kind);

alter table public.transport_desk_gaps enable row level security;

drop policy if exists transport_desk_gaps_tenant_read on public.transport_desk_gaps;
create policy transport_desk_gaps_tenant_read
  on public.transport_desk_gaps
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

grant select on public.transport_desk_gaps to authenticated;
grant select, insert, update, delete on public.transport_desk_gaps to service_role;

notify pgrst, 'reload schema';
