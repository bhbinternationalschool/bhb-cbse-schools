with blob_c as (
  select e ->> 'id' id, e ->> 'name' name
  from public.school_mirror_state, jsonb_array_elements(state->'masters'->'classes') e
),
desk_c as (
  select e ->> 'id' id, e ->> 'name' name
  from public.masters_desk_slices, jsonb_array_elements(payload) e
  where slice_key = 'classes'
),
map as (select b.id old_id, d.id new_id from blob_c b join desk_c d on d.name = b.name)
update public.admission_desk_leads l
   set lead_json = jsonb_set(l.lead_json, '{classAdmittedId}', to_jsonb(map.new_id)),
       updated_at = now()
  from map
 where map.old_id = l.lead_json ->> 'classAdmittedId';

with recovered(old_id, class_name) as (
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
),
desk_c as (
  select e ->> 'id' id, e ->> 'name' name
  from public.masters_desk_slices, jsonb_array_elements(payload) e
  where slice_key = 'classes'
),
map as (select r.old_id, d.id new_id from recovered r join desk_c d on d.name = r.class_name)
update public.admission_desk_leads l
   set class_sought_id = map.new_id,
       lead_json = jsonb_set(l.lead_json, '{classSoughtId}', to_jsonb(map.new_id)),
       updated_at = now()
  from map
 where map.old_id = l.class_sought_id
    or map.old_id = l.lead_json ->> 'classSoughtId';

do $$
declare bad int;
begin
  select count(*) into bad
    from public.admission_desk_leads
   where coalesce(class_sought_id,'') <> coalesce(lead_json ->> 'classSoughtId','');
  if bad > 0 then
    raise exception 'class_sought_id and lead_json.classSoughtId disagree on % lead(s)', bad;
  end if;
end $$;
