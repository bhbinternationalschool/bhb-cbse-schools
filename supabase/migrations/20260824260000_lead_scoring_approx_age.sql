-- Admissions → score on a stated age when no birth date was given.
--
-- WHY
-- Child age is 25 of the 100 lead-score points and 4% of 919 leads carry a
-- date of birth. The survey form asked for one with an <input type="date">,
-- which opens on today and needs several scrolls back — so at a doorstep,
-- where the parent answers "chaar saal ka hai" rather than a date, it was
-- simply skipped. The form now records a tapped age alongside the exact date.
--
-- The two stay SEPARATE all the way through. A stated age is never converted
-- into a birth date: deriving 2022-08-24 from "four years old" would put a
-- fabricated date on a record the office later reads as though the family had
-- confirmed it. So the feed returns both, and the scorer prefers the exact
-- date when it exists.

-- The return type gains age_years_approx, so the old signature must go first.
drop function if exists public.admission_leads_for_scoring(uuid, text, float);

create or replace function public.admission_leads_for_scoring(
  p_tenant_id uuid,
  p_academic_year_code text default null,
  p_similarity_threshold float default 0.45
)
returns table (
  lead_id text,
  stage text,
  dob text,
  age_years_approx numeric,
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
      -- Guarded cast: the blob is client-written, and a non-numeric value
      -- here must read as "not stated" rather than abort the whole scoring
      -- run for every other lead.
      case
        when (l.lead_json ->> 'ageYearsApprox') ~ '^[0-9]+(\.[0-9]+)?$'
          then (l.lead_json ->> 'ageYearsApprox')::numeric
        else 0
      end as age_years_approx,
      btrim(coalesce(nullif(l.lead_json ->> 'locality', ''), h.locality, '')) as locality,
      coalesce(jsonb_array_length(
        case when jsonb_typeof(l.lead_json -> 'followUps') = 'array'
             then l.lead_json -> 'followUps' else '[]'::jsonb end
      ), 0) as desk_touchpoints,
      coalesce((l.lead_json -> 'followUps' -> 0) ->> 'outcome', '') as desk_last_outcome,
      coalesce((l.lead_json -> 'followUps' -> 0) ->> 'at', '') as desk_last_at
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
  server_touch as materialized (
    select
      t.lead_id,
      count(*)::integer as n,
      (array_agg(t.outcome order by t.at desc))[1] as last_outcome,
      max(t.at) as last_at
    from public.admission_lead_touchpoints t
    where t.tenant_id = p_tenant_id
    group by t.lead_id
  ),
  owner as materialized (
    select
      d.locality,
      public.village_resolve_owner(p_tenant_id, d.locality, p_similarity_threshold) as village_id
    from (select distinct locality from leads where locality <> '') d
  )
  select
    l.id,
    l.stage,
    l.dob,
    l.age_years_approx,
    l.locality,
    o.village_id,
    l.desk_touchpoints + coalesce(s.n, 0),
    case
      when s.last_at is null then l.desk_last_outcome
      when l.desk_last_at = '' then coalesce(s.last_outcome, '')
      when s.last_at > (nullif(l.desk_last_at, ''))::timestamptz
        then coalesce(s.last_outcome, '')
      else l.desk_last_outcome
    end,
    t.distance_km,
    t.duration_minutes
  from leads l
  left join owner o on o.locality = l.locality
  left join server_touch s on s.lead_id = l.id
  left join public.village_travel t on t.village_id = o.village_id;
$$;

comment on function public.admission_leads_for_scoring(uuid, text, float) is
  'Scoring inputs per lead. Returns the exact date of birth AND any parent-stated approximate age as separate fields — a stated age is never converted into a birth date. Touchpoints combine the desk blob with server-recorded contact.';

revoke all on function public.admission_leads_for_scoring(uuid, text, float) from public;
grant execute on function public.admission_leads_for_scoring(uuid, text, float) to service_role;

notify pgrst, 'reload schema';
