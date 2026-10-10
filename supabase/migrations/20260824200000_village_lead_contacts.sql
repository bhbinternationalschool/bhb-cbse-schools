-- Admissions → Village market: parent contact numbers per settlement.
--
-- Feeds the ad-targeting export. Deliberately NOT part of the dashboard
-- payload: the grid renders on every tab switch and has no business carrying
-- parents' phone numbers with it. This is a separate call, behind a separate
-- permission, made only when somebody presses Export.
--
-- Numbers are normalised to E.164 because that is what ad platforms match on.
-- An unnormalised 10-digit string matches nothing, so an export full of them
-- looks like a working file and silently reaches no one.

create or replace function public.normalize_in_mobile(raw text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  with d as (
    select regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g') as digits
  ),
  last10 as (
    -- Strip 0/91/+91 prefixes by taking the trailing ten digits.
    select case when length(digits) >= 10 then right(digits, 10) else '' end as n
    from d
  )
  -- Indian mobile numbers start 6-9. Anything else is a landline, a partial
  -- entry or a typo, and returning it would pad the audience with numbers
  -- that cannot match.
  select case when n ~ '^[6-9][0-9]{9}$' then '+91' || n else null end
  from last10;
$$;

comment on function public.normalize_in_mobile(text) is
  'A 10-digit Indian mobile as E.164 (+91XXXXXXXXXX), or null if it is not one. Ad platforms match on E.164; raw local digits match nothing.';

/* ─── Contacts per settlement ──────────────────────────────── */

create or replace function public.village_lead_contacts(
  p_tenant_id uuid,
  p_village_ids uuid[],
  p_academic_year_code text default null,
  p_similarity_threshold float default 0.45
)
returns table (
  village_id uuid,
  phones text[],
  contact_count integer,
  lead_count integer
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
      l.mobile,
      l.lead_json ->> 'whatsapp' as whatsapp,
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
  -- Same single-owner rule the counts use, so an exported audience matches
  -- the village card it was exported from.
  owner as materialized (
    select
      d.lead_village,
      public.village_resolve_owner(p_tenant_id, d.lead_village, p_similarity_threshold) as owner_id
    from (select distinct lead_village from leads where lead_village <> '') d
  ),
  attributed as (
    select o.owner_id, l.mobile, l.whatsapp
    from leads l
    join owner o on o.lead_village = l.lead_village
    where o.owner_id is not null
  ),
  -- One row per (village, number). A household that gave the same number as
  -- both mobile and WhatsApp must not be counted or exported twice.
  numbers as (
    select distinct a.owner_id, p.phone
    from attributed a
    cross join lateral (
      values (public.normalize_in_mobile(a.mobile)),
             (public.normalize_in_mobile(a.whatsapp))
    ) as p(phone)
    where p.phone is not null
  )
  select
    w.village_id,
    coalesce(array_agg(n.phone order by n.phone) filter (where n.phone is not null), '{}'),
    count(n.phone)::integer,
    (
      select count(*)::integer from attributed a where a.owner_id = w.village_id
    )
  from wanted w
  left join numbers n on n.owner_id = w.village_id
  group by w.village_id;
$$;

comment on function public.village_lead_contacts(uuid, uuid[], text, float) is
  'Distinct E.164 parent numbers per settlement, using the same single-owner attribution as village_lead_counts_by_id. Mobile and WhatsApp are de-duplicated against each other. service_role only — this returns personal data and is not part of any dashboard payload.';

revoke all on function public.village_lead_contacts(uuid, uuid[], text, float) from public;
grant execute on function public.village_lead_contacts(uuid, uuid[], text, float) to service_role;

notify pgrst, 'reload schema';
