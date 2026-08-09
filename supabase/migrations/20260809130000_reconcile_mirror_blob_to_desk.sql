-- Retire the last copy of the pre-re-seed masters ids: school_mirror_state.
--
-- 20260809100000/110000/120000 repaired every normalized table but left the
-- blob alone on purpose — 110000 used it as its mapping source. With those
-- applied, the blob is the only place the dead id space still exists, and it
-- is a complete one. Measured before this migration (tenant bhb-international):
--
--   state.sis           2614 refs   all blob-generation
--   state.masters        657 refs   all blob-generation
--   state.admissions     889 refs   all the extinct generation from 120000
--   state.fees              0
--   state.payments          0
--
-- Nothing in the blob points at a live desk id. It is a self-consistent
-- snapshot of the old world, which is why it has been harmless so far: the
-- desk read flags bypass it and deskSkipMirrorBlobSlice stops it being
-- written. It stops being harmless the moment a read flag is turned off or
-- something reads the blob directly, which is exactly how a parent-facing
-- form was serving dead class ids.
--
-- Two steps, in this order:
--
--   1. Remap every id in the whole blob, not just masters. Rewriting only
--      state.masters would leave masters.students (176 refs), state.sis and
--      state.admissions pointing at ids the same blob no longer defines —
--      trading a consistent stale snapshot for an inconsistent one.
--   2. Overlay the desk masters slices, so state.masters holds the same
--      content the server already computes at read time via
--      mergeDeskMastersOverBlob. Slices the desk does not carry (staff,
--      students, departments, designations, specialFeeAssignments) keep the
--      blob's copy, which step 1 has just re-pointed at live ids.
--
-- The mapping is by name, 1:1, same rule as 110000, plus the extinct
-- classSoughtId ids recovered by name in 120000. Dry-run over the live blob:
-- 61 mappings, no ambiguity, zero stale refs left in any slice.
--
-- Snapshot taken before applying: school_mirror_state_pre_mirrorremap_20260809.
--
-- Idempotent: identity mappings are excluded when the map is built, so a
-- second run produces an empty map, changes nothing, and still verifies.

-- ── Snapshot (only once — never overwrite a good one with migrated data) ──
do $$
begin
  if to_regclass('public.school_mirror_state_pre_mirrorremap_20260809') is null then
    execute 'create table public.school_mirror_state_pre_mirrorremap_20260809
             as select * from public.school_mirror_state';
    execute 'alter table public.school_mirror_state_pre_mirrorremap_20260809
             enable row level security';
    execute 'revoke all on public.school_mirror_state_pre_mirrorremap_20260809
             from anon, authenticated';
  end if;
end $$;

-- ── Mapping table: old id → desk id, by name ─────────────────────────
drop table if exists public._mirror_blob_to_desk_id_map;

create table public._mirror_blob_to_desk_id_map (
  tenant_id uuid not null,
  kind      text not null,
  old_id    text not null,
  new_id    text not null
);

alter table public._mirror_blob_to_desk_id_map enable row level security;
revoke all on public._mirror_blob_to_desk_id_map from anon, authenticated;

with
blob_c as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name
  from public.school_mirror_state,
       jsonb_array_elements(state -> 'masters' -> 'classes') e
),
desk_c as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name
  from public.masters_desk_slices, jsonb_array_elements(payload) e
  where slice_key = 'classes'
),
blob_s as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name, e ->> 'classId' class_id
  from public.school_mirror_state,
       jsonb_array_elements(state -> 'masters' -> 'sections') e
),
desk_s as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name, e ->> 'classId' class_id
  from public.masters_desk_slices, jsonb_array_elements(payload) e
  where slice_key = 'sections'
),
blob_o as (
  select tenant_id, k kind, e ->> 'id' id, e ->> 'name' name
  from public.school_mirror_state,
       unnest(array['campuses','feeGroups']) k,
       jsonb_array_elements(state -> 'masters' -> k) e
),
desk_o as (
  select tenant_id, slice_key kind, e ->> 'id' id, e ->> 'name' name
  from public.masters_desk_slices, jsonb_array_elements(payload) e
  where slice_key in ('campuses','feeGroups')
),
-- The classSoughtId generation that predates the blob. No definition of it
-- survives anywhere, so it is recovered by class NAME exactly as in
-- 20260809120000, whose import-note inference this reuses.
extinct(old_id, class_name) as (
  values
    ('cls_p20bea1x', 'Nursery'),
    ('cls_452bw5hi', 'LKG'),
    ('cls_s0d4fiji', 'UKG'),
    ('cls_bsmycdp6', 'I'),
    ('cls_ilbod3ou', 'II'),
    ('cls_br67oxhz', 'III'),
    ('cls_fxgsdkes', 'IV'),
    ('cls_87uhmh08', 'V'),
    ('cls_knco3ctn', 'VI'),
    ('cls_nk81fi42', 'VII'),
    ('cls_paxy9z4s', 'VIII'),
    ('cls_10ifd9ss', 'IX'),
    ('cls_646npy16', 'X'),
    ('cls_cpbdxh9t', 'XI')
)
insert into public._mirror_blob_to_desk_id_map (tenant_id, kind, old_id, new_id)
select b.tenant_id, 'class', b.id, d.id
  from blob_c b join desk_c d on d.tenant_id = b.tenant_id and d.name = b.name
