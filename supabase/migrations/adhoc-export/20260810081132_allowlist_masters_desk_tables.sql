-- Stage 2.4 — grant desk_write_guarded write access to the masters tables.
--
-- Deliberately separate from the migrations that created and populated them
-- (20260810030000, 20260810040000). Adding a row here is a permission
-- change: until now the write guard refused every one of these tables with
-- 42501, no matter what the API or registry said. Two systems, two steps,
-- so neither can be done absent-mindedly.
--
-- Soft delete is false throughout. Masters rows are referenced by id from
-- students, leads and fee records; keeping a "deleted" row alive would leave
-- those references resolving to something the UI has hidden — a subtler
-- version of the orphaning this migration exists to prevent. The guard's
-- base-revision check still refuses a delete against a stale revision.

insert into public.desk_writable_tables (table_name, soft_delete, note) values
  ('masters_desk_classes',                 false, 'Stage 2 masters'),
  ('masters_desk_sections',                false, 'Stage 2 masters'),
  ('masters_desk_campuses',                false, 'Stage 2 masters'),
  ('masters_desk_academic_years',          false, 'Stage 2 masters; Stage 3 promotes this to session system of record'),
  ('masters_desk_academic_terms',          false, 'Stage 2 masters'),
  ('masters_desk_subjects',                false, 'Stage 2 masters'),
  ('masters_desk_class_subjects',          false, 'Stage 2 masters'),
  ('masters_desk_fee_head_categories',     false, 'Stage 2 masters'),
  ('masters_desk_fee_heads',               false, 'Stage 2 masters'),
  ('masters_desk_installments',            false, 'Stage 2 masters'),
  ('masters_desk_fee_groups',              false, 'Stage 2 masters'),
  ('masters_desk_fee_structure_lines',     false, 'Stage 2 masters; 268 rows, the largest slice'),
  ('masters_desk_late_fee_rules',          false, 'Stage 2 masters'),
  ('masters_desk_special_fees',            false, 'Stage 2 masters'),
  ('masters_desk_special_fee_assignments', false, 'Stage 2 masters'),
  ('masters_desk_concession_kinds',        false, 'Stage 2 masters'),
  ('masters_desk_concessions',             false, 'Stage 2 masters'),
  ('masters_desk_concession_grants',       false, 'Stage 2 masters'),
  ('masters_desk_senior_streams',          false, 'Stage 2 masters'),
  ('masters_desk_number_series',           false, 'Stage 2 masters'),
  ('masters_desk_holidays',                false, 'Stage 2 masters'),
  ('masters_desk_settings',                false, 'Stage 2 masters; schoolProfile/schoolTiming/midYearFeePolicy')
on conflict (table_name) do nothing;
