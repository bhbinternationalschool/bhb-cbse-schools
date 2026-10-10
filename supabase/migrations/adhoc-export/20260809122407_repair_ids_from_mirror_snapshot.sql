-- Repair the class/section/campus/fee-group ids broken by the 2026-08-09
-- masters re-seed, using the mirror snapshot as the recovery source.
-- Full rationale in supabase/migrations/20260809125000_repair_ids_from_mirror_snapshot.sql

do $$
declare t text;
begin
  foreach t in array array['sis_students','admission_desk_leads','rte_desk_seats'] loop
    if to_regclass('public.' || t || '_pre_snapshotrepair_20260809') is null then
      execute format('create table public.%I as select * from public.%I',
                     t || '_pre_snapshotrepair_20260809', t);
      execute format('alter table public.%I enable row level security',
                     t || '_pre_snapshotrepair_20260809');
      execute format('revoke all on public.%I from anon, authenticated',
                     t || '_pre_snapshotrepair_20260809');
    end if;
  end loop;
end $$;

drop table if exists public._snapshot_repair_id_map;

create table public._snapshot_repair_id_map (
  tenant_id uuid not null,
  kind      text not null,
  old_id    text not null,
  new_id    text not null
);

alter table public._snapshot_repair_id_map enable row level security;
revoke all on public._snapshot_repair_id_map from anon, authenticated;

with
blob_stu as (
  select m.tenant_id,
         e ->> 'id' sid, e ->> 'class_id' bcls, e ->> 'section_id' bsec,
         e ->> 'campus_id' bcam, e ->> 'fee_group_id' bfg
    from public.school_mirror_state m,
         jsonb_array_elements(m.state -> 'sis' -> 'students') e
),
blob_lead as (
  select m.tenant_id, e ->> 'id' lid, e ->> 'classSoughtId' bcls
    from public.school_mirror_state m,
         jsonb_array_elements(m.state -> 'admissions' -> 'leads') e
),
blob_c as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name
    from public.school_mirror_state, jsonb_array_elements(state->'masters'->'classes') e
),
blob_s as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name, e ->> 'classId' cls
    from public.school_mirror_state, jsonb_array_elements(state->'masters'->'sections') e
),
blob_cam as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name
    from public.school_mirror_state, jsonb_array_elements(state->'masters'->'campuses') e
),
blob_fg as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name
    from public.school_mirror_state, jsonb_array_elements(state->'masters'->'feeGroups') e
),
desk_c as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name
    from public.masters_desk_slices, jsonb_array_elements(payload) e where slice_key='classes'
),
desk_s as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name, e ->> 'classId' cls
    from public.masters_desk_slices, jsonb_array_elements(payload) e where slice_key='sections'
),
desk_cam as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name
    from public.masters_desk_slices, jsonb_array_elements(payload) e where slice_key='campuses'
),
desk_fg as (
  select tenant_id, e ->> 'id' id, e ->> 'name' name
    from public.masters_desk_slices, jsonb_array_elements(payload) e where slice_key='feeGroups'
),
extinct(old_id, class_name) as (
  values
    ('cls_p20bea1x','Nursery'),('cls_452bw5hi','LKG'),('cls_s0d4fiji','UKG'),
    ('cls_bsmycdp6','I'),('cls_ilbod3ou','II'),('cls_br67oxhz','III'),
    ('cls_fxgsdkes','IV'),('cls_87uhmh08','V'),('cls_knco3ctn','VI'),
    ('cls_nk81fi42','VII'),('cls_paxy9z4s','VIII'),('cls_10ifd9ss','IX'),
    ('cls_646npy16','X'),('cls_cpbdxh9t','XI')
)
insert into public._snapshot_repair_id_map (tenant_id, kind, old_id, new_id)
select distinct s.tenant_id, 'class', s.class_id, dc.id
  from public.sis_students s
  join blob_stu b on b.tenant_id = s.tenant_id and b.sid = s.id::text
  join blob_c  bc on bc.tenant_id = s.tenant_id and bc.id = b.bcls
  join desk_c  dc on dc.tenant_id = s.tenant_id and dc.name = bc.name
 where coalesce(s.class_id,'') <> ''
union
select distinct s.tenant_id, 'section', s.section_id, ds.id
  from public.sis_students s
  join blob_stu b  on b.tenant_id = s.tenant_id and b.sid = s.id::text
  join blob_s  bs  on bs.tenant_id = s.tenant_id and bs.id = b.bsec
  join blob_c  bpc on bpc.tenant_id = s.tenant_id and bpc.id = bs.cls
  join desk_c  dpc on dpc.tenant_id = s.tenant_id and dpc.name = bpc.name
  join desk_s  ds  on ds.tenant_id = s.tenant_id and ds.cls = dpc.id and ds.name = bs.name
 where coalesce(s.section_id,'') <> ''
union
select distinct s.tenant_id, 'campus', s.campus_id, dcm.id
  from public.sis_students s
  join blob_stu b   on b.tenant_id = s.tenant_id and b.sid = s.id::text
  join blob_cam bcm on bcm.tenant_id = s.tenant_id and bcm.id = b.bcam
  join desk_cam dcm on dcm.tenant_id = s.tenant_id and dcm.name = bcm.name
 where coalesce(s.campus_id,'') <> ''
union
select distinct s.tenant_id, 'fee_group', s.fee_group_id, dfg.id
  from public.sis_students s
  join blob_stu b   on b.tenant_id = s.tenant_id and b.sid = s.id::text
  join blob_fg  bfg on bfg.tenant_id = s.tenant_id and bfg.id = b.bfg
  join desk_fg  dfg on dfg.tenant_id = s.tenant_id and dfg.name = bfg.name
 where coalesce(s.fee_group_id,'') <> ''
