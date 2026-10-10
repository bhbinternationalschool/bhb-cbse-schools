-- Admissions → Village market: per-block rollup with real lead counts.
--
-- The entry point for the dashboard. The office asks "which block this week"
-- before it asks "which village", and ~1,292 settlement cards is not a screen
-- anyone can plan from. This answers the first question in one row per block.
--
-- Lead matching is the same rule village_lead_counts uses (exact locality,
-- trigram fallback) so a block's total and its villages' totals agree.

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
  'One row per CD block: settlements, projected population and 0-6 pool, and the leads/enrolments actually registered there. The dashboard entry point above the per-village cards.';

revoke all on function public.village_block_market(uuid, text, text, float) from public;
grant execute on function public.village_block_market(uuid, text, text, float) to service_role;

notify pgrst, 'reload schema';
