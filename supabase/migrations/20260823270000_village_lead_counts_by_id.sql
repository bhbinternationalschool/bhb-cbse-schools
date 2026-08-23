-- Admissions → Village market: attribute leads by village ID, not by name.
--
-- THE LAST REMAINING MISCOUNT
-- Village names repeat across blocks — "Chandapur" is a real settlement in
-- Harhua, Arajiline AND Kashi Vidya Peeth. Any lead-count keyed on the NAME
-- therefore lands in all three, which is why per-block card totals kept
-- exceeding the block rollup (Sevapuri: 25 on the cards, 1 in the rollup)
-- no matter how the owner was chosen.
--
-- census_code is the only identity in this data (see the migration that made
-- the name+block index partial), so the row id is the only safe key. Each
-- locality spelling resolves to exactly ONE settlement id, chosen against
-- every settlement on file, and the caller asks for the ids it wants.
--
-- Villages with no census row (an OpenStreetMap node the PCA does not know)
-- have no id and therefore no attributable leads. That is correct and it is
-- already reported: village_lead_coverage() counts those leads as unplaced.

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
      (
        select s.id
        from public.village_demographics s
        where s.tenant_id = p_tenant_id
          and (
            lower(btrim(s.village_name)) = lower(d.lead_village)
            or similarity(s.village_name, d.lead_village)
               >= coalesce(p_similarity_threshold, 0.45)
          )
        order by
          (lower(btrim(s.village_name)) = lower(d.lead_village)) desc,
          similarity(s.village_name, d.lead_village) desc,
          s.pop_total_2011 desc,
          s.id
        limit 1
      ) as owner_id
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
    count(a.*) as lead_count,
    count(*) filter (where a.stage = 'enrolled') as enrolled_count,
    count(*) filter (where a.stage in ('enquiry', 'applied', 'verified')) as open_count,
    count(*) filter (where a.stage = 'lost') as lost_count,
    max(a.created_at) as last_lead_at
  from wanted w
  left join attributed a on a.owner_id = w.village_id
  group by w.village_id;
$$;

comment on function public.village_lead_counts_by_id(uuid, uuid[], text, float) is
  'Registered leads per village_demographics.id. Keyed by id because village names repeat across blocks; each locality spelling resolves to exactly one settlement chosen against every settlement on file. Per-block sums of this agree with village_block_market.';

revoke all on function public.village_lead_counts_by_id(uuid, uuid[], text, float) from public;
grant execute on function public.village_lead_counts_by_id(uuid, uuid[], text, float) to service_role;

/* ─── Block rollup: same owner rule, grouped by the owner's block ── */

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
  owned as (
    select c.village_id, c.lead_count, c.enrolled_count
    from public.village_lead_counts_by_id(
      p_tenant_id,
      (select array_agg(id) from scoped),
      p_academic_year_code,
      p_similarity_threshold
    ) c
  )
  select
    s.block_name,
    count(*)::bigint,
    count(*) filter (where s.settlement_type = 'village')::bigint,
    count(*) filter (where s.settlement_type = 'town')::bigint,
    sum(s.pop_total_2011)::bigint,
    sum(s.estimated_current_total_pop)::bigint,
    sum(s.estimated_current_child_pop)::bigint,
    coalesce(sum(o.lead_count), 0)::bigint,
    coalesce(sum(o.enrolled_count), 0)::bigint
  from scoped s
  left join owned o on o.village_id = s.id
  group by s.block_name
  order by s.block_name;
$$;

revoke all on function public.village_block_market(uuid, text, text, float) from public;
grant execute on function public.village_block_market(uuid, text, text, float) to service_role;

notify pgrst, 'reload schema';
