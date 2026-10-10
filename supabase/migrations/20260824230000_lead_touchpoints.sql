-- Admissions → server-recorded touchpoints.
--
-- WHY THIS EXISTS
-- Engagement is 25 of the 100 lead-score points, and on 2026-08-24 not one of
-- 919 leads had a single follow-up logged. The score could not discriminate:
-- 880 cold, 0 warm, 0 hot.
--
-- The obvious fix — append to lead_json.followUps when we message somebody —
-- is the trap this schema already learned about. The desk sync pushes WHOLE
-- lead rows from the browser and upserts them, so a server-appended follow-up
-- survives only until the next sync from a client that has never heard of it.
-- Server-recorded contact therefore lives in its own table, and the scorer
-- counts both sources.
--
-- Every WhatsApp message the follow-up campaign sends lands here, which means
-- the engagement signal starts existing the first time a campaign runs.

create table if not exists public.admission_lead_touchpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id text not null
    references public.admission_desk_leads(id) on delete cascade,

  channel text not null default 'whatsapp'
    check (channel in ('whatsapp', 'sms', 'call', 'email', 'visit', 'other')),
  direction text not null default 'outbound'
    check (direction in ('outbound', 'inbound')),

  -- Mirrors the desk's FollowUpOutcome vocabulary so the two sources can be
  -- counted together without translation.
  outcome text not null default 'message_sent',

  body text not null default '',
  -- Groups one campaign run, so a bad send can be found and explained later.
  campaign_id text not null default '',
  /** 'template' or 'freeform' — which Meta path actually carried it. */
  send_mode text not null default '',
  provider_id text not null default '',
  by_actor text not null default '',

  at timestamptz not null default now()
);

create index if not exists admission_lead_touchpoints_lead_idx
  on public.admission_lead_touchpoints (tenant_id, lead_id, at desc);

create index if not exists admission_lead_touchpoints_campaign_idx
  on public.admission_lead_touchpoints (tenant_id, campaign_id);

/* ─── Scoring feed: count BOTH sources ─────────────────────── */

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
      ), 0) as desk_touchpoints,
      -- Element 0: logFollowUp prepends, so the newest contact is first.
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
    l.locality,
    o.village_id,
    l.desk_touchpoints + coalesce(s.n, 0),
    -- Whichever source spoke to the family most recently wins. Comparing the
    -- timestamps rather than preferring one table keeps a counsellor's phone
    -- call ahead of an older automated message, and vice versa.
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
  'Scoring inputs per lead. Touchpoints combine the desk blob (lead_json.followUps, newest-first) with server-recorded contact in admission_lead_touchpoints; the most recent of the two supplies last_outcome.';

/* ─── Score summary per village, for the dashboard cards ───── */

-- PostgREST cannot GROUP BY, and the grid needs one row per village rather
-- than 919 lead rows shipped to the browser to be counted there.
create or replace function public.village_lead_score_summary(
  p_tenant_id uuid,
  p_village_ids uuid[]
)
returns table (
  village_id uuid,
  hot integer,
  warm integer,
  cold integer,
  enrolled integer,
  avg_score integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    m.village_id,
    count(*) filter (where m.lead_status = 'hot')::integer,
    count(*) filter (where m.lead_status = 'warm')::integer,
    count(*) filter (where m.lead_status = 'cold')::integer,
    count(*) filter (where m.lead_status = 'enrolled')::integer,
    -- Enrolled leads score a flat 100 by definition, so including them would
    -- make a village look hotter the more families had already joined.
    coalesce(round(avg(m.lead_score) filter (where m.lead_status <> 'enrolled')), 0)::integer
  from public.admission_lead_market_state m
  where m.tenant_id = p_tenant_id
    and m.village_id = any(coalesce(p_village_ids, array[]::uuid[]))
  group by m.village_id;
$$;

revoke all on function public.village_lead_score_summary(uuid, uuid[]) from public;
grant execute on function public.village_lead_score_summary(uuid, uuid[]) to service_role;

/* ─── RLS + grants ─────────────────────────────────────────── */

alter table public.admission_lead_touchpoints enable row level security;

drop policy if exists admission_lead_touchpoints_tenant_read on public.admission_lead_touchpoints;
create policy admission_lead_touchpoints_tenant_read
  on public.admission_lead_touchpoints
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

grant select on public.admission_lead_touchpoints to authenticated;
grant select, insert, update, delete on public.admission_lead_touchpoints to service_role;

revoke all on function public.admission_leads_for_scoring(uuid, text, float) from public;
grant execute on function public.admission_leads_for_scoring(uuid, text, float) to service_role;

notify pgrst, 'reload schema';
