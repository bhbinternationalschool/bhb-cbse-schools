-- Admissions → Village market: one lead belongs to exactly one village.
--
-- THE BUG THIS FIXES
-- village_lead_counts matched every locality against every village above the
-- trigram threshold, so a lead in "Akla" was counted in Ekala AND Koila AND
-- Koilo. Harhua's village cards summed to 545 leads while the block rollup
-- (which resolves to one owner) said 392 — the same 919-lead book giving two
-- different answers depending on which number you looked at.
--
-- Inflated penetration is worse than understated penetration: it says a
-- village is covered when nobody has been there.
--
-- THE RULE NOW
-- Each distinct locality resolves to exactly ONE settlement — exact name match
-- first, then strongest trigram, then largest population as the tie-break.
-- The earlier leadAttribution guard in the API only caught two candidates
-- sharing a NAME; this catches one name matching several different villages,
-- which is the commoner case.

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
  -- Resolve each distinct spelling to its single best owner among the names
  -- the caller asked about. One lead, one village.
  owner as (
    select
      d.lead_village,
      (
        select w.village_key
        from wanted w
        where lower(w.village_key) = lower(d.lead_village)
           or similarity(w.village_key, d.lead_village)
              >= coalesce(p_similarity_threshold, 0.45)
        order by
          (lower(w.village_key) = lower(d.lead_village)) desc,
          similarity(w.village_key, d.lead_village) desc,
          w.village_key
        limit 1
      ) as village_key
    from (select distinct lead_village from leads where lead_village <> '') d
  )
  select
    w.village_key,
    count(l.*) as lead_count,
    count(*) filter (where l.stage = 'enrolled') as enrolled_count,
    count(*) filter (where l.stage in ('enquiry', 'applied', 'verified')) as open_count,
    count(*) filter (where l.stage = 'lost') as lost_count,
    max(l.created_at) as last_lead_at
  from wanted w
  left join owner o on o.village_key = w.village_key
  left join leads l on l.lead_village = o.lead_village
  group by w.village_key;
$$;

comment on function public.village_lead_counts(uuid, text[], text, float) is
  'Registered leads per village. Each locality spelling resolves to exactly ONE village (exact, then best trigram, then largest) so a lead is never counted in two villages and the cards agree with village_block_market.';

revoke all on function public.village_lead_counts(uuid, text[], text, float) from public;
grant execute on function public.village_lead_counts(uuid, text[], text, float) to service_role;

notify pgrst, 'reload schema';
