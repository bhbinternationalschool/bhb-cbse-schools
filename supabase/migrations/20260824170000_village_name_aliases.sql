-- Admissions → Village market: human-confirmed spelling aliases.
--
-- THE PROBLEM THIS CLOSES
-- Leads are matched to villages by the locality a field agent typed, and on
-- 2026-08-24 267 of 919 leads (29%) named a spelling no census village
-- matched. Every penetration figure on the dashboard was therefore a floor,
-- and said so.
--
-- Fuzzy matching cannot close that gap. similarity('Ayar','Aayr') is 0.111 —
-- below any threshold that does not also match Akla to Koila, which would
-- credit leads to a village nobody visited. Inflated penetration is worse
-- than understated penetration: it says a village is covered when it is not.
--
-- So the gap is closed by a person, once per spelling. A confirmed alias is a
-- fact the office asserted, not a guess the system made, and it outranks the
-- fuzzy guess permanently. "Not a village" is equally a decision: it pins the
-- spelling to no settlement and stops it being offered again, which is why
-- the alias row must beat the trigram fallback even when it resolves to null.

create table if not exists public.village_name_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- The spelling exactly as the agent typed it, kept for display…
  alias text not null,
  -- …and folded for lookup. Generated so a caller cannot desync the two.
  alias_key text generated always as (lower(btrim(alias))) stored,

  -- null is meaningful: status 'ignored' means a person decided this is not
  -- a settlement we can size (a landmark, a mohalla, a typo beyond rescue).
  village_id uuid references public.village_demographics(id) on delete cascade,

  status text not null default 'confirmed'
    check (status in ('confirmed', 'ignored')),

  -- How many leads rode on this decision when it was made. Informational —
  -- it makes a bad call visible later rather than silent.
  lead_count_at_confirm integer not null default 0,
  note text not null default '',

  confirmed_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A confirmed alias must point somewhere; an ignored one must not.
  constraint village_name_aliases_target_chk check (
    (status = 'confirmed' and village_id is not null)
    or (status = 'ignored' and village_id is null)
  )
);

create unique index if not exists village_name_aliases_key_uidx
  on public.village_name_aliases (tenant_id, alias_key);

create index if not exists village_name_aliases_village_idx
  on public.village_name_aliases (tenant_id, village_id);

/* ─── Resolver: a confirmed alias outranks the fuzzy guess ─── */

create or replace function public.village_resolve_owner(
  p_tenant_id uuid,
  p_locality text,
  p_similarity_threshold float default 0.45
)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with alias as (
    select a.village_id
    from public.village_name_aliases a
    where a.tenant_id = p_tenant_id
      and a.alias_key = lower(btrim(p_locality))
    limit 1
  )
  select case
    -- A human decision, including a deliberate "not a village" (village_id
    -- null), wins outright. EXISTS rather than coalesce, so an ignored alias
    -- suppresses the trigram fallback instead of falling through to it.
    when exists (select 1 from alias) then (select village_id from alias)
    else coalesce(
      -- Exact name, largest first when the name repeats across blocks.
      (
        select s.id from public.village_demographics s
        where s.tenant_id = p_tenant_id
          and lower(btrim(s.village_name)) = lower(btrim(p_locality))
        order by s.pop_total_2011 desc, s.id
        limit 1
      ),
      -- Nearest trigram neighbour, accepted only if it clears the threshold.
      (
        select n.id from (
          select s.id, s.village_name
          from public.village_demographics s
          where s.tenant_id = p_tenant_id
          order by s.village_name <-> btrim(p_locality)
          limit 1
        ) n
        where similarity(n.village_name, btrim(p_locality))
              >= coalesce(p_similarity_threshold, 0.45)
      )
    )
  end;
$$;

comment on function public.village_resolve_owner(uuid, text, float) is
  'One locality spelling -> one settlement id. Order: confirmed alias (a human decision, may be a deliberate null), then exact name, then nearest trigram neighbour above the threshold. Every lead count, block rollup and coverage figure goes through this, so an alias fixes all of them at once.';