union
select distinct l.tenant_id, 'class', l.class_sought_id, dc.id
  from public.admission_desk_leads l
  join blob_lead bl on bl.tenant_id = l.tenant_id and bl.lid = l.id::text
  join extinct   x  on x.old_id = bl.bcls
  join desk_c    dc on dc.tenant_id = l.tenant_id and dc.name = x.class_name
 where coalesce(l.class_sought_id,'') <> '';

delete from public._snapshot_repair_id_map where old_id = new_id;

do $$
declare dup int;
begin
  select count(*) into dup from (
    select tenant_id, kind, old_id from public._snapshot_repair_id_map
     group by 1,2,3 having count(distinct new_id) > 1
  ) x;
  if dup > 0 then
    raise exception 'ambiguous snapshot repair mapping for % key(s); aborting', dup;
  end if;
end $$;

update public.sis_students s
   set class_id = coalesce(
         (select new_id from public._snapshot_repair_id_map
           where tenant_id = s.tenant_id and kind = 'class' and old_id = s.class_id),
         s.class_id),
       section_id = coalesce(
         (select new_id from public._snapshot_repair_id_map
           where tenant_id = s.tenant_id and kind = 'section' and old_id = s.section_id),
         s.section_id),
       campus_id = coalesce(
         (select new_id from public._snapshot_repair_id_map
           where tenant_id = s.tenant_id and kind = 'campus' and old_id = s.campus_id),
         s.campus_id),
       fee_group_id = coalesce(
         (select new_id from public._snapshot_repair_id_map
           where tenant_id = s.tenant_id and kind = 'fee_group' and old_id = s.fee_group_id),
         s.fee_group_id),
       updated_at = now()
 where exists (
   select 1 from public._snapshot_repair_id_map m
    where m.tenant_id = s.tenant_id
      and ((m.kind = 'class'     and m.old_id = s.class_id)
        or (m.kind = 'section'   and m.old_id = s.section_id)
        or (m.kind = 'campus'    and m.old_id = s.campus_id)
        or (m.kind = 'fee_group' and m.old_id = s.fee_group_id))
 );

update public.admission_desk_leads l
   set class_sought_id = coalesce(
         (select m.new_id from public._snapshot_repair_id_map m
           where m.tenant_id = l.tenant_id and m.kind = 'class'
             and m.old_id = l.class_sought_id),
         l.class_sought_id),
       lead_json = l.lead_json
         || coalesce(
              (select jsonb_build_object('classSoughtId', m.new_id)
                 from public._snapshot_repair_id_map m
                where m.tenant_id = l.tenant_id and m.kind = 'class'
                  and m.old_id = l.lead_json ->> 'classSoughtId'),
              '{}'::jsonb)
         || coalesce(
              (select jsonb_build_object('classAdmittedId', m.new_id)
                 from public._snapshot_repair_id_map m
                where m.tenant_id = l.tenant_id and m.kind = 'class'
                  and m.old_id = l.lead_json ->> 'classAdmittedId'),
              '{}'::jsonb),
       updated_at = now()
 where exists (
   select 1 from public._snapshot_repair_id_map m
    where m.tenant_id = l.tenant_id and m.kind = 'class'
      and (m.old_id = l.class_sought_id
        or m.old_id = l.lead_json ->> 'classSoughtId'
        or m.old_id = l.lead_json ->> 'classAdmittedId')
 );

update public.rte_desk_seats r
   set class_id = m.new_id, updated_at = now()
  from public._snapshot_repair_id_map m
 where m.tenant_id = r.tenant_id and m.kind = 'class' and m.old_id = r.class_id;

do $$
declare bad int;
begin
  select
    (select count(*) from public.sis_students s
      where (coalesce(s.class_id,'') <> '' and not exists (
              select 1 from public.masters_desk_slices d, jsonb_array_elements(d.payload) e
               where d.tenant_id = s.tenant_id and d.slice_key='classes' and e->>'id' = s.class_id))
         or (coalesce(s.section_id,'') <> '' and not exists (
              select 1 from public.masters_desk_slices d, jsonb_array_elements(d.payload) e
               where d.tenant_id = s.tenant_id and d.slice_key='sections' and e->>'id' = s.section_id))
         or (coalesce(s.campus_id,'') <> '' and not exists (
              select 1 from public.masters_desk_slices d, jsonb_array_elements(d.payload) e
               where d.tenant_id = s.tenant_id and d.slice_key='campuses' and e->>'id' = s.campus_id))
         or (coalesce(s.fee_group_id,'') <> '' and not exists (
              select 1 from public.masters_desk_slices d, jsonb_array_elements(d.payload) e
               where d.tenant_id = s.tenant_id and d.slice_key='feeGroups' and e->>'id' = s.fee_group_id)))
    + (select count(*) from public.admission_desk_leads l
        where coalesce(l.class_sought_id,'') <> '' and not exists (
              select 1 from public.masters_desk_slices d, jsonb_array_elements(d.payload) e
               where d.tenant_id = l.tenant_id and d.slice_key='classes' and e->>'id' = l.class_sought_id))
    + (select count(*) from public.rte_desk_seats r
        where coalesce(r.class_id,'') <> '' and not exists (
              select 1 from public.masters_desk_slices d, jsonb_array_elements(d.payload) e
               where d.tenant_id = r.tenant_id and d.slice_key='classes' and e->>'id' = r.class_id))
    into bad;
  if bad > 0 then
    raise exception '% reference(s) still do not resolve against masters_desk_slices', bad;
  end if;
end $$;

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

drop table public._snapshot_repair_id_map;
