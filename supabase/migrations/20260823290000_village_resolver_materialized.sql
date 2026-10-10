-- Admissions → Village market: resolve each spelling ONCE.
--
-- village_lead_counts_by_id took ~5.8 s while village_lead_coverage did the
-- same 199 resolver calls in ~0.6 s. Cause: PostgreSQL 12+ inlines a CTE that
-- is referenced once, so the `owner` CTE was folded into the join against the
-- 919-row lead table and village_resolve_owner() ran per LEAD rather than per
-- distinct LOCALITY — 919 KNN probes instead of 199.
--
-- AS MATERIALIZED pins it: resolve the distinct spellings once, then join.
-- This is the difference between the block rollup rendering and timing out
-- through PostgREST.

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
  leads as materialized (
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
  -- MATERIALIZED is load-bearing: without it the resolver runs per lead.
  owner as materialized (
    select
      d.lead_village,
      public.village_resolve_owner(p_tenant_id, d.lead_village, p_similarity_threshold) as owner_id
    from (select distinct lead_village from leads where lead_village <> '') d
  )
  select
    w.village_id,
    count(a.*),
    count(*) filter (where a.stage = 'enrolled'),
    count(*) filter (where a.stage in ('enquiry', 'applied', 'verified')),
    count(*) filter (where a.stage = 'lost'),
    max(a.created_at)
  from wanted w
  left join (
    select l.stage, l.created_at, o.owner_id
    from leads l
    join owner o on o.lead_village = l.lead_village
    where o.owner_id is not null
  ) a on a.owner_id = w.village_id
  group by w.village_id;
$$;

revoke all on function public.village_lead_counts_by_id(uuid, uuid[], text, float) from public;
grant execute on function public.village_lead_counts_by_id(uuid, uuid[], text, float) to service_role;

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
  with leads as materialized (
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
  resolved as materialized (
    select b.village, b.n,
           public.village_resolve_owner(p_tenant_id, b.village, p_similarity_threshold)
             is not null as matched
    from (select village, count(*) as n from leads where village <> '' group by village) b
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

notify pgrst, 'reload schema';
