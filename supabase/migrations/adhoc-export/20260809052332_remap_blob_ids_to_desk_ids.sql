drop table if exists public._blob_to_desk_id_map;

create table public._blob_to_desk_id_map (
  kind   text not null,
  old_id text not null,
  new_id text not null
);

alter table public._blob_to_desk_id_map enable row level security;
revoke all on public._blob_to_desk_id_map from anon, authenticated;

with
blob_c as (
  select e ->> 'id' id, e ->> 'name' name
  from public.school_mirror_state, jsonb_array_elements(state->'masters'->'classes') e
),
desk_c as (
  select e ->> 'id' id, e ->> 'name' name
  from public.masters_desk_slices, jsonb_array_elements(payload) e
  where slice_key = 'classes'
),
blob_s as (
  select e ->> 'id' id, e ->> 'name' name, e ->> 'classId' class_id
  from public.school_mirror_state, jsonb_array_elements(state->'masters'->'sections') e
),
desk_s as (
  select e ->> 'id' id, e ->> 'name' name, e ->> 'classId' class_id
  from public.masters_desk_slices, jsonb_array_elements(payload) e
  where slice_key = 'sections'
),
blob_o as (
  select k kind, e ->> 'id' id, e ->> 'name' name
  from public.school_mirror_state,
       unnest(array['campuses','feeGroups']) k,
       jsonb_array_elements(state->'masters'->k) e
),
desk_o as (
  select slice_key kind, e ->> 'id' id, e ->> 'name' name
  from public.masters_desk_slices, jsonb_array_elements(payload) e
  where slice_key in ('campuses','feeGroups')
)
insert into public._blob_to_desk_id_map (kind, old_id, new_id)
select 'class', b.id, d.id from blob_c b join desk_c d on d.name = b.name
union all
select 'section', bs.id, ds.id
  from blob_s bs
  join blob_c bc on bc.id = bs.class_id
  join desk_c dc on dc.name = bc.name
  join desk_s ds on ds.class_id = dc.id and ds.name = bs.name
union all
select b.kind, b.id, d.id
  from blob_o b join desk_o d on d.kind = b.kind and d.name = b.name;

do $$
declare dup int;
begin
  select count(*) into dup from (
    select kind, old_id from public._blob_to_desk_id_map
    group by 1,2 having count(*) > 1
  ) x;
  if dup > 0 then
    raise exception 'ambiguous blob-to-desk id mapping for % key(s); aborting', dup;
  end if;
end $$;

update public.sis_students s
   set campus_id = m.new_id, updated_at = now()
  from public._blob_to_desk_id_map m
 where m.kind = 'campuses' and m.old_id = s.campus_id;

update public.sis_students s
   set fee_group_id = m.new_id, updated_at = now()
  from public._blob_to_desk_id_map m
 where m.kind = 'feeGroups' and m.old_id = s.fee_group_id;

update public.rte_desk_seats r
   set class_id = m.new_id, updated_at = now()
  from public._blob_to_desk_id_map m
 where m.kind = 'class' and m.old_id = r.class_id;

update public.homework_desk_posts h
   set class_id = coalesce(
         (select new_id from public._blob_to_desk_id_map
           where kind = 'class' and old_id = h.class_id), h.class_id),
       section_id = coalesce(
         (select new_id from public._blob_to_desk_id_map
           where kind = 'section' and old_id = h.section_id), h.section_id),
       updated_at = now()
 where exists (
   select 1 from public._blob_to_desk_id_map
    where (kind = 'class'   and old_id = h.class_id)
       or (kind = 'section' and old_id = h.section_id)
 );

update public.homework_desk_diary h
   set class_id = coalesce(
         (select new_id from public._blob_to_desk_id_map
           where kind = 'class' and old_id = h.class_id), h.class_id),
       section_id = coalesce(
         (select new_id from public._blob_to_desk_id_map
           where kind = 'section' and old_id = h.section_id), h.section_id),
       updated_at = now()
 where exists (
   select 1 from public._blob_to_desk_id_map
    where (kind = 'class'   and old_id = h.class_id)
       or (kind = 'section' and old_id = h.section_id)
 );

update public.ptm_desk_events p
   set class_ids_json = mapped.arr, updated_at = now()
  from (
    select e.id,
           jsonb_agg(coalesce(m.new_id, cid) order by ord) arr
      from public.ptm_desk_events e,
           lateral jsonb_array_elements_text(e.class_ids_json)
             with ordinality t(cid, ord)
      left join public._blob_to_desk_id_map m
             on m.kind = 'class' and m.old_id = t.cid
     where jsonb_typeof(e.class_ids_json) = 'array'
     group by e.id
  ) mapped
 where mapped.id = p.id
   and mapped.arr is distinct from p.class_ids_json;

update public.wa_desk_bot_slices w
   set payload = jsonb_set(
         w.payload,
         '{channels}',
         (
           select coalesce(jsonb_agg(
             ch
             || jsonb_build_object(
                  'classId',   coalesce(cm.new_id, ch ->> 'classId'),
                  'sectionId', coalesce(sm.new_id, ch ->> 'sectionId'),
                  'id',        case
                                 when sm.new_id is not null
                                 then 'ch_' || coalesce(ch ->> 'academicYearCode','')
                                      || '_' || sm.new_id
                                 else ch ->> 'id'
                               end
                )
             order by ord
           ), '[]'::jsonb)
           from jsonb_array_elements(w.payload -> 'channels')
                with ordinality t(ch, ord)
           left join public._blob_to_desk_id_map cm
                  on cm.kind = 'class' and cm.old_id = ch ->> 'classId'
           left join public._blob_to_desk_id_map sm
                  on sm.kind = 'section' and sm.old_id = ch ->> 'sectionId'
         )
       ),
       updated_at = now()
 where w.slice_key = 'classChannel'
   and jsonb_typeof(w.payload -> 'channels') = 'array';

drop table public._blob_to_desk_id_map;
