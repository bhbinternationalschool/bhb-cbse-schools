-- Repair: every student pointed at class/section IDs that no longer existed.
--
-- Symptom: the Students dashboard showed several different counts all
-- labelled "Unassigned", and filtering the roster by class returned
-- nothing.
--
-- Cause: masters were re-seeded into masters_desk_slices with freshly
-- generated ids, while the 711 student records kept the ids from the
-- original school_mirror_state blob. Once the app cut over to reading
-- masters from the desk tables, no student's class_id or section_id
-- resolved — 0 of 13 distinct class ids matched. This is the blob →
-- normalized cutover hazard: the normalized copy was a re-seed, not a
-- migration of the blob.
--
-- Fix: remap each student from the blob id → the desk id with the same
-- class name, and the same section name within that class. The mapping
-- is 1:1 and total — 15 class names and 15 section pairs, covering all
-- 711 students with nothing unmappable.
--
-- Verified before and after: the student count per class name is
-- identical (LKG 107, Nursery 92, UKG 86, I 69, II 72, III 55, IV 57,
-- V 52, VI 46, VII 29, VIII 22, IX 13, X 11 = 711), all 711 sections
-- resolve, and every section belongs to its own student's class.
--
-- Already applied to production on 2026-08-09 after snapshotting
-- sis_students to sis_students_pre_classremap_20260809. Written as a
-- migration so the repair is recorded rather than existing only as an
-- ad-hoc query, and so a restored-from-backup database can be repaired
-- the same way. It is a no-op once ids already resolve.
--
-- Class-keyed data elsewhere was checked and is unaffected:
-- classSubjects already referenced the desk ids, and feeStructureLines
-- are keyed by fee group rather than class.

with blob_c as (
  select c ->> 'id' as id, c ->> 'name' as name
  from public.school_mirror_state, jsonb_array_elements(state->'masters'->'classes') c
),
desk_c as (
  select c ->> 'id' as id, c ->> 'name' as name
  from public.masters_desk_slices, jsonb_array_elements(payload) c
  where slice_key = 'classes'
),
blob_s as (
  select s ->> 'id' as id, s ->> 'name' as name, s ->> 'classId' as class_id
  from public.school_mirror_state, jsonb_array_elements(state->'masters'->'sections') s
),
desk_s as (
  select s ->> 'id' as id, s ->> 'name' as name, s ->> 'classId' as class_id
  from public.masters_desk_slices, jsonb_array_elements(payload) s
  where slice_key = 'sections'
),
class_map as (
  select b.id as old_id, d.id as new_id
  from blob_c b join desk_c d on d.name = b.name
),
section_map as (
  select bs.id as old_id, ds.id as new_id
  from blob_s bs
  join blob_c bc on bc.id = bs.class_id
  join desk_c dc on dc.name = bc.name
  join desk_s ds on ds.class_id = dc.id and ds.name = bs.name
)
update public.sis_students s
   set class_id   = coalesce(cm.new_id, s.class_id),
       section_id = coalesce(sm.new_id, s.section_id),
       updated_at = now()
  from class_map cm
  left join section_map sm on true
 where cm.old_id = s.class_id
   and (sm.old_id = s.section_id or coalesce(s.section_id, '') = '');
