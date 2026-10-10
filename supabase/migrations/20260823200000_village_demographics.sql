-- Admissions → Village market intelligence (Census baseline + current-year projection).
--
-- WHAT THIS IS FOR
-- Field agents capture leads village by village. To decide where the next
-- camp, banner or bus route goes, the office needs the denominator: roughly
-- how many 0-6 children live in that village today. Census 2011 is the only
-- micro-level source that exists, so we store the published 2011 figures
-- verbatim and derive a *projection* from them.
--
-- THE PROJECTION IS AN ESTIMATE, NOT A FACT.
-- estimated_current_* is 2011 population scaled by a compounding factor for
-- rural UP. Every row therefore records the assumptions it was computed from
-- (growth_multiplier, child_ratio, projection_baseline_year,
-- projection_target_year) so a number on screen can always be traced back to
-- the inputs that produced it, and so the office can override the assumption
-- for one village without the code changing. The 2011 columns are never
-- touched by the trigger — the published baseline stays exactly as published.
--
-- Conventions kept from the rest of the schema: tenant_id FK + RLS via
-- is_tenant_member(), explicit service_role grants (a new table without them
-- fails writes with 42501), and a pgrst schema reload at the end.

create extension if not exists pg_trgm;

/* ─── Table ────────────────────────────────────────────────── */

create table if not exists public.village_demographics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Census identity. census_code is the 2011 PCA village code where known;
  -- '' is allowed because hand-entered hamlets have no code.
  census_code text not null default '',
  village_name text not null,
  block_name text not null default '',
  district_name text not null default '',
  state_name text not null default '',

  -- Census 2011 baseline, exactly as published. Trigger-owned columns below
  -- are derived from these; these are never derived from anything.
  pop_total_2011 integer not null default 0 check (pop_total_2011 >= 0),
  pop_male_2011 integer not null default 0 check (pop_male_2011 >= 0),
  pop_female_2011 integer not null default 0 check (pop_female_2011 >= 0),
  child_0_6_total_2011 integer not null default 0 check (child_0_6_total_2011 >= 0),
  child_0_6_male_2011 integer not null default 0 check (child_0_6_male_2011 >= 0),
  child_0_6_female_2011 integer not null default 0 check (child_0_6_female_2011 >= 0),
  households_2011 integer not null default 0 check (households_2011 >= 0),
  literacy_total_2011 integer not null default 0 check (literacy_total_2011 >= 0),

  -- Projection assumptions, per row so every estimate is auditable.
  -- 1.19 ≈ compounded rural-UP growth 2011 → current year.
  growth_multiplier numeric(6,4) not null default 1.19
    check (growth_multiplier > 0 and growth_multiplier <= 5),
  -- 0.14 ≈ share of population in the 0-6 bracket in rural UP.
  child_ratio numeric(6,4) not null default 0.14
    check (child_ratio > 0 and child_ratio <= 1),
  projection_baseline_year integer not null default 2011,
  projection_target_year integer not null
    default extract(year from (now() at time zone 'Asia/Kolkata'))::int,

  -- Trigger-owned. Writing these by hand has no effect: the BEFORE trigger
  -- recomputes them on every insert and update.
  estimated_current_total_pop integer not null default 0,
  estimated_current_child_pop integer not null default 0,

  -- Optional geography, filled by the seeder or by an OSM match, used to
  -- rank villages by distance from the school without a second Overpass hit.
  latitude double precision,
  longitude double precision,
  osm_id bigint,
  osm_place_type text not null default '',

  source_note text not null default 'Census of India 2011 — PCA',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two identities, and only one applies to any given row:
--   · with a census code — the code IS the identity;
--   · without one (hand-entered hamlets) — village + block name is.
--
-- Both indexes are partial, and the second one MUST be. Village names repeat
-- inside a block in the real PCA data: Varanasi district alone has 19 such
-- pairs, including two distinct villages both called Fatehpur in Baragaon
-- block (codes 208457 and 208498, populations 754 and 1,970). A plain
-- name+block unique index rejects the smaller one and silently loses a real
-- village from the market map.
create unique index if not exists village_demographics_census_code_uidx
  on public.village_demographics (tenant_id, census_code)
  where census_code <> '';

create unique index if not exists village_demographics_name_block_uidx
  on public.village_demographics (tenant_id, lower(btrim(village_name)), lower(btrim(block_name)))
  where census_code = '';

create index if not exists village_demographics_block_idx
  on public.village_demographics (tenant_id, block_name);

create index if not exists village_demographics_geo_idx
  on public.village_demographics (tenant_id, latitude, longitude)
  where latitude is not null and longitude is not null;

