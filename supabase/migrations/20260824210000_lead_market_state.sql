-- Admissions → lead marketing state and village travel times.
--
-- WHY A COMPANION TABLE RATHER THAN COLUMNS ON admission_desk_leads
-- The desk sync pushes whole lead rows from the browser and upserts them.
-- Server-computed columns living on that table would be overwritten by the
-- next sync with whatever the client happened to hold — silently, and only
-- for the leads that desk touched. Keeping the computed state in its own
-- server-owned table makes that impossible rather than merely unlikely.
--
-- WHY NOT A NEW parent_leads TABLE
-- admission_desk_leads already holds 919 real leads wired to households, the
-- CRM, WhatsApp and every figure on the village dashboard. A second lead
-- store would have to be reconciled with the first forever, which is the
-- fork that caused the desk data-loss incidents this schema is still
-- recovering from. One source of truth, extended.

/* ─── Lead temperature ─────────────────────────────────────── */

-- Temperature is a DIFFERENT AXIS from pipeline stage. stage says where the
-- family is in the process (enquiry → applied → verified → enrolled/lost);
-- lead_status says how warm they are right now. A verified lead can be cold
-- and an enquiry can be hot, so neither column can be derived from the other.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_temperature') then
    create type public.lead_temperature as enum ('cold', 'warm', 'hot', 'enrolled');
  end if;
end
$$;

create table if not exists public.admission_lead_market_state (
  lead_id text primary key
    references public.admission_desk_leads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Resolved, never hand-entered: the same village_resolve_owner() every
  -- other figure uses, so a card and a lead cannot disagree about which
  -- village a family lives in.
  village_id uuid references public.village_demographics(id) on delete set null,

  distance_from_campus_km numeric(7,2),
  travel_minutes integer,

  lead_score integer not null default 0 check (lead_score between 0 and 100),
  lead_status public.lead_temperature not null default 'cold',

  -- The inputs the score was computed from, kept so a number on screen can be
  -- explained months later without re-deriving it.
  touchpoints integer not null default 0,
  child_age_years numeric(4,1),
  score_breakdown jsonb not null default '[]'::jsonb,

  scored_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admission_lead_market_state_score_idx
  on public.admission_lead_market_state (tenant_id, lead_status, lead_score desc);

create index if not exists admission_lead_market_state_village_idx
  on public.admission_lead_market_state (tenant_id, village_id);

/* ─── Village travel times ─────────────────────────────────── */

-- Cached because both halves cost money. Census PCA carries no coordinates,
-- so a village must be geocoded before Distance Matrix can be asked anything
-- about it — that is two paid calls per village, for 1,292 villages. Resolved
-- on demand per block and kept forever after; villages do not move.
create table if not exists public.village_travel (
  village_id uuid primary key
    references public.village_demographics(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Where the geocoder put it. Stored separately from
  -- village_demographics.latitude, which holds an OpenStreetMap match when we
  -- have one — mixing a geocoder guess into that column would launder an
  -- estimate into the census record.
  latitude double precision,
  longitude double precision,
  geocode_confidence text not null default '',
  formatted_address text not null default '',

  distance_km numeric(7,2),
  duration_minutes integer,

  -- 'google' when Distance Matrix answered, 'haversine' when it did not and
  -- we fell back to a straight line. The dashboard must be able to say which,
  -- because a straight line around Varanasi understates real travel badly.
  source text not null default ''
    check (source in ('', 'google', 'haversine', 'unresolved')),

  note text not null default '',
  computed_at timestamptz not null default now()
);

create index if not exists village_travel_duration_idx
  on public.village_travel (tenant_id, duration_minutes);

/* ─── Everything one scoring pass needs, in one round trip ─── */

create or replace function public.admission_leads_for_scoring(
  p_tenant_id uuid,
  p_academic_year_code text default null,
  p_similarity_threshold float default 0.45
)
returns table (
  lead_id text,
  stage text,
  dob text,
  locality text,
  village_id uuid,
  touchpoints integer,
  last_outcome text,
  distance_km numeric,
  travel_minutes integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with leads as materialized (
    select
      l.id,
      l.stage,
      coalesce(l.lead_json ->> 'dob', '') as dob,
      btrim(coalesce(nullif(l.lead_json ->> 'locality', ''), h.locality, '')) as locality,
      -- followUps is an array on the lead blob; a lead that has never been
      -- contacted has no key at all, which must read as 0 and not as null.
      coalesce(jsonb_array_length(
        case when jsonb_typeof(l.lead_json -> 'followUps') = 'array'
             then l.lead_json -> 'followUps' else '[]'::jsonb end
      ), 0) as touchpoints,
      coalesce(
        (l.lead_json -> 'followUps' -> -1) ->> 'outcome',
        ''
      ) as last_outcome
    from public.admission_desk_leads l
    left join public.admission_desk_households h
      on h.tenant_id = l.tenant_id and h.id = l.household_id
    where l.tenant_id = p_tenant_id
      and (
        p_academic_year_code is null
        or btrim(p_academic_year_code) = ''
        or l.academic_year_code = p_academic_year_code
      )
  ),
  -- Resolve each distinct spelling once, not once per lead.
  owner as materialized (
    select
      d.locality,
      public.village_resolve_owner(p_tenant_id, d.locality, p_similarity_threshold) as village_id
    from (select distinct locality from leads where locality <> '') d
  )
  select
    l.id,
    l.stage,
    l.dob,
    l.locality,
    o.village_id,
    l.touchpoints,
    l.last_outcome,
    t.distance_km,
    t.duration_minutes
  from leads l
  left join owner o on o.locality = l.locality
  left join public.village_travel t on t.village_id = o.village_id;
$$;

comment on function public.admission_leads_for_scoring(uuid, text, float) is
  'Everything the lead scorer needs in one call: stage, DOB, resolved village, touchpoint count, last disposition and cached travel distance. Scoring itself lives in TypeScript so it is unit-testable and readable by the office.';

/* ─── RLS + grants ─────────────────────────────────────────── */

alter table public.admission_lead_market_state enable row level security;
alter table public.village_travel enable row level security;

drop policy if exists admission_lead_market_state_tenant_read on public.admission_lead_market_state;
create policy admission_lead_market_state_tenant_read
  on public.admission_lead_market_state
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists village_travel_tenant_read on public.village_travel;
create policy village_travel_tenant_read
  on public.village_travel
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

grant select on public.admission_lead_market_state to authenticated;
grant select on public.village_travel to authenticated;
grant select, insert, update, delete on public.admission_lead_market_state to service_role;
grant select, insert, update, delete on public.village_travel to service_role;

revoke all on function public.admission_leads_for_scoring(uuid, text, float) from public;
grant execute on function public.admission_leads_for_scoring(uuid, text, float) to service_role;

notify pgrst, 'reload schema';
