-- Admissions → Village market: rank alias suggestions by consonant skeleton,
-- and let a person search when the machine still misses.
--
-- WHY: for "Aayr" the correct answer is Ayar, and trigram similarity scores it
-- 0.111 — so the KNN suggestion list put Amwa and two Auras ahead of it, with
-- Ayar scraping in at position 4. A reviewer scanning the top of a list would
-- confirm the wrong village or give up.
--
-- The consonant skeleton (drop vowels, keep order) collapses Indic
-- transliteration drift that trigram cannot see: Aayr -> "yr", Ayar -> "yr".
-- Across the whole census that key picks out exactly one candidate for Aayr,
-- and it is the right one.
--
-- This is deliberately a RANKING aid, never an automatic match. The skeleton
-- collides badly on short names — Akla, Ekala, Koila and Koilo all reduce to
-- "kl" — which is fatal for auto-matching but harmless for ordering options a
-- human is about to choose between. The machine proposes; the person decides.

create or replace function public.village_consonant_key(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select regexp_replace(
           regexp_replace(lower(btrim(t)), '[^a-z]', '', 'g'),
           '[aeiou]', '', 'g'
         );
$$;

comment on function public.village_consonant_key(text) is
  'Consonant skeleton of a name: lowercase, strip non-letters, drop vowels. Aayr and Ayar both give "yr". For ranking suggestions only — it collides on short names (Akla/Ekala/Koila all give "kl") and must never auto-match.';

create index if not exists village_demographics_consonant_idx
  on public.village_demographics (tenant_id, public.village_consonant_key(village_name));

/* ─── Search, for when the suggestions still miss ──────────── */

create or replace function public.village_search(
  p_tenant_id uuid,
  p_query text,
  p_limit int default 20
)
returns table (
  village_id uuid,
  village_name text,
  block_name text,
  settlement_type text,
  child_pool integer,
  score real
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    v.id, v.village_name, v.block_name, v.settlement_type,
    v.estimated_current_child_pop,
    similarity(v.village_name, btrim(p_query)) as score
  from public.village_demographics v
  where v.tenant_id = p_tenant_id
    and btrim(coalesce(p_query, '')) <> ''
    -- Substring first so typing "ayar" finds "Puari Kala"-style names the
    -- reviewer is actually reading off a form, then the skeleton, then fuzzy.
    and (
      v.village_name ilike '%' || btrim(p_query) || '%'
      or public.village_consonant_key(v.village_name)
         = public.village_consonant_key(p_query)
      or similarity(v.village_name, btrim(p_query)) >= 0.25
    )
  order by
    (lower(btrim(v.village_name)) = lower(btrim(p_query))) desc,
    (v.village_name ilike btrim(p_query) || '%') desc,
    similarity(v.village_name, btrim(p_query)) desc,
    v.estimated_current_child_pop desc
  limit greatest(coalesce(p_limit, 20), 1);
$$;

revoke all on function public.village_search(uuid, text, int) from public;
grant execute on function public.village_search(uuid, text, int) to service_role;

/* ─── Candidates: skeleton-first ordering, wider list ──────── */

create or replace function public.village_alias_candidates(
  p_tenant_id uuid,
  p_academic_year_code text default null,
  p_limit int default 50,
  p_suggestions int default 6,
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
    select village, count(*) as lead_count,
           count(*) filter (where stage = 'enrolled') as enrolled_count
    from leads where village <> '' group by village
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
                   'score', round(t.score::numeric, 3),
                   'skeletonMatch', t.skeleton_match
                 ) order by t.skeleton_match desc, t.d
               )
        from (
          -- Union of two candidate pools: everything sharing the consonant
          -- skeleton (which trigram would bury), plus the nearest neighbours.
          select c.id, c.village_name, c.block_name, c.settlement_type,
                 c.estimated_current_child_pop,
                 similarity(c.village_name, u.village) as score,
                 (c.village_name <-> u.village) as d,
                 public.village_consonant_key(c.village_name)
                   = public.village_consonant_key(u.village) as skeleton_match
          from (
            (
              select s.* from public.village_demographics s
              where s.tenant_id = p_tenant_id
                and public.village_consonant_key(s.village_name)
                    = public.village_consonant_key(u.village)
              order by s.pop_total_2011 desc
              limit greatest(coalesce(p_suggestions, 6), 1)
            )
            union
            (
              select s.* from public.village_demographics s
              where s.tenant_id = p_tenant_id
              order by s.village_name <-> u.village
              limit greatest(coalesce(p_suggestions, 6), 1)
            )
          ) c
          order by skeleton_match desc, d
          limit greatest(coalesce(p_suggestions, 6), 1)
        ) t
      ),
      '[]'::jsonb
    ) as suggestions
  from unresolved u
  order by u.lead_count desc, u.village;
$$;

revoke all on function public.village_alias_candidates(uuid, text, int, int, float) from public;
grant execute on function public.village_alias_candidates(uuid, text, int, int, float) to service_role;

notify pgrst, 'reload schema';