-- Trigram index for localized spelling anomalies: Ayar / Aayar / Ayer,
-- Chiraigaon / Chiraigawn. Plain equality never matches those.
create index if not exists village_demographics_name_trgm_idx
  on public.village_demographics using gin (village_name gin_trgm_ops);

/* ─── Projection trigger ───────────────────────────────────── */

create or replace function public.village_demographics_project()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- A caller that leaves the assumption columns null gets the defaults
  -- rather than a null estimate; a caller that sets them gets its own.
  new.growth_multiplier := coalesce(new.growth_multiplier, 1.19);
  new.child_ratio := coalesce(new.child_ratio, 0.14);
  new.projection_baseline_year := coalesce(new.projection_baseline_year, 2011);
  new.projection_target_year := coalesce(
    new.projection_target_year,
    extract(year from (now() at time zone 'Asia/Kolkata'))::int
  );

  -- Scale the published 2011 total, then take the 0-6 share of the scaled
  -- total. Both are rounded to whole people — a fractional child reads as
  -- false precision on a dashboard.
  new.estimated_current_total_pop :=
    round(coalesce(new.pop_total_2011, 0)::numeric * new.growth_multiplier)::int;
  new.estimated_current_child_pop :=
    round(new.estimated_current_total_pop::numeric * new.child_ratio)::int;

  new.updated_at := now();
  return new;
end
$$;

comment on function public.village_demographics_project() is
  'Derives estimated_current_total_pop / estimated_current_child_pop from the 2011 baseline and the per-row projection assumptions. BEFORE INSERT OR UPDATE — the derived columns cannot be set by a client.';

drop trigger if exists village_demographics_project_trg on public.village_demographics;
create trigger village_demographics_project_trg
  before insert or update on public.village_demographics
  for each row execute function public.village_demographics_project();

/* ─── Fuzzy name match RPC ─────────────────────────────────── */

