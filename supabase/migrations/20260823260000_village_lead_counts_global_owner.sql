-- Admissions → Village market: resolve a lead's village GLOBALLY, not within
-- whatever subset the caller happened to ask about.
--
-- Previous attempt resolved each locality to its best match among the
-- requested names only. Ask for Harhua's 169 villages and a locality that
-- really belongs to Cholapur still found a "best" Harhua match and was
-- counted there — Harhua read 513 leads against the rollup's 392.
--
-- A lead belongs to the village it belongs to, regardless of what the screen
-- is currently filtered to. So the owner is chosen against every settlement
-- on file, and the caller's list only decides which owners get REPORTED.
--
-- Names not in the census at all (an OpenStreetMap village with no PCA row)
-- still get their exact-spelling leads, so radius mode does not go blank.

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
  -- One row per distinct spelling → the single settlement that owns it,
  -- chosen against EVERY settlement on file.
  owner as (
    select
      d.lead_village,
      (
        select s.village_name
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
          s.pop_total_2011 desc
        limit 1
      ) as owner_name
    from (select distinct lead_village from leads where lead_village <> '') d
  ),
  -- A wanted name the census does not know keeps its exact-spelling leads.
  attributed as (
    select
      l.stage,
      l.created_at,
      coalesce(o.owner_name, l.lead_village) as owner_name
    from leads l
    left join owner o on o.lead_village = l.lead_village
    where l.lead_village <> ''
  )
  select
    w.village_key,
    count(a.*) as lead_count,
    count(*) filter (where a.stage = 'enrolled') as enrolled_count,
    count(*) filter (where a.stage in ('enquiry', 'applied', 'verified')) as open_count,
    count(*) filter (where a.stage = 'lost') as lost_count,
    max(a.created_at) as last_lead_at
  from wanted w
  left join attributed a on lower(a.owner_name) = lower(w.village_key)
  group by w.village_key;
$$;

comment on function public.village_lead_counts(uuid, text[], text, float) is
  'Registered leads per village. Each locality spelling resolves to exactly ONE settlement, chosen against every settlement on file rather than the requested subset, so a block filter cannot pull in leads that belong elsewhere. Agrees with village_block_market.';

revoke all on function public.village_lead_counts(uuid, text[], text, float) from public;
grant execute on function public.village_lead_counts(uuid, text[], text, float) to service_role;

notify pgrst, 'reload schema';
