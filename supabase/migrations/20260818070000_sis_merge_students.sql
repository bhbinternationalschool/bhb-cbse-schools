-- sis_merge_students: fold duplicate student rows into one kept row, moving
-- every linked record with them, in one transaction.
--
-- Until 2026-08-18 "merge duplicates" in the SIS desk only removed the
-- dropped rows from the browser copy; the roster push upserts, so the rows
-- came back on the next hydrate, and nothing that pointed at the dropped
-- ids (fee receipt lines, attendance marks, exam marks, homework, PTM,
-- leave, library, store, payment links, concessions, curriculum, admission
-- leads, chat) was ever moved. This function does both.
--
-- Rules
--   * p_keep_id must exist for the tenant; drop ids that do not exist are
--     ignored (already gone), the keep id is never dropped.
--   * student_id references move to the kept id. Where a table has a
--     uniqueness rule that would collide (the kept student already has a
--     row for the same register / mark sheet / post / term / curriculum
--     year), the kept student's row wins and the dropped student's row is
--     deleted.
--   * fee_desk_open_dues rows for dropped ids are deleted (the cache is
--     rebuilt from vouchers on the next fees push).
--   * Households: if a dropped student was the last student of its
--     household and that household is not the kept student's, every
--     household-scoped record (fee vouchers, cheques, charge vouchers,
--     installment plans, payment links, admission leads, PTM bookings,
--     leave requests, store issues, homework seen, WA media) moves to the
--     kept student's household and the empty household is deleted.
--   * Finally the dropped sis_students rows are deleted and sis_sync_meta
--     is refreshed. Returns a jsonb summary of what moved.

create or replace function public.sis_merge_students(
  p_tenant_id uuid,
  p_keep_id   text,
  p_drop_ids  text[]
)
returns jsonb
language plpgsql
set search_path to 'public'
set statement_timeout to '60s'
as $$
declare
  keep_hh   text;
  drops     text[];
  drop_hhs  text[];
  moved     jsonb := '{}'::jsonb;
  n         int;
  now_ts    timestamptz := now();