-- Overpass gives us "Ayar" where the census PCA says "Ayar (Rural)" or
-- "Aayar". This returns the best matches by trigram similarity, strongest
-- first. similarity() is used explicitly rather than the % operator so the
-- result does not depend on the session's pg_trgm.similarity_threshold.
--
-- p_tenant_id is optional and only matters for service_role callers, which
-- bypass RLS: an authenticated caller is already confined to its own tenant
-- by the SELECT policy below.
create or replace function public.match_village_by_name(
  search_name text,
  similarity_threshold float default 0.35,
  p_tenant_id uuid default null,
  max_results int default 3
)
returns table (
  id uuid,
  tenant_id uuid,
  census_code text,
  village_name text,
  block_name text,
  district_name text,
  pop_total_2011 integer,
  pop_male_2011 integer,
  pop_female_2011 integer,
  child_0_6_total_2011 integer,
  child_0_6_male_2011 integer,
  child_0_6_female_2011 integer,
  households_2011 integer,
  growth_multiplier numeric,
  child_ratio numeric,
  projection_target_year integer,
  estimated_current_total_pop integer,
  estimated_current_child_pop integer,
  latitude double precision,
  longitude double precision,
  match_score real
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    v.id,
    v.tenant_id,
    v.census_code,
    v.village_name,
    v.block_name,
    v.district_name,
    v.pop_total_2011,
    v.pop_male_2011,
    v.pop_female_2011,
    v.child_0_6_total_2011,
    v.child_0_6_male_2011,
    v.child_0_6_female_2011,
    v.households_2011,
    v.growth_multiplier,
    v.child_ratio,
    v.projection_target_year,
    v.estimated_current_total_pop,
    v.estimated_current_child_pop,
    v.latitude,
    v.longitude,
    -- An exact normalized hit scores 1 even if trigram similarity would
    -- dock it for length (e.g. very short names like "Ayar").
    greatest(
      similarity(v.village_name, coalesce(search_name, '')),
      case
        when lower(btrim(v.village_name)) = lower(btrim(coalesce(search_name, '')))
        then 1.0::real
        else 0.0::real
      end
    ) as match_score
  from public.village_demographics v
  where coalesce(btrim(search_name), '') <> ''
    and (p_tenant_id is null or v.tenant_id = p_tenant_id)
    and (
      lower(btrim(v.village_name)) = lower(btrim(search_name))
      or similarity(v.village_name, search_name) >= coalesce(similarity_threshold, 0.35)
    )
  order by match_score desc, v.pop_total_2011 desc
  limit greatest(coalesce(max_results, 3), 1);
$$;

comment on function public.match_village_by_name(text, float, uuid, int) is
  'Closest village_demographics rows for a loosely spelled name, strongest match first. match_score is 1.0 for an exact case/whitespace-insensitive hit, otherwise pg_trgm similarity.';

/* ─── Lead penetration RPC ─────────────────────────────────── */

-- How many real enquiries our field agents have registered per village.
--
-- The lead's village lives in admission_desk_leads.lead_json->>'locality'
-- (leads carry a denormalized copy) and falls back to the household's
-- locality column. Taking a whole batch of village names in one call keeps
-- the API route at one round trip instead of one per village.
create or replace function public.village_lead_counts(
  p_tenant_id uuid,
  p_villages text[],
  p_academic_year_code text default null,
  p_similarity_threshold float default 0.45
)
returns table (
  village_key text,
  lead_count bigint,
  enrolled_count bigint,
  open_count bigint,
  lost_count bigint,
  last_lead_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with wanted as (
    select distinct btrim(w) as village_key
    from unnest(coalesce(p_villages, array[]::text[])) as w
    where btrim(coalesce(w, '')) <> ''
  ),
  leads as (
    select
      l.stage,
      l.created_at,
      btrim(coalesce(
        nullif(l.lead_json ->> 'locality', ''),
        h.locality,
        ''
      )) as lead_village
    from public.admission_desk_leads l
    left join public.admission_desk_households h
      on h.tenant_id = l.tenant_id and h.id = l.household_id
    where l.tenant_id = p_tenant_id
      and (
        p_academic_year_code is null
        or btrim(p_academic_year_code) = ''
        or l.academic_year_code = p_academic_year_code
      )
  )
  select
    w.village_key,
    count(l.*) as lead_count,
    count(*) filter (where l.stage = 'enrolled') as enrolled_count,
    count(*) filter (where l.stage in ('enquiry', 'applied', 'verified')) as open_count,
    count(*) filter (where l.stage = 'lost') as lost_count,
    max(l.created_at) as last_lead_at
  from wanted w
  left join leads l
    on l.lead_village <> ''
   and (
     lower(l.lead_village) = lower(w.village_key)
     or similarity(l.lead_village, w.village_key) >= coalesce(p_similarity_threshold, 0.45)
   )
  group by w.village_key;
$$;

comment on function public.village_lead_counts(uuid, text[], text, float) is
  'Registered admission leads per village name, matched on the leads own locality with a trigram fallback for spelling drift. One call per dashboard render, not one per village.';

/* ─── RLS + grants ─────────────────────────────────────────── */

alter table public.village_demographics enable row level security;

-- Read-only for platform handlers signed in against this tenant. Writes are
-- service_role only: the census baseline is seeded, never edited from a
-- browser session. Those writes work because Supabase creates service_role
-- with BYPASSRLS — there is deliberately no INSERT/UPDATE policy here.
drop policy if exists village_demographics_tenant_read on public.village_demographics;
create policy village_demographics_tenant_read
  on public.village_demographics
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

grant select on public.village_demographics to authenticated;
grant select, insert, update, delete on public.village_demographics to service_role;

revoke all on function public.match_village_by_name(text, float, uuid, int) from public;
grant execute on function public.match_village_by_name(text, float, uuid, int)
  to authenticated, service_role;

-- service_role only, and deliberately not `authenticated`: this function
-- reads admission_desk_leads, which grants nothing to authenticated. Handing
-- a browser session an execute grant it cannot use would turn a permission
-- error into a confusing half-working call. The API route uses the service
-- client, which is the only intended caller.
revoke all on function public.village_lead_counts(uuid, text[], text, float) from public;
grant execute on function public.village_lead_counts(uuid, text[], text, float)
  to service_role;

/* ─── Seeder upsert RPC ────────────────────────────────────── */

-- Why an RPC instead of PostgREST's on_conflict: the two identities of a
-- village are a partial unique index (census_code, only when non-empty) and
-- an expression index (lower(village_name), lower(block_name)). PostgREST's
-- on_conflict takes a bare column list and can use neither, so the seeder
-- would silently insert duplicates. This does the matching explicitly.
--
-- One statement on purpose: data-modifying CTEs all see the same snapshot,
-- so `ins` tests existence against the table as it was BEFORE `upd` ran.
-- Rows `upd` touched already existed, so they are excluded from `ins`
-- without any bookkeeping between the two.
--
-- The derived projection columns are deliberately absent from the payload —
-- the BEFORE trigger owns them, and a seeder that supplied them would be a
-- second source of truth for the same number.
create or replace function public.village_demographics_upsert(
  p_tenant_id uuid,
  p_rows jsonb
)
returns table (inserted_count integer, updated_count integer)
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  with incoming as (
    select
      btrim(coalesce(r.census_code, '')) as census_code,
      btrim(r.village_name) as village_name,
      btrim(coalesce(r.block_name, '')) as block_name,
      btrim(coalesce(r.district_name, '')) as district_name,
      btrim(coalesce(r.state_name, '')) as state_name,
      coalesce(r.pop_total_2011, 0) as pop_total_2011,
      coalesce(r.pop_male_2011, 0) as pop_male_2011,
      coalesce(r.pop_female_2011, 0) as pop_female_2011,
      coalesce(r.child_0_6_total_2011, 0) as child_0_6_total_2011,
      coalesce(r.child_0_6_male_2011, 0) as child_0_6_male_2011,
      coalesce(r.child_0_6_female_2011, 0) as child_0_6_female_2011,
      coalesce(r.households_2011, 0) as households_2011,
      coalesce(r.literacy_total_2011, 0) as literacy_total_2011,
      coalesce(r.growth_multiplier, 1.19) as growth_multiplier,
      coalesce(r.child_ratio, 0.14) as child_ratio,
      r.latitude,
      r.longitude,
      coalesce(nullif(btrim(coalesce(r.source_note, '')), ''), 'Census of India 2011 — PCA') as source_note
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      census_code text,
      village_name text,
      block_name text,
      district_name text,
      state_name text,
      pop_total_2011 integer,
      pop_male_2011 integer,
      pop_female_2011 integer,
      child_0_6_total_2011 integer,
      child_0_6_male_2011 integer,
      child_0_6_female_2011 integer,
      households_2011 integer,
      literacy_total_2011 integer,
      growth_multiplier numeric,
      child_ratio numeric,
      latitude double precision,
      longitude double precision,
      source_note text
    )
    where btrim(coalesce(r.village_name, '')) <> ''
  ),
  upd as (
    update public.village_demographics v
    set census_code = case when i.census_code <> '' then i.census_code else v.census_code end,
        village_name = i.village_name,
        block_name = i.block_name,
        district_name = i.district_name,
        state_name = i.state_name,
        pop_total_2011 = i.pop_total_2011,
        pop_male_2011 = i.pop_male_2011,
        pop_female_2011 = i.pop_female_2011,
        child_0_6_total_2011 = i.child_0_6_total_2011,
        child_0_6_male_2011 = i.child_0_6_male_2011,
        child_0_6_female_2011 = i.child_0_6_female_2011,
        households_2011 = i.households_2011,
        literacy_total_2011 = i.literacy_total_2011,
        growth_multiplier = i.growth_multiplier,
        child_ratio = i.child_ratio,
        latitude = coalesce(i.latitude, v.latitude),
        longitude = coalesce(i.longitude, v.longitude),
        source_note = i.source_note
    from incoming i
    where v.tenant_id = p_tenant_id
      and (
        (i.census_code <> '' and v.census_code = i.census_code)
        or (
          i.census_code = ''
          and lower(btrim(v.village_name)) = lower(i.village_name)
          and lower(btrim(v.block_name)) = lower(i.block_name)
        )
      )
    returning v.id
  ),
  ins as (
    insert into public.village_demographics (
      tenant_id, census_code, village_name, block_name, district_name, state_name,
      pop_total_2011, pop_male_2011, pop_female_2011,
      child_0_6_total_2011, child_0_6_male_2011, child_0_6_female_2011,
      households_2011, literacy_total_2011,
      growth_multiplier, child_ratio, latitude, longitude, source_note
    )
    select
      p_tenant_id, i.census_code, i.village_name, i.block_name, i.district_name, i.state_name,
      i.pop_total_2011, i.pop_male_2011, i.pop_female_2011,
      i.child_0_6_total_2011, i.child_0_6_male_2011, i.child_0_6_female_2011,
      i.households_2011, i.literacy_total_2011,
      i.growth_multiplier, i.child_ratio, i.latitude, i.longitude, i.source_note
    from incoming i
    where not exists (
      select 1 from public.village_demographics v
      where v.tenant_id = p_tenant_id
        and (
          (i.census_code <> '' and v.census_code = i.census_code)
          or (
            i.census_code = ''
            and lower(btrim(v.village_name)) = lower(i.village_name)
            and lower(btrim(v.block_name)) = lower(i.block_name)
          )
        )
    )
    returning id
  )
  select
    (select count(*) from ins)::integer as inserted_count,
    (select count(*) from upd)::integer as updated_count;
$$;

comment on function public.village_demographics_upsert(uuid, jsonb) is
  'Chunked seeder upsert. Matches on census_code when present, otherwise on village+block name. Never writes the derived projection columns — the BEFORE trigger owns those.';

revoke all on function public.village_demographics_upsert(uuid, jsonb) from public;
grant execute on function public.village_demographics_upsert(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
