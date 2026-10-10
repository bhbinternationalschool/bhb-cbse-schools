-- Admissions → Village market: separate villages from census towns, and roll
-- the market up per block.
--
-- WHY settlement_type: the first seed loaded rural villages only. Varanasi's
-- 34 census towns (Lohta, Phulwaria, Shivdaspur …) carry 3,13,450 people and
-- 44,634 children aged 0-6 — a market the size of two whole CD blocks, and
-- peri-urban, so well inside the school's reach. They belong in the table,
-- but the office must be able to tell them apart from villages when planning
-- a camp or a bus route, hence a column rather than one undifferentiated pile.
--
-- WHY village_block_market: the dashboard was rendering every village as a
-- card. With towns loaded that is ~1,292 cards. The office thinks block first
-- ("where do we go this week"), so the block rollup is the entry point and
-- the village cards are the drill-down.

alter table public.village_demographics
  add column if not exists settlement_type text not null default 'village';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'village_demographics_settlement_type_chk'
  ) then
    alter table public.village_demographics
      add constraint village_demographics_settlement_type_chk
      check (settlement_type in ('village', 'town'));
  end if;
end
$$;

create index if not exists village_demographics_settlement_idx
  on public.village_demographics (tenant_id, settlement_type, block_name);

/* ─── Seeder upsert: carry settlement_type ─────────────────── */

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
      case when lower(btrim(coalesce(r.settlement_type, 'village'))) = 'town'
           then 'town' else 'village' end as settlement_type,
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

notify pgrst, 'reload schema';