union all
select bs.tenant_id, 'section', bs.id, ds.id
  from blob_s bs
  join blob_c bc on bc.tenant_id = bs.tenant_id and bc.id = bs.class_id
  join desk_c dc on dc.tenant_id = bs.tenant_id and dc.name = bc.name
  join desk_s ds on ds.tenant_id = bs.tenant_id
                and ds.class_id = dc.id and ds.name = bs.name
union all
select b.tenant_id, b.kind, b.id, d.id
  from blob_o b
  join desk_o d on d.tenant_id = b.tenant_id and d.kind = b.kind and d.name = b.name
union all
select dc.tenant_id, 'class_extinct', x.old_id, dc.id
  from extinct x join desk_c dc on dc.name = x.class_name;

-- An id already pointing at its desk target is not a remap. Dropping those
-- keeps the migration a true no-op on re-run and keeps the check below from
-- flagging a live id as stale.
delete from public._mirror_blob_to_desk_id_map where old_id = new_id;

-- A name that mapped to two ids would silently corrupt rows. Refuse.
do $$
declare dup int;
begin
  select count(*) into dup from (
    select tenant_id, old_id from public._mirror_blob_to_desk_id_map
    group by 1,2 having count(distinct new_id) > 1
  ) x;
  if dup > 0 then
    raise exception 'ambiguous blob→desk id mapping for % key(s); aborting', dup;
  end if;
end $$;

-- ── Recursive rewrite of every string leaf in the blob ───────────────
create or replace function public._remap_blob_ids(node jsonb, m jsonb)
returns jsonb
language sql
immutable
as $$
  select case jsonb_typeof(node)
    when 'string' then coalesce(m -> (node #>> '{}'), node)
    when 'array' then coalesce(
      (select jsonb_agg(public._remap_blob_ids(e, m) order by ord)
         from jsonb_array_elements(node) with ordinality t(e, ord)),
      '[]'::jsonb)
    when 'object' then coalesce(
      (select jsonb_object_agg(k, public._remap_blob_ids(v, m))
         from jsonb_each(node) t(k, v)),
      '{}'::jsonb)
    else node
  end
$$;

-- ── 1. Remap ids across the entire blob ──────────────────────────────
update public.school_mirror_state s
   set state = public._remap_blob_ids(s.state, m.map),
       updated_at = now()
  from (
    select tenant_id, jsonb_object_agg(old_id, new_id) map
      from public._mirror_blob_to_desk_id_map
     group by tenant_id
  ) m
 where m.tenant_id = s.tenant_id
   and public._remap_blob_ids(s.state, m.map) is distinct from s.state;

-- ── 2. Overlay desk masters, slice by slice ──────────────────────────
-- Matches mergeDeskMastersOverBlob: a desk slice wins only where it has
-- content, so staff/students/departments/designations/specialFeeAssignments
-- keep the blob copy that step 1 just re-pointed at live ids.
update public.school_mirror_state s
   set state = jsonb_set(
         s.state,
         '{masters}',
         coalesce(s.state -> 'masters', '{}'::jsonb)
           || jsonb_build_object('version', 2)
           || d.obj
       ),
       updated_at = now()
  from (
    select tenant_id, jsonb_object_agg(slice_key, payload) obj
      from public.masters_desk_slices
     where (jsonb_typeof(payload) = 'array' and jsonb_array_length(payload) > 0)
        or jsonb_typeof(payload) = 'object'
     group by tenant_id
  ) d
 where d.tenant_id = s.tenant_id
   and jsonb_set(
         s.state, '{masters}',
         coalesce(s.state -> 'masters', '{}'::jsonb)
           || jsonb_build_object('version', 2)
           || d.obj
       ) is distinct from s.state;

-- ── Verify: not one old id survives anywhere in the blob ─────────────
do $$
declare bad int;
begin
  select count(*) into bad
    from public.school_mirror_state s
    join public._mirror_blob_to_desk_id_map m on m.tenant_id = s.tenant_id
   where s.state::text like '%' || m.old_id || '%';
  if bad > 0 then
    raise exception '% stale id reference(s) still present in school_mirror_state', bad;
  end if;
end $$;

drop function public._remap_blob_ids(jsonb, jsonb);
drop table public._mirror_blob_to_desk_id_map;
