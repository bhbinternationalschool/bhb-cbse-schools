-- Admissions → Village market: bring Varanasi city into the same drill-down.
--
-- WHY: the table held only the rural CD blocks (plus their census towns).
-- Varanasi's urban bodies — the M Corp's 90 census wards, Ramnagar's 25,
-- Gangapur's 10, the Cantonment's 7, Maruadih Railway Settlement's 5 — are
-- ~1.28 lakh children aged 0-6 that the market view simply could not see.
-- A ward is seeded as settlement_type = 'ward' with its urban body as its
-- "block" ("Varanasi City", "Ramnagar Town" …), so the city drills down
-- exactly the way a rural block does.
--
-- Source: Census of India 2011, PCA at town/village/ward level (PCA-TV,
-- district 0966). The 90 M Corp wards sum to the town row exactly
-- (1,198,491 people / 135,677 children 0-6) — nothing invented.

/* ─── 1. Allow 'ward' as a settlement type ─────────────────── */

alter table public.village_demographics
  drop constraint if exists village_demographics_settlement_type_chk;

alter table public.village_demographics
  add constraint village_demographics_settlement_type_chk
  check (settlement_type in ('village', 'town', 'ward'));

/* ─── 2. Seeder upsert: stop coercing 'ward' to 'village' ──── */

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
      case
        when lower(btrim(coalesce(r.settlement_type, 'village'))) in ('town', 'ward')
        then lower(btrim(r.settlement_type))
        else 'village'
      end as settlement_type,
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
      census_code text, village_name text, block_name text, district_name text,
      state_name text, settlement_type text,
      pop_total_2011 integer, pop_male_2011 integer, pop_female_2011 integer,
      child_0_6_total_2011 integer, child_0_6_male_2011 integer, child_0_6_female_2011 integer,
      households_2011 integer, literacy_total_2011 integer,
      growth_multiplier numeric, child_ratio numeric,
      latitude double precision, longitude double precision, source_note text
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
        settlement_type = i.settlement_type,
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
      settlement_type, pop_total_2011, pop_male_2011, pop_female_2011,
      child_0_6_total_2011, child_0_6_male_2011, child_0_6_female_2011,
      households_2011, literacy_total_2011,
      growth_multiplier, child_ratio, latitude, longitude, source_note
    )
    select
      p_tenant_id, i.census_code, i.village_name, i.block_name, i.district_name, i.state_name,
      i.settlement_type, i.pop_total_2011, i.pop_male_2011, i.pop_female_2011,
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

revoke all on function public.village_demographics_upsert(uuid, jsonb) from public;
grant execute on function public.village_demographics_upsert(uuid, jsonb) to service_role;

/* ─── 3. Block rollup: count wards, so the UI can label a city ─ */

-- The return signature gains a column, so the old function must go first.
drop function if exists public.village_block_market(uuid, text, text, float);

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
    select d.*
    from public.village_demographics d
    where d.tenant_id = p_tenant_id
      and btrim(d.block_name) <> ''
      and (
        coalesce(p_settlement_type, 'all') = 'all'
        or d.settlement_type = p_settlement_type
      )
  ),
  leads as (
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
  -- Resolve each distinct locality to ONE settlement (the largest match), so
  -- a name that fuzzy-matches several villages is not counted in every block
  -- it resembles.
  lead_block as (
    select
      b.village,
      b.n,
      b.enrolled_n,
      (
        select s.block_name
        from scoped s
        where lower(btrim(s.village_name)) = lower(b.village)
           or similarity(s.village_name, b.village) >= coalesce(p_similarity_threshold, 0.45)
        order by
          (lower(btrim(s.village_name)) = lower(b.village)) desc,
          similarity(s.village_name, b.village) desc,
          s.pop_total_2011 desc
        limit 1
      ) as block_name
    from (
      select village, count(*) as n,
             count(*) filter (where stage = 'enrolled') as enrolled_n
      from leads where village <> '' group by village
    ) b
  )
  select
    s.block_name,
    count(*)::bigint as settlements,
    count(*) filter (where s.settlement_type = 'village')::bigint as villages,
    count(*) filter (where s.settlement_type = 'town')::bigint as towns,
    count(*) filter (where s.settlement_type = 'ward')::bigint as wards,
    sum(s.pop_total_2011)::bigint as pop_2011,
    sum(s.estimated_current_total_pop)::bigint as projected_pop,
    sum(s.estimated_current_child_pop)::bigint as projected_child_pop,
    coalesce((select sum(lb.n) from lead_block lb where lb.block_name = s.block_name), 0)::bigint as leads,
    coalesce((select sum(lb.enrolled_n) from lead_block lb where lb.block_name = s.block_name), 0)::bigint as enrolled
  from scoped s
  group by s.block_name
  order by s.block_name;
$$;

comment on function public.village_block_market(uuid, text, text, float) is
  'One row per block — rural CD block or urban body (M Corp / NPP / NP / CB as ward groups): settlements, projected population and 0-6 pool, and the leads/enrolments actually registered there.';

revoke all on function public.village_block_market(uuid, text, text, float) from public;
grant execute on function public.village_block_market(uuid, text, text, float) to service_role;

notify pgrst, 'reload schema';