begin
  if p_keep_id is null or p_keep_id = '' then
    raise exception 'sis_merge_students: keep id required';
  end if;

  select household_id into keep_hh
    from public.sis_students
   where tenant_id = p_tenant_id and id = p_keep_id;
  if not found then
    raise exception 'sis_merge_students: kept student % not found', p_keep_id;
  end if;

  -- Only ids that exist for this tenant, never the kept one.
  select coalesce(array_agg(s.id), '{}') into drops
    from public.sis_students s
   where s.tenant_id = p_tenant_id
     and s.id = any(coalesce(p_drop_ids, '{}'))
     and s.id <> p_keep_id;
  if coalesce(array_length(drops, 1), 0) = 0 then
    return jsonb_build_object('kept', p_keep_id, 'dropped', 0, 'moved', moved);
  end if;

  perform pg_advisory_xact_lock(hashtext('sis_merge:' || p_tenant_id::text));

  -- Households of the dropped students that would be left empty and are
  -- not the kept student's own household.
  select coalesce(array_agg(distinct d.household_id), '{}') into drop_hhs
    from public.sis_students d
   where d.tenant_id = p_tenant_id and d.id = any(drops)
     and d.household_id is not null and d.household_id <> ''
     and (keep_hh is null or d.household_id <> keep_hh)
     and not exists (
       select 1 from public.sis_students o
        where o.tenant_id = p_tenant_id
          and o.household_id = d.household_id
          and o.id <> all(drops)
     );

  -- ── student_id references: uniqueness-guarded tables first ─────────────
  -- attendance_desk_marks (register_id, student_id)
  delete from public.attendance_desk_marks d
   where d.tenant_id = p_tenant_id and d.student_id = any(drops)
     and exists (select 1 from public.attendance_desk_marks k
                  where k.tenant_id = p_tenant_id and k.register_id = d.register_id and k.student_id = p_keep_id);
  update public.attendance_desk_marks set student_id = p_keep_id
   where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('attendance_desk_marks', n);

  -- exam_desk_marks (mark_sheet_id, student_id, subject_id)
  delete from public.exam_desk_marks d
   where d.tenant_id = p_tenant_id and d.student_id = any(drops)
     and exists (select 1 from public.exam_desk_marks k
                  where k.tenant_id = p_tenant_id and k.mark_sheet_id = d.mark_sheet_id
                    and k.subject_id = d.subject_id and k.student_id = p_keep_id);
  update public.exam_desk_marks set student_id = p_keep_id
   where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('exam_desk_marks', n);

  -- exam_desk_coscholastic (mark_sheet_id, student_id, domain)
  delete from public.exam_desk_coscholastic d
   where d.tenant_id = p_tenant_id and d.student_id = any(drops)
     and exists (select 1 from public.exam_desk_coscholastic k
                  where k.tenant_id = p_tenant_id and k.mark_sheet_id = d.mark_sheet_id
                    and k.domain = d.domain and k.student_id = p_keep_id);
  update public.exam_desk_coscholastic set student_id = p_keep_id
   where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('exam_desk_coscholastic', n);

  -- exam_desk_promotions (tenant_id, student_id, exam_term_id, academic_year_code)
  delete from public.exam_desk_promotions d
   where d.tenant_id = p_tenant_id and d.student_id = any(drops)
     and exists (select 1 from public.exam_desk_promotions k
                  where k.tenant_id = p_tenant_id and k.exam_term_id = d.exam_term_id
                    and k.academic_year_code = d.academic_year_code and k.student_id = p_keep_id);
  update public.exam_desk_promotions set student_id = p_keep_id
   where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('exam_desk_promotions', n);

  -- homework_desk_seen (kind, ref_id, student_id)
  delete from public.homework_desk_seen d
   where d.tenant_id = p_tenant_id and d.student_id = any(drops)
     and exists (select 1 from public.homework_desk_seen k
                  where k.tenant_id = p_tenant_id and k.kind = d.kind and k.ref_id = d.ref_id and k.student_id = p_keep_id);
  update public.homework_desk_seen set student_id = p_keep_id
   where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('homework_desk_seen', n);

  -- homework_desk_submissions (post_id, student_id)
  delete from public.homework_desk_submissions d
   where d.tenant_id = p_tenant_id and d.student_id = any(drops)
     and exists (select 1 from public.homework_desk_submissions k
                  where k.tenant_id = p_tenant_id and k.post_id = d.post_id and k.student_id = p_keep_id);
  update public.homework_desk_submissions set student_id = p_keep_id
   where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('homework_desk_submissions', n);

  -- student_curriculum (tenant_id, student_key, academic_year_code)
  delete from public.student_curriculum d
   where d.tenant_id = p_tenant_id and d.student_key = any(drops)
     and exists (select 1 from public.student_curriculum k
                  where k.tenant_id = p_tenant_id and k.academic_year_code = d.academic_year_code and k.student_key = p_keep_id);
  update public.student_curriculum set student_key = p_keep_id
   where tenant_id = p_tenant_id and student_key = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('student_curriculum', n);

  -- fee_desk_open_dues: PK includes student_id; cache is rebuilt anyway.
  delete from public.fee_desk_open_dues
   where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('fee_desk_open_dues_deleted', n);

  -- ── student_id references: plain updates ───────────────────────────────
  update public.attendance_desk_absent_nudges set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('attendance_desk_absent_nudges', n);
  update public.attendance_desk_exceptions set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('attendance_desk_exceptions', n);
  update public.fee_desk_voucher_lines set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('fee_desk_voucher_lines', n);
  update public.fee_desk_carried_forward set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('fee_desk_carried_forward', n);
  update public.fee_desk_charge_vouchers set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('fee_desk_charge_vouchers', n);
  update public.fee_desk_installment_plans set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('fee_desk_installment_plans', n);
  update public.library_desk_issues set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('library_desk_issues', n);
  update public.masters_desk_concession_grants set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('masters_desk_concession_grants', n);
  update public.masters_desk_special_fee_assignments set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('masters_desk_special_fee_assignments', n);
  update public.payment_desk_link_lines set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('payment_desk_link_lines', n);
  update public.payment_desk_links set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('payment_desk_links', n);
  update public.ptm_desk_bookings set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('ptm_desk_bookings', n);
  update public.ptm_desk_feedback set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('ptm_desk_feedback', n);
  update public.rte_desk_applications set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('rte_desk_applications', n);
  update public.store_desk_issues set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('store_desk_issues', n);
  update public.store_desk_sell_returns set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('store_desk_sell_returns', n);
  update public.student_leave_desk_requests set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('student_leave_desk_requests', n);
  update public.admission_desk_leads set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('admission_desk_leads.student_id', n);
  update public.admission_desk_leads set sis_student_id = p_keep_id where tenant_id = p_tenant_id and sis_student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('admission_desk_leads.sis_student_id', n);
  update public.chat_messages set student_id = p_keep_id where tenant_id = p_tenant_id and student_id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('chat_messages', n);

  -- ── households left empty by the drop → kept student's household ───────
  if keep_hh is not null and keep_hh <> '' and coalesce(array_length(drop_hhs, 1), 0) > 0 then
    update public.fee_desk_vouchers set household_id = keep_hh where tenant_id = p_tenant_id and household_id = any(drop_hhs);
    get diagnostics n = row_count; moved := moved || jsonb_build_object('fee_desk_vouchers.household', n);
    update public.fee_desk_cheques set household_id = keep_hh where tenant_id = p_tenant_id and household_id = any(drop_hhs);
    update public.fee_desk_charge_vouchers set household_id = keep_hh where tenant_id = p_tenant_id and household_id = any(drop_hhs);
    update public.fee_desk_installment_plans set household_id = keep_hh where tenant_id = p_tenant_id and household_id = any(drop_hhs);
    update public.payment_desk_links set household_id = keep_hh where tenant_id = p_tenant_id and household_id = any(drop_hhs);
    update public.admission_desk_leads set household_id = keep_hh where tenant_id = p_tenant_id and household_id = any(drop_hhs);
    update public.homework_desk_seen set household_id = keep_hh where tenant_id = p_tenant_id and household_id = any(drop_hhs);
    update public.ptm_desk_bookings set household_id = keep_hh where tenant_id = p_tenant_id and household_id = any(drop_hhs);
    update public.student_leave_desk_requests set household_id = keep_hh where tenant_id = p_tenant_id and household_id = any(drop_hhs);
    update public.store_desk_issues set household_id = keep_hh where tenant_id = p_tenant_id and household_id = any(drop_hhs);
    update public.wa_inbound_media set household_id = keep_hh where tenant_id = p_tenant_id and household_id = any(drop_hhs);
    -- Households that were also referenced by fee_desk_open_dues get their
    -- rows recomputed on the next fees push; nothing to do here.
  end if;

  -- ── drop the duplicate rows ────────────────────────────────────────────
  delete from public.sis_students where tenant_id = p_tenant_id and id = any(drops);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('sis_students_deleted', n);

  if coalesce(array_length(drop_hhs, 1), 0) > 0 then
    delete from public.sis_households where tenant_id = p_tenant_id and id = any(drop_hhs);
    get diagnostics n = row_count; moved := moved || jsonb_build_object('sis_households_deleted', n);
  end if;

  insert into public.sis_sync_meta as m (tenant_id, household_count, student_count, active_student_count, updated_at)
  values (
    p_tenant_id,
    (select count(*) from public.sis_households where tenant_id = p_tenant_id),
    (select count(*) from public.sis_students where tenant_id = p_tenant_id),
    (select count(*) from public.sis_students where tenant_id = p_tenant_id and status = 'active'),
    now_ts
  )
  on conflict (tenant_id) do update set
    household_count = excluded.household_count,
    student_count = excluded.student_count,
    active_student_count = excluded.active_student_count,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'kept', p_keep_id,
    'dropped', coalesce(array_length(drops, 1), 0),
    'droppedIds', to_jsonb(drops),
    'householdsFolded', to_jsonb(drop_hhs),
    'moved', moved
  );
end;
$$;

revoke all on function public.sis_merge_students(uuid, text, text[]) from public;
grant execute on function public.sis_merge_students(uuid, text, text[]) to service_role;
