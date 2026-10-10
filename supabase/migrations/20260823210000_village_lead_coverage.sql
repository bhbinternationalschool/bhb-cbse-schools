-- Admissions → Village market: how much of the lead book the census can size.
--
-- WHY THIS EXISTS
-- Penetration is leads ÷ estimated 0-6 pool, and leads are matched to villages
-- by the locality the field agent typed. Measured against the real book on
-- 2026-08-23: 919 leads across 199 distinct localities, of which only ~71%
-- match a census village at the 0.45 trigram threshold.
--
-- The unmatched 29% are not missing leads — they are leads whose village we
-- cannot size. Without this function the dashboard would quietly show a
-- penetration figure a third lower than reality and look precise while doing
-- it. Trigram alone cannot close the gap either: similarity('Ayar','Aayr') is
-- 0.111, far below any threshold that would not also match unrelated villages
-- (lowering it to 0.30 starts matching Akla to Koila).
--
-- So the number is reported instead of guessed. The office sees exactly how
-- many leads sit outside the map and which spellings cause it, and can fix
-- the source spelling — which is the only fix that is actually correct.

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
    select btrim(coalesce(
             nullif(l.lead_json ->> 'locality', ''),
             h.locality,
             ''
           )) as village
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
  -- Group first: 199 distinct localities against 1,258 villages is a
  -- thousand-fold cheaper than 919 leads against 1,258 villages.
  by_village as (
    select village, count(*) as n
    from leads
    where village <> ''
    group by village
  ),
  resolved as (
    select
      b.village,
      b.n,
      exists (
        select 1 from public.village_demographics d
        where d.tenant_id = p_tenant_id
          and (
            lower(btrim(d.village_name)) = lower(b.village)
            or similarity(d.village_name, b.village)
               >= coalesce(p_similarity_threshold, 0.45)
          )
      ) as matched
    from by_village b
  )
  select
    (select count(*) from leads)::bigint,
    (select count(*) from leads where village = '')::bigint,
    coalesce((select sum(n) from resolved where matched), 0)::bigint,
    coalesce((select sum(n) from resolved where not matched), 0)::bigint,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('locality', village, 'leads', n)
                         order by n desc, village)
        from (
          select village, n from resolved
          where not matched
          order by n desc, village
          limit greatest(coalesce(p_top_n, 15), 1)
        ) t
      ),
      '[]'::jsonb
    );
$$;

comment on function public.village_lead_coverage(uuid, text, float, int) is
  'How many registered leads sit on a village the census can size, and the loudest unmatched spellings. Makes an understated penetration figure visible instead of silently wrong.';

-- service_role only, matching village_lead_counts: this reads
-- admission_desk_leads, which grants nothing to authenticated.
revoke all on function public.village_lead_coverage(uuid, text, float, int) from public;
grant execute on function public.village_lead_coverage(uuid, text, float, int)
  to service_role;

notify pgrst, 'reload schema';
