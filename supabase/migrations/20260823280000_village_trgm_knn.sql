-- Admissions → Village market: index-accelerated fuzzy matching (KNN).
--
-- THE BUG
-- Every matching function filtered with `similarity(a, b) >= threshold`, a
-- plain function call that PostgreSQL cannot answer from the GIN trigram
-- index. Resolving 199 lead spellings against 1,292 settlements therefore ran
-- as a ~257,000-comparison sequential scan: village_block_market took ~9 s
-- direct and died with "canceling statement due to statement timeout" through
-- PostgREST, so the dashboard's block rollup silently came back empty.
--
-- WHY NOT the `%` operator: it is index-backed but takes its cutoff from the
-- pg_trgm.similarity_threshold GUC, and Supabase does not permit setting that
-- parameter in a function's SET clause ("permission denied to set parameter").
--
-- THE FIX: `<->` (trigram distance, = 1 - similarity) with a GiST index is a
-- KNN operator. `order by village_name <-> $1 limit 1` is answered by walking
-- the index to the nearest neighbour — one probe per spelling instead of a
-- full scan — and the threshold is then applied to that single candidate,
-- which keeps the answers identical to the old predicate.
--
-- Exact matches are still resolved first and separately: they must win over a
-- merely-near neighbour, and they are a cheap btree-less lower() comparison
-- on an already tiny candidate set.

create index if not exists village_demographics_name_trgm_gist_idx
  on public.village_demographics using gist (village_name gist_trgm_ops);

/* ─── Shared resolver: one spelling → one settlement id ────── */

-- Kept as its own function so the lead counts, the block rollup and the
-- coverage report cannot drift apart on how a village is chosen.
create or replace function public.village_resolve_owner(
  p_tenant_id uuid,
  p_locality text,
  p_similarity_threshold float default 0.45
)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    -- 1. Exact name, largest first when the name repeats across blocks.
    (
      select s.id from public.village_demographics s
      where s.tenant_id = p_tenant_id
        and lower(btrim(s.village_name)) = lower(btrim(p_locality))
      order by s.pop_total_2011 desc, s.id
      limit 1
    ),
    -- 2. Nearest trigram neighbour, accepted only if it clears the threshold.
    (
      select n.id from (
        select s.id, s.village_name
        from public.village_demographics s
        where s.tenant_id = p_tenant_id
        order by s.village_name <-> btrim(p_locality)
        limit 1
      ) n
      where similarity(n.village_name, btrim(p_locality))
            >= coalesce(p_similarity_threshold, 0.45)
    )
  );
$$;

revoke all on function public.village_resolve_owner(uuid, text, float) from public;
grant execute on function public.village_resolve_owner(uuid, text, float) to service_role;

/* ─── Leads per settlement id ──────────────────────────────── */

