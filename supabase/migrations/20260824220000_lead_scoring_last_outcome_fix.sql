-- Admissions → lead scoring: read the NEWEST follow-up, not the oldest.
--
-- THE BUG
-- admission_leads_for_scoring took the last disposition as
--   (lead_json -> 'followUps' -> -1) ->> 'outcome'
-- i.e. the last element of the array. But logFollowUp() in lib/admissions.ts
-- PREPENDS:
--   followUps: [entry, ...(lead.followUps || [])]
-- so the array is newest-first and element -1 is the OLDEST contact ever made.
--
-- A lead first reached in January ("interested") and last reached in August
-- ("not_interested") would have scored on the January answer forever. Today
-- the bug is invisible because not one of the 919 leads has a follow-up
-- logged — which is exactly the kind of latent wrong that surfaces months
-- later, once the field app starts writing them, as a scoreboard nobody can
-- explain.

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
      coalesce(jsonb_array_length(
        case when jsonb_typeof(l.lead_json -> 'followUps') = 'array'
             then l.lead_json -> 'followUps' else '[]'::jsonb end
      ), 0) as touchpoints,
      -- Element 0: logFollowUp prepends, so the newest contact is first.
      coalesce((l.lead_json -> 'followUps' -> 0) ->> 'outcome', '') as last_outcome
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
  owner as materialized (
    select
      d.locality,
      public.village_resolve_owner(p_tenant_id, d.locality, p_similarity_threshold) as village_id
    from (select distinct locality from leads where locality <> '') d
  )
  select
    l.id, l.stage, l.dob, l.locality, o.village_id,
    l.touchpoints, l.last_outcome, t.distance_km, t.duration_minutes
  from leads l
  left join owner o on o.locality = l.locality
  left join public.village_travel t on t.village_id = o.village_id;
$$;

comment on function public.admission_leads_for_scoring(uuid, text, float) is
  'Everything the lead scorer needs in one call. last_outcome is followUps[0] because logFollowUp prepends — the array is newest-first.';

revoke all on function public.admission_leads_for_scoring(uuid, text, float) from public;
grant execute on function public.admission_leads_for_scoring(uuid, text, float) to service_role;

notify pgrst, 'reload schema';