/* ─── What still needs a decision ──────────────────────────── */

-- Unresolved spellings, loudest first, each with its nearest candidates.
-- Spellings that already have an alias row — confirmed OR ignored — are gone
-- from this list: the screen is a queue that drains, not a report that nags.
create or replace function public.village_alias_candidates(
  p_tenant_id uuid,
  p_academic_year_code text default null,
  p_limit int default 50,
  p_suggestions int default 4,
  p_similarity_threshold float default 0.45
)
returns table (
  locality text,
  lead_count bigint,
  enrolled_count bigint,
  suggestions jsonb
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with leads as materialized (
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
  grouped as materialized (
    select
      village,
      count(*) as lead_count,
      count(*) filter (where stage = 'enrolled') as enrolled_count
    from leads
    where village <> ''
    group by village
  ),
  unresolved as materialized (
    select g.*
    from grouped g
    where not exists (
      select 1 from public.village_name_aliases a
      where a.tenant_id = p_tenant_id and a.alias_key = lower(btrim(g.village))
    )
      and public.village_resolve_owner(p_tenant_id, g.village, p_similarity_threshold) is null
    order by g.lead_count desc, g.village
    limit greatest(coalesce(p_limit, 50), 1)
  )
  select
    u.village,
    u.lead_count,
    u.enrolled_count,
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'villageId', t.id,
                   'villageName', t.village_name,
                   'blockName', t.block_name,
                   'settlementType', t.settlement_type,
                   'childPool', t.estimated_current_child_pop,
                   'score', round(t.score::numeric, 3)
                 ) order by t.d
               )
        from (
          select s.id, s.village_name, s.block_name, s.settlement_type,
                 s.estimated_current_child_pop,
                 similarity(s.village_name, u.village) as score,
                 (s.village_name <-> u.village) as d
          from public.village_demographics s
          where s.tenant_id = p_tenant_id
          order by s.village_name <-> u.village
          limit greatest(coalesce(p_suggestions, 4), 1)
        ) t
      ),
      '[]'::jsonb
    ) as suggestions
  from unresolved u
  order by u.lead_count desc, u.village;
$$;

comment on function public.village_alias_candidates(uuid, text, int, int, float) is
  'Lead localities that still resolve to no settlement, loudest first, each with its nearest census candidates and their trigram scores. Already-decided spellings are excluded so the review queue drains.';

/* ─── Decisions already taken ──────────────────────────────── */

create or replace function public.village_alias_list(p_tenant_id uuid)
returns table (
  id uuid,
  alias text,
  status text,
  village_id uuid,
  village_name text,
  block_name text,
  lead_count_at_confirm integer,
  note text,
  confirmed_by text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    a.id, a.alias, a.status, a.village_id,
    coalesce(v.village_name, ''), coalesce(v.block_name, ''),
    a.lead_count_at_confirm, a.note, a.confirmed_by, a.updated_at
  from public.village_name_aliases a
  left join public.village_demographics v on v.id = a.village_id
  where a.tenant_id = p_tenant_id
  order by a.updated_at desc;
$$;

/* ─── RLS + grants ─────────────────────────────────────────── */

alter table public.village_name_aliases enable row level security;

drop policy if exists village_name_aliases_tenant_read on public.village_name_aliases;
create policy village_name_aliases_tenant_read
  on public.village_name_aliases
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

grant select on public.village_name_aliases to authenticated;
grant select, insert, update, delete on public.village_name_aliases to service_role;

revoke all on function public.village_alias_candidates(uuid, text, int, int, float) from public;
grant execute on function public.village_alias_candidates(uuid, text, int, int, float) to service_role;

revoke all on function public.village_alias_list(uuid) from public;
grant execute on function public.village_alias_list(uuid) to service_role;

notify pgrst, 'reload schema';
