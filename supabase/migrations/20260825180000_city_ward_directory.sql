-- Admissions → Village market: the official city locality directory.
--
-- WHY: city leads write mohalla names — Sigra, Khojwa, Lanka — which match no
-- census settlement, so they sit in the unplaced pile with no useful
-- suggestion. The 2022 Nagar Nigam delimitation (UP Govt notification
-- 3474/9-1-2022-55Pari/22) lists every ward's mohallas; loaded here, it lets
-- the review queue say "this is a Varanasi City locality (Ward 24, Sigra)"
-- instead of shrugging.
--
-- WHAT IT DOES NOT DO: map mohallas to the 90 CENSUS-2011 wards that carry
-- the child-pool figures. The 2022 map has no official crosswalk to the 2011
-- map, so a confirmed city locality lands on ONE holding settlement —
-- "Varanasi City (area pending)", population zero, never sized — which puts
-- the lead in the Varanasi City block without inventing a ward-level
-- denominator. See erp-unknown-must-not-become-fact.

/* ─── 1. The directory ─────────────────────────────────────── */

create table if not exists public.city_ward_directory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ward_no integer not null check (ward_no between 1 and 200),
  ward_name text not null,
  ward_name_hi text not null default '',
  -- One row per locality/mohalla named in the gazette for this ward.
  locality text not null,
  locality_key text generated always as (lower(btrim(locality))) stored,
  source_note text not null default 'UP Govt notification 3474/9-1-2022-55Pari/22 (nnvns.org.in)',
  created_at timestamptz not null default now()
);

create unique index if not exists city_ward_directory_uidx
  on public.city_ward_directory (tenant_id, ward_no, locality_key);

-- KNN over ~600 rows is cheap, but the operator still needs the index class.
create index if not exists city_ward_directory_trgm_idx
  on public.city_ward_directory using gist (locality gist_trgm_ops);

alter table public.city_ward_directory enable row level security;

drop policy if exists city_ward_directory_tenant_read on public.city_ward_directory;
create policy city_ward_directory_tenant_read
  on public.city_ward_directory
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

-- Explicit grants: a new table without them fails writes with a silent 42501.
grant select on public.city_ward_directory to authenticated;
grant select, insert, update, delete on public.city_ward_directory to service_role;

/* ─── 2. The holding settlement city aliases point at ──────── */

-- Population zero on purpose: the row exists so a confirmed city locality has
-- a settlement id to land on. Zero population means zero projected pool, so
-- it can never fake a penetration figure — the card reads "not sized".
insert into public.village_demographics (
  tenant_id, census_code, village_name, block_name, district_name, state_name,
  settlement_type,
  pop_total_2011, pop_male_2011, pop_female_2011,
  child_0_6_total_2011, child_0_6_male_2011, child_0_6_female_2011,
  households_2011, literacy_total_2011,
  growth_multiplier, child_ratio,
  source_note
)
select
  t.id, 'VNN-PENDING', 'Varanasi City (area pending)', 'Varanasi City',
  'Varanasi', 'Uttar Pradesh', 'ward',
  0, 0, 0, 0, 0, 0, 0, 0,
  1.15, 0.14,
  'Holding row: leads whose locality is a Varanasi City mohalla whose exact census ward is not identified. Deliberately unsized.'
from public.tenants t
where not exists (
  select 1 from public.village_demographics v
  where v.tenant_id = t.id and v.census_code = 'VNN-PENDING'
);

/* ─── 3. Best directory match per locality ─────────────────── */

