-- SIS identity/enrollment split — Phase 4: the write path that actually
-- closes the gap Phase 0 found.
--
-- Plan: docs/SIS_IDENTITY_ENROLLMENT_SPLIT_PLAN.md
-- There is no existing "promote to next year" flow anywhere in the app to
-- rewrite — checked in Phase 0: upgradeStudentClass (lib/classUpgrade.ts)
-- mutates a row's class/section in place and carries academic_year_code
-- forward UNCHANGED, and no year-rollover function exists at all. The 226
-- duplicated admission numbers in production were created directly,
-- almost certainly by a seed script, never through the app. This
-- function is new capability, not a rewrite of something that ran before.
--
-- sis_enrollments.status is a free-text column (not constrained to the
-- app's strict "active" | "inactive" union — that union lives in
-- SisStudent's TypeScript type and is enforced by normalizeStudent, 182
-- call sites across the app compare against it). This function introduces
-- one new DB-level value, 'promoted', for an enrollment a child has moved
-- on from. identityEnrollmentToStudent (lib/sisNormalized.server.ts) is
-- updated in the same change to fold anything other than the literal
-- 'active' into the app-facing "inactive" — so 'promoted' surfaces
-- correctly as not-current without touching any of those 182 call sites
-- or the app's own status type.
--
-- Atomic by construction: insert the new enrollment and mark the old one
-- 'promoted' inside one function, one transaction. Two separate Supabase
-- calls from Node would leave a real gap if the second one failed after
-- the first succeeded — a child with a new active enrollment AND an old
-- one still marked active, recreating exactly the bug this migration
-- exists to close. `for update` locks the source row for the duration,
-- so two promotions racing the same enrollment can't both succeed.
--
-- Not security definer, matching sis_push_guarded — this project's tables
-- are only ever reached via the service_role connection, which already
-- has full access, so there is nothing a definer would add here.

create or replace function public.sis_promote_enrollment(
  p_tenant_id uuid,
  p_from_enrollment_id text,
  p_to_academic_year_code text,
  p_to_class_id text,
  p_to_section_id text,
  p_to_campus_id text default null,
  p_to_fee_group_id text default null,
  p_to_student_type text default 'PROMOTE'
) returns jsonb
language plpgsql
as $$
declare
  v_from record;
  v_new_id text;
  v_existing text;
begin
  if p_to_academic_year_code is null or p_to_academic_year_code = '' then
    return jsonb_build_object('ok', false, 'error', 'target academic year is required');
  end if;
  if p_to_class_id is null or p_to_class_id = '' then
    return jsonb_build_object('ok', false, 'error', 'target class is required');
  end if;

  select * into v_from
    from public.sis_enrollments
    where id = p_from_enrollment_id and tenant_id = p_tenant_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'source enrollment not found');
  end if;
  if v_from.status <> 'active' then
    return jsonb_build_object(
      'ok', false,
      'error', 'source enrollment is not active — status is ' || v_from.status
    );
  end if;
  if v_from.academic_year_code = p_to_academic_year_code then
    return jsonb_build_object('ok', false, 'error', 'target year matches the source year');
  end if;

  select id into v_existing
    from public.sis_enrollments
    where identity_id = v_from.identity_id
      and academic_year_code = p_to_academic_year_code;

  if v_existing is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'an enrollment already exists for this identity in ' || p_to_academic_year_code,
      'existing_id', v_existing
    );
  end if;

  v_new_id := 'enr_' || substr(
    md5(v_from.identity_id || p_to_academic_year_code || clock_timestamp()::text),
    1, 12
  );

  insert into public.sis_enrollments (
    id, tenant_id, identity_id, academic_year_code, class_id, section_id,
    campus_id, roll_no, fee_group_id, student_type, status,
    promoted_from_enrollment_id
  ) values (
    v_new_id, p_tenant_id, v_from.identity_id, p_to_academic_year_code,
    p_to_class_id, p_to_section_id,
    coalesce(p_to_campus_id, v_from.campus_id, ''),
    -- Roll number is assigned fresh for the new class, not carried
    -- forward — matches the Students module's own bulk roll-number tool,
    -- which is per (class, section), not a value that transfers.
    '',
    coalesce(p_to_fee_group_id, v_from.fee_group_id, ''),
    p_to_student_type, 'active', p_from_enrollment_id
  );

  update public.sis_enrollments
    set status = 'promoted', updated_at = now()
    where id = p_from_enrollment_id;

  return jsonb_build_object('ok', true, 'new_enrollment_id', v_new_id);
end;
$$;

revoke all on function public.sis_promote_enrollment from public, anon, authenticated;
grant execute on function public.sis_promote_enrollment to service_role;
