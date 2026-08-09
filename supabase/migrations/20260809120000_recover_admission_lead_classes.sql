-- Recover the class on 889 admission leads.
--
-- Separate from 20260809110000 on purpose: that migration is a
-- name-based remap where every old id still exists in the blob, so the
-- mapping is a lookup. This one is partly an INFERENCE, and is kept on
-- its own so it can be reverted without undoing the safe repairs.
--
-- Two different problems in one table:
--
-- 1. classAdmittedId (4 leads) — ordinary blob ids. Remapped by name,
--    same as the other tables.
--
-- 2. classSoughtId (889 leads, 14 distinct ids) — these resolve against
--    NEITHER the desk tables nor the blob. They are a third, extinct
--    generation of masters ids with no definition left anywhere in the
--    database, so there is nothing to look up. Symptom: every one of
--    these leads renders Class as "—" and the class filter in Admission
--    Reports matches nothing.
--
--    Recovered instead from the import notes. Each lead carries
--    "Classes noted: …" copied from the original enquiry spreadsheet,
--    and the first class listed is the lead's own (later entries are
--    siblings in the same household). Grouping the notes by
--    classSoughtId gives a clean 1:1 result: 14 ids → 14 distinct
--    classes, no id mapping to two classes, and label variants inside a
--    group all agreeing ("1"/"1st", "3"/"3rd"/"Class 3").
--
--    Confidence and its limits, stated plainly: this is reconstruction
--    from text, not a preserved reference. 655 of the 889 leads have a
--    note that names their class directly; the other 234 are assigned
--    because they share a classSoughtId with those that do. The mapping
--    below is written as (extinct id → class NAME) so it is auditable
--    and so it resolves against whatever ids the classes currently have.
--
-- Snapshot taken before applying: admission_desk_leads_pre_idremap_20260809.
--
-- Deliberately NOT touched: sisMismatchNotes. It also contains old class
-- ids, but it is frozen human-readable audit text describing a past
-- match decision, not a live reference. Rewriting ids inside it would be
-- editing the record of what someone was shown at the time.
--
-- Idempotent: keyed on the extinct ids, so it matches nothing on a
-- second run.

-- ── 1. classAdmittedId → desk id, by name ───────────────────────────
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

-- ── 2. classSoughtId → desk id, via recovered class name ────────────
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

-- The column and the json copy must not disagree; the UI reads the json.
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