create or replace function public.city_ward_directory_match(
  p_tenant_id uuid,
  p_localities text[],
  p_similarity_threshold float default 0.45
)
returns table (
  locality text,
  ward_no integer,
  ward_name text,
  matched_locality text,
  score real,
  exact_match boolean,
  -- How many distinct wards share the matched locality name. "Teliyana" is
  -- in four wards; naming one of them would be a guess, and the caller must
  -- be able to see that.
  ambiguous_wards integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with input as (
    select distinct btrim(x) as loc
    from unnest(coalesce(p_localities, array[]::text[])) as x
    where btrim(x) <> ''
  )
  select
    i.loc,
    m.ward_no,
    m.ward_name,
    m.locality,
    m.score,
    m.exact_match,
    (
      select count(distinct d2.ward_no)::integer
      from public.city_ward_directory d2
      where d2.tenant_id = p_tenant_id
        and d2.locality_key = lower(btrim(m.locality))
    ) as ambiguous_wards
  from input i
  cross join lateral (
    select
      d.ward_no,
      d.ward_name,
      d.locality,
      similarity(d.locality, i.loc)::real as score,
      (d.locality_key = lower(i.loc)) as exact_match
    from public.city_ward_directory d
    where d.tenant_id = p_tenant_id
    order by (d.locality_key = lower(i.loc)) desc, d.locality <-> i.loc
    limit 1
  ) m
  where m.exact_match
     or m.score >= coalesce(p_similarity_threshold, 0.45);
$$;

comment on function public.city_ward_directory_match(uuid, text[], float) is
  'Best 2022-delimitation locality match per input spelling: exact key first, then nearest trigram neighbour above the threshold. ambiguous_wards > 1 means the name exists in several wards and no single ward may be claimed.';

revoke all on function public.city_ward_directory_match(uuid, text[], float) from public;
grant execute on function public.city_ward_directory_match(uuid, text[], float) to service_role;

/* ─── 4. Block rollup: resolve leads the same way cards do ─── */

-- The rollup previously matched localities against settlement names inline,
-- ignoring village_name_aliases — so a spelling the office had already fixed
-- counted on the village card but not in its block row. Rebuilding it on
-- village_resolve_owner makes one resolver own every number again, and makes
-- confirmed city localities count in the Varanasi City block.
create or replace function public.village_block_market(
  p_tenant_id uuid,
  p_academic_year_code text default null,
  p_settlement_type text default 'all',
  p_similarity_threshold float default 0.45
)
returns table (
  block_name text,
  settlements bigint,
  villages bigint,
  towns bigint,
  wards bigint,
  pop_2011 bigint,
  projected_pop bigint,
  projected_child_pop bigint,
  leads bigint,
  enrolled bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with scoped as (
    select d.id, d.block_name, d.settlement_type,
           d.pop_total_2011, d.estimated_current_total_pop, d.estimated_current_child_pop
    from public.village_demographics d
    where d.tenant_id = p_tenant_id
      and btrim(d.block_name) <> ''
      and (
        coalesce(p_settlement_type, 'all') = 'all'
        or d.settlement_type = p_settlement_type
      )
  ),
  leads as materialized (
    select
      l.stage,
      btrim(coalesce(nullif(l.lead_json ->> 'locality', ''), h.locality, '')) as village
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
  -- MATERIALIZED is load-bearing: resolve each distinct spelling once, not
  -- once per lead (PG12+ inlines single-use CTEs).
  owner as materialized (
    select
      d.village,
      d.n,
      d.enrolled_n,
      public.village_resolve_owner(p_tenant_id, d.village, p_similarity_threshold) as owner_id
    from (
      select village, count(*) as n,
             count(*) filter (where stage = 'enrolled') as enrolled_n
      from leads where village <> '' group by village
    ) d
  ),
  block_leads as (
    select s.block_name, sum(o.n) as leads, sum(o.enrolled_n) as enrolled
    from owner o
    join scoped s on s.id = o.owner_id
    group by s.block_name
  ),
  rollup as (
    select
      s.block_name,
      count(*)::bigint as settlements,
      count(*) filter (where s.settlement_type = 'village')::bigint as villages,
      count(*) filter (where s.settlement_type = 'town')::bigint as towns,
      count(*) filter (where s.settlement_type = 'ward')::bigint as wards,
      sum(s.pop_total_2011)::bigint as pop_2011,
      sum(s.estimated_current_total_pop)::bigint as projected_pop,
      sum(s.estimated_current_child_pop)::bigint as projected_child_pop
    from scoped s
    group by s.block_name
  )
  select
    r.block_name, r.settlements, r.villages, r.towns, r.wards,
    r.pop_2011, r.projected_pop, r.projected_child_pop,
    coalesce(b.leads, 0)::bigint as leads,
    coalesce(b.enrolled, 0)::bigint as enrolled
  from rollup r
  left join block_leads b on b.block_name = r.block_name
  order by r.block_name;
$$;

comment on function public.village_block_market(uuid, text, text, float) is
  'One row per block — rural CD block or urban body: settlements, projected population and 0-6 pool, and the leads/enrolments registered there. Leads resolve through village_resolve_owner, the same resolver the per-settlement cards use, so aliases count here too.';

revoke all on function public.village_block_market(uuid, text, text, float) from public;
grant execute on function public.village_block_market(uuid, text, text, float) to service_role;

notify pgrst, 'reload schema';
