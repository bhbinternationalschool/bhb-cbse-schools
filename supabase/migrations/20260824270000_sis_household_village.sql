-- SIS → which census village each household lives in.
--
-- WHY A COMPANION TABLE, NOT sis_households.locality
-- sis_households.locality already exists and is empty on all 198 rows. It
-- cannot be backfilled server-side: householdToRow() in sisNormalized.server.ts
-- writes `locality: h.locality` on every client push, so the next roster sync
-- from a browser that has never heard of the backfill would wipe it. The
-- derived village therefore lives in its own server-owned table, the same
-- shape as admission_lead_market_state and village_travel.
--
-- WHY NOT DERIVE IT FROM ADMISSION LEADS
-- That was the obvious route and the data says no. admission_desk_households
-- .sis_household_id is populated on 0 of 1,000 rows, and matching on mobile
-- reaches 8 of 198 households — 4%. The 919 leads are field-survey prospects;
-- the 198 enrolled households arrived by another path years earlier. The two
-- populations barely intersect.
--
-- WHAT DOES WORK: the household's own address text. 159 of 198 (80%) contain
-- a census village name, and the implied block spread is plausible — 126 in
-- Harhua, the school's own block, then Pindra and Kashi Vidya Peeth.
--
-- village_id is NULLABLE and deliberately so. Village names repeat across
-- blocks (Chandapur exists in three), so an address naming one is ambiguous.
-- Those rows keep the matched NAME and leave the id null rather than picking
-- a block and presenting the guess as a location.

create table if not exists public.sis_household_village (
  household_id text primary key
    references public.sis_households(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Null when the name was found but more than one village bears it.
  village_id uuid references public.village_demographics(id) on delete set null,
  /** The name as matched, kept even when the id is ambiguous. */
  village_name text not null default '',
  block_name text not null default '',

  match_source text not null default 'address_scan'
    check (match_source in ('address_scan', 'lead_link', 'manual')),
  /** 'exact' one village bears the name; 'ambiguous' several do. */
  match_confidence text not null default 'exact'
    check (match_confidence in ('exact', 'ambiguous')),
  /** The substring that matched, so a bad match can be traced and fixed. */
  matched_on text not null default '',

  matched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sis_household_village_village_idx
  on public.sis_household_village (tenant_id, village_id);

create index if not exists sis_household_village_confidence_idx
  on public.sis_household_village (tenant_id, match_confidence);

comment on table public.sis_household_village is
  'Derived link from an enrolled household to its census village, scanned from the household address. Server-owned: sis_households.locality is overwritten by every client roster push and cannot hold this.';

/* ─── Village demand from enrolled students ────────────────── */

-- What transport actually needs: how many enrolled students live in each
-- village, beside the road distance and drive time already resolved. This is
-- the input for deciding where a bus route should go and what a stop is worth.
create or replace function public.village_student_demand(
  p_tenant_id uuid,
  p_academic_year_code text default null
)
returns table (
  village_id uuid,
  village_name text,
  block_name text,
  households bigint,
  students bigint,
  distance_km numeric,
  duration_minutes integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    v.id,
    v.village_name,
    v.block_name,
    count(distinct hv.household_id)::bigint,
    count(s.id)::bigint,
    t.distance_km,
    t.duration_minutes
  from public.sis_household_village hv
  join public.village_demographics v on v.id = hv.village_id
  left join public.sis_students s
    on s.tenant_id = hv.tenant_id
   and s.household_id = hv.household_id
   and (
     p_academic_year_code is null
     or btrim(p_academic_year_code) = ''
     or s.academic_year_code = p_academic_year_code
   )
  left join public.village_travel t on t.village_id = v.id
  where hv.tenant_id = p_tenant_id
  group by v.id, v.village_name, v.block_name, t.distance_km, t.duration_minutes
  order by count(s.id) desc, v.village_name;
$$;

comment on function public.village_student_demand(uuid, text) is
  'Enrolled households and students per census village, with the road distance and drive time to campus. The demand side of route planning; ambiguous village matches are excluded because their village_id is null.';

/* ─── RLS + grants ─────────────────────────────────────────── */

alter table public.sis_household_village enable row level security;

drop policy if exists sis_household_village_tenant_read on public.sis_household_village;
create policy sis_household_village_tenant_read
  on public.sis_household_village
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

grant select on public.sis_household_village to authenticated;
grant select, insert, update, delete on public.sis_household_village to service_role;

revoke all on function public.village_student_demand(uuid, text) from public;
grant execute on function public.village_student_demand(uuid, text) to service_role;

notify pgrst, 'reload schema';