create or replace function public.village_lead_counts_by_id(
  p_tenant_id uuid,
  p_village_ids uuid[],
  p_academic_year_code text default null,
  p_similarity_threshold float default 0.45
)
returns table (
  village_id uuid,
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
    select distinct w as village_id
    from unnest(coalesce(p_village_ids, array[]::uuid[])) as w
    where w is not null
  ),
  leads as (
    select
      l.stage,
      l.created_at,
      btrim(coalesce(nullif(l.lead_json ->> 'locality', ''), h.locality, '')) as lead_village
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
  owner as (
    select
      d.lead_village,
      public.village_resolve_owner(p_tenant_id, d.lead_village, p_similarity_threshold) as owner_id
    from (select distinct lead_village from leads where lead_village <> '') d
  ),
  attributed as (
    select l.stage, l.created_at, o.owner_id
    from leads l
    join owner o on o.lead_village = l.lead_village
    where o.owner_id is not null
  )
  select
    w.village_id,
    count(a.*),
    count(*) filter (where a.stage = 'enrolled'),
    count(*) filter (where a.stage in ('enquiry', 'applied', 'verified')),
    count(*) filter (where a.stage = 'lost'),
    max(a.created_at)
  from wanted w
  left join attributed a on a.owner_id = w.village_id
  group by w.village_id;
$$;

revoke all on function public.village_lead_counts_by_id(uuid, uuid[], text, float) from public;
grant execute on function public.village_lead_counts_by_id(uuid, uuid[], text, float) to service_role;

/* ─── Lead coverage ────────────────────────────────────────── */

create or replace function public.village_lead_coverage(
  p_tenant_id uuid,
  p_academic_year_code text default null,
  p_similarity_threshold float default 0.45,
  p_top_n int default 15
)
returns table (
  total_leads bigint,
  blank_locality bigint,
  matched_leads bigint,
  unmatched_leads bigint,
  top_unmatched jsonb
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with leads as (
    select btrim(coalesce(nullif(l.lead_json ->> 'locality', ''), h.locality, '')) as village
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
  by_village as (
    select village, count(*) as n from leads where village <> '' group by village
  ),
  resolved as (
    select b.village, b.n,
           public.village_resolve_owner(p_tenant_id, b.village, p_similarity_threshold)
             is not null as matched
    from by_village b
  )
  select
    (select count(*) from leads)::bigint,
    (select count(*) from leads where village = '')::bigint,
    coalesce((select sum(n) from resolved where matched), 0)::bigint,
    coalesce((select sum(n) from resolved where not matched), 0)::bigint,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('locality', village, 'leads', n) order by n desc, village)
        from (
          select village, n from resolved where not matched
          order by n desc, village limit greatest(coalesce(p_top_n, 15), 1)
        ) t
      ),
      '[]'::jsonb
    );
$$;

revoke all on function public.village_lead_coverage(uuid, text, float, int) from public;
grant execute on function public.village_lead_coverage(uuid, text, float, int) to service_role;

/* ─── Fuzzy lookup for OpenStreetMap names (radius mode) ───── */

-- Return type gains settlement_type, so the old signature must go first.
drop function if exists public.match_village_by_name(text, float, uuid, int);

create or replace function public.match_village_by_name(
  search_name text,
  similarity_threshold float default 0.35,
  p_tenant_id uuid default null,
  max_results int default 3
)
returns table (
  id uuid, tenant_id uuid, census_code text, village_name text, block_name text,
  district_name text, pop_total_2011 integer, pop_male_2011 integer,
  pop_female_2011 integer, child_0_6_total_2011 integer, child_0_6_male_2011 integer,
  child_0_6_female_2011 integer, households_2011 integer, growth_multiplier numeric,
  child_ratio numeric, projection_target_year integer,
  estimated_current_total_pop integer, estimated_current_child_pop integer,
  latitude double precision, longitude double precision,
  settlement_type text, match_score real
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- KNN-ordered shortlist, then the exact threshold test. The shortlist is a
  -- few index probes rather than a scan of every settlement.
  select * from (
    select
      v.id, v.tenant_id, v.census_code, v.village_name, v.block_name, v.district_name,
      v.pop_total_2011, v.pop_male_2011, v.pop_female_2011,
      v.child_0_6_total_2011, v.child_0_6_male_2011, v.child_0_6_female_2011,
      v.households_2011, v.growth_multiplier, v.child_ratio, v.projection_target_year,
      v.estimated_current_total_pop, v.estimated_current_child_pop,
      v.latitude, v.longitude, v.settlement_type,
      greatest(
        similarity(v.village_name, btrim(search_name)),
        case when lower(btrim(v.village_name)) = lower(btrim(search_name))
             then 1.0::real else 0.0::real end
      ) as match_score
    from public.village_demographics v
    where coalesce(btrim(search_name), '') <> ''
      and (p_tenant_id is null or v.tenant_id = p_tenant_id)
    order by v.village_name <-> btrim(search_name), v.pop_total_2011 desc
    limit greatest(coalesce(max_results, 3), 1) * 4
  ) c
  where c.match_score >= coalesce(similarity_threshold, 0.35)
  order by c.match_score desc, c.pop_total_2011 desc
  limit greatest(coalesce(max_results, 3), 1);
$$;

revoke all on function public.match_village_by_name(text, float, uuid, int) from public;
grant execute on function public.match_village_by_name(text, float, uuid, int)
  to authenticated, service_role;

notify pgrst, 'reload schema';
