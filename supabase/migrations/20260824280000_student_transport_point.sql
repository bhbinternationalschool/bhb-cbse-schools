-- SIS ↔ Transport → the exact boarding point for one student.
--
-- WHAT THIS SOLVES
-- A census village centroid places a family in the right village, not at the
-- right corner. For choosing which route serves a village that is enough; for
-- telling a driver where to stop it is not. This records the point somebody
-- actually dropped a pin on, per student, so the next time that child's
-- transport is arranged the boarding place is already known.
--
-- WHY A SEPARATE TABLE AGAIN
-- sis_students is pushed wholesale from the browser by the roster sync, so a
-- server-written column on it survives only until the next push. Same reason
-- sis_household_village exists rather than sis_households.locality.
--
-- The pin is per STUDENT, not per household, because siblings are not always
-- put on the same bus — an older child may board on the main road while the
-- younger is collected closer to home.

create table if not exists public.sis_student_transport_point (
  student_id text primary key
    references public.sis_students(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  /** The village the pin was dropped in, when one was chosen. */
  village_id uuid references public.village_demographics(id) on delete set null,

  latitude double precision not null,
  longitude double precision not null,

  /**
   * What the family calls this spot.
   *
   * Rural boarding points are usually landmarks with no formal name — "the
   * neem tree", "Yadav ki dukan ke saamne". Free text on purpose: forcing a
   * pick from existing stop names would either lose the description or
   * invent a stop that does not exist.
   */
  point_name text not null default '',
  note text not null default '',

  /** Set when the pin was copied from an existing route stop. */
  stop_id text not null default '',

  set_by text not null default '',
  set_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sis_student_transport_point_village_idx
  on public.sis_student_transport_point (tenant_id, village_id);

comment on table public.sis_student_transport_point is
  'Per-student boarding point, pinned on a map. Server-owned: sis_students is overwritten by every client roster push.';

/* ─── Manual village override ──────────────────────────────── */

-- The address scan links 143 of 198 households and leaves 55 unmatched plus 9
-- ambiguous. Those need a person to choose from a list, and their choice must
-- outrank any future re-run of the scanner — hence match_source 'manual',
-- which the backfill script already refuses to overwrite.
create or replace function public.set_household_village(
  p_tenant_id uuid,
  p_household_id text,
  p_village_id uuid,
  p_actor text default ''
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_block text;
begin
  if p_village_id is null then
    delete from public.sis_household_village
     where tenant_id = p_tenant_id and household_id = p_household_id;
    return;
  end if;

  select village_name, block_name into v_name, v_block
    from public.village_demographics
   where id = p_village_id and tenant_id = p_tenant_id;

  if v_name is null then
    raise exception 'Village % is not on file for this school', p_village_id;
  end if;

  insert into public.sis_household_village as h (
    household_id, tenant_id, village_id, village_name, block_name,
    match_source, match_confidence, matched_on, updated_at
  )
  values (
    p_household_id, p_tenant_id, p_village_id, v_name, v_block,
    'manual', 'exact', coalesce(nullif(p_actor, ''), 'office'), now()
  )
  on conflict (household_id) do update
    set village_id = excluded.village_id,
        village_name = excluded.village_name,
        block_name = excluded.block_name,
        match_source = 'manual',
        match_confidence = 'exact',
        matched_on = excluded.matched_on,
        updated_at = now();
end
$$;

comment on function public.set_household_village(uuid, text, uuid, text) is
  'Record a human-chosen village for a household. Marks the row manual so a later re-run of the address scanner leaves it alone.';

/* ─── Directory for the dropdowns ──────────────────────────── */

-- One call feeds both the SIS village picker and the transport screen:
-- every block with its villages, names and centroids. ~1,292 rows, which is
-- one small payload rather than a search-as-you-type round trip per keystroke.
create or replace function public.village_directory(p_tenant_id uuid)
returns table (
  village_id uuid,
  village_name text,
  block_name text,
  settlement_type text,
  latitude double precision,
  longitude double precision,
  distance_km numeric,
  duration_minutes integer,
  students bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    v.id, v.village_name, v.block_name, v.settlement_type,
    v.latitude, v.longitude,
    t.distance_km, t.duration_minutes,
    coalesce(d.students, 0)::bigint
  from public.village_demographics v
  left join public.village_travel t on t.village_id = v.id
  left join (
    select hv.village_id, count(s.id) as students
    from public.sis_household_village hv
    join public.sis_students s
      on s.tenant_id = hv.tenant_id and s.household_id = hv.household_id
    where hv.tenant_id = p_tenant_id and hv.village_id is not null
    group by hv.village_id
  ) d on d.village_id = v.id
  where v.tenant_id = p_tenant_id
  order by v.block_name, v.village_name;
$$;

comment on function public.village_directory(uuid) is
  'Every village with its block, centroid, travel time and enrolled-student count — the payload behind the SIS and transport village pickers.';

/* ─── RLS + grants ─────────────────────────────────────────── */

alter table public.sis_student_transport_point enable row level security;

drop policy if exists sis_student_transport_point_tenant_read on public.sis_student_transport_point;
create policy sis_student_transport_point_tenant_read
  on public.sis_student_transport_point
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

grant select on public.sis_student_transport_point to authenticated;
grant select, insert, update, delete on public.sis_student_transport_point to service_role;

revoke all on function public.set_household_village(uuid, text, uuid, text) from public;
grant execute on function public.set_household_village(uuid, text, uuid, text) to service_role;

revoke all on function public.village_directory(uuid) from public;
grant execute on function public.village_directory(uuid) to service_role;

notify pgrst, 'reload schema';
