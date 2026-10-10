-- SIS identity/enrollment split — Phase 2: backfill.
--
-- Plan: docs/SIS_IDENTITY_ENROLLMENT_SPLIT_PLAN.md
-- Grouping key is (tenant_id, admission_no) alone — Phase 0 checked every
-- one of the 226 duplicated admission numbers and found zero cases of two
-- different children sharing a number, so this is a validated key, not an
-- assumption.
--
-- Identity fields are sourced from each group's most recent
-- academic_year_code row. Phase 0 found 21 groups where name spelling or
-- household_id drifted across years (typo'd names, a household row
-- re-created after a phone number changed) — taking the latest row makes
-- the identity reflect what's currently believed true, rather than
-- requiring a manual decision per case.
--
-- sis_students is not modified. Every field copied through coalesce(...,
-- '') — dry run first attempt hit a NOT NULL violation on household_id;
-- real rows have NULL where the new schema expects '', across more than
-- one column.
--
-- The DO block at the end asserts exact expected counts before allowing
-- the transaction to commit — 273 identities (one per unique admission
-- number), 719 enrollments (one per existing sis_students row), zero
-- orphaned identity_id, zero duplicate (identity_id, academic_year_code)
-- pairs. Any mismatch raises and the whole migration rolls back — dry-run
-- confirmed clean against live data immediately before this was written.

insert into public.sis_student_identities (
  id, tenant_id, admission_no, full_name, gender, dob,
  father_name, mother_name, father_mobile, mother_mobile,
  father_aadhaar_last4, mother_aadhaar_last4, father_pan, mother_pan,
  guardian_relation, emergency_name, emergency_mobile, household_id,
  blood_group, religion, category, nationality, mother_tongue,
  place_of_birth, aadhaar_last4, pen, pen_status, apaar_id, srn,
  previous_school, previous_tc_no, previous_udise, docs, notes, photo_url
)
select distinct on (s.tenant_id, s.admission_no)
  'sid_' || substr(md5(s.tenant_id::text || s.admission_no), 1, 12),
  s.tenant_id, s.admission_no,
  coalesce(s.full_name,''), coalesce(s.gender,''), s.dob,
  coalesce(s.father_name,''), coalesce(s.mother_name,''),
  coalesce(s.father_mobile,''), coalesce(s.mother_mobile,''),
  coalesce(s.father_aadhaar_last4,''), coalesce(s.mother_aadhaar_last4,''),
  coalesce(s.father_pan,''), coalesce(s.mother_pan,''),
  coalesce(s.guardian_relation,''), coalesce(s.emergency_name,''),
  coalesce(s.emergency_mobile,''), coalesce(s.household_id,''),
  coalesce(s.blood_group,''), coalesce(s.religion,''), coalesce(s.category,''),
  coalesce(s.nationality,''), coalesce(s.mother_tongue,''),
  coalesce(s.place_of_birth,''), coalesce(s.aadhaar_last4,''),
  coalesce(s.pen,''), coalesce(s.pen_status,''), coalesce(s.apaar_id,''),
  coalesce(s.srn,''), coalesce(s.previous_school,''),
  coalesce(s.previous_tc_no,''), coalesce(s.previous_udise,''),
  coalesce(s.docs,'{}'::jsonb), coalesce(s.notes,''), coalesce(s.photo_url,'')
from public.sis_students s
order by s.tenant_id, s.admission_no, s.academic_year_code desc, s.updated_at desc;

insert into public.sis_enrollments (
  id, tenant_id, identity_id, academic_year_code, class_id, section_id,
  campus_id, roll_no, fee_group_id, student_type, status, joined_on
)
select
  'enr_' || substr(md5(s.id), 1, 12),
  s.tenant_id, i.id, s.academic_year_code,
  coalesce(s.class_id,''), coalesce(s.section_id,''), coalesce(s.campus_id,''),
  coalesce(s.roll_no,''), coalesce(s.fee_group_id,''),
  coalesce(s.student_type,''), coalesce(s.status,'active'), s.joined_on
from public.sis_students s
join public.sis_student_identities i
  on i.tenant_id = s.tenant_id and i.admission_no = s.admission_no;

do $$
declare
  n_identities int; n_enrollments int;
  n_expected_identities int; n_expected_enrollments int;
  n_orphans int; n_dup_enrollment_years int;
begin
  select count(*) into n_identities from public.sis_student_identities;
  select count(*) into n_enrollments from public.sis_enrollments;
  select count(distinct tenant_id || '|' || admission_no)
    into n_expected_identities from public.sis_students;
  select count(*) into n_expected_enrollments from public.sis_students;
  select count(*) into n_orphans
    from public.sis_enrollments e
    where not exists (
      select 1 from public.sis_student_identities i where i.id = e.identity_id
    );
  select count(*) into n_dup_enrollment_years from (
    select identity_id, academic_year_code from public.sis_enrollments
    group by identity_id, academic_year_code having count(*) > 1
  ) x;

  if n_identities <> n_expected_identities then
    raise exception 'identity count mismatch: got % expected %',
      n_identities, n_expected_identities;
  end if;
  if n_enrollments <> n_expected_enrollments then
    raise exception 'enrollment count mismatch: got % expected %',
      n_enrollments, n_expected_enrollments;
  end if;
  if n_orphans <> 0 then
    raise exception 'orphaned enrollments: %', n_orphans;
  end if;
  if n_dup_enrollment_years <> 0 then
    raise exception 'duplicate identity+year enrollments: %', n_dup_enrollment_years;
  end if;
end $$;
