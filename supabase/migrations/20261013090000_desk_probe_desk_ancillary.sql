-- desk_probe: allow the desk ancillary tables (data-layer 0.5f).
--
-- Three probe-cached GET routes build their bodies from more tables than
-- their probe lists named, so a change to an unlisted table did not move the
-- fingerprint and the cached body was served stale:
--   fees-vouchers        — cheques, day closes, installment plans, plan
--                          allocations, carried-forward dues, charge vouchers
--                          (+ lines), manual receipt books (desk.ancillary)
--   attendance-registers — policy, exceptions, absent nudges (desk.ancillary)
--   sis-roster           — student tags, class upgrades
-- The routes now list them (apps/web/src/lib/deskProbeTables.ts). desk_probe
-- RAISES for any table outside its allowlist, which fails the probe open and
-- re-reads the whole desk on every request (the 9 Oct 2026 incident), so this
-- migration MUST be applied before the code that lists them is deployed.
--
-- Same body, SECURITY DEFINER, search_path and grants as
-- 20261009090000_desk_probe_transport.sql, plus the thirteen tables. Every
-- one has tenant_id. fee_desk_plan_allocations and
-- fee_desk_charge_voucher_lines have no updated_at and are probed by count
-- (the function already handles that).

create or replace function public.desk_probe(p_tenant uuid, p_tables text[])
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  allowed constant text[] := array[
    'sis_students','sis_households','sis_enrollments','sis_staff',
    'sis_departments','sis_designations','sis_student_identities',
    'admission_desk_leads','admission_desk_households',
    'admission_desk_registration_payments','admission_desk_field_ops',
    'fee_desk_vouchers','fee_desk_voucher_lines','fee_desk_voucher_tenders',
    'fee_desk_open_dues',
    'payment_desk_links','payment_desk_link_lines','payment_desk_gateway_events',
    'masters_desk_slices','masters_desk_settings',
    'module_local_state','school_kb_chunks',
    'staff_geo_last','staff_geo_incidents',
    'school_events','event_rsvps',
    'exam_desk_sheets','exam_desk_item_scores','exam_desk_remarks',
    'attendance_desk_registers','attendance_desk_marks',
    'staff_attendance_desk_registers','staff_attendance_desk_marks',
    'transport_desk_slices',
    -- 13 Oct 2026 (data-layer 0.5f): the rest of what the fees-vouchers,
    -- attendance-registers and sis-roster bodies are built from.
    'fee_desk_cheques','fee_desk_day_closes','fee_desk_installment_plans',
    'fee_desk_plan_allocations','fee_desk_carried_forward',
    'fee_desk_charge_vouchers','fee_desk_charge_voucher_lines',
    'fee_desk_manual_books',
    'attendance_desk_policy','attendance_desk_exceptions',
    'attendance_desk_absent_nudges',
    'sis_student_tags','sis_class_upgrades'
  ];
  t text;
  part text;
  acc text := 'v1';
  has_updated boolean;
begin
  if p_tables is null or array_length(p_tables, 1) is null then
    return null;
  end if;
  foreach t in array p_tables loop
    if not (t = any(allowed)) then
      raise exception 'desk_probe: table % not allowlisted', t;
    end if;
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) into has_updated;
    if has_updated then
      execute format(
        'select coalesce(count(*),0)::text || ''|'' || coalesce(max(updated_at)::text, '''') from public.%I where tenant_id = $1',
        t
      ) into part using p_tenant;
    else
      execute format(
        'select coalesce(count(*),0)::text from public.%I where tenant_id = $1',
        t
      ) into part using p_tenant;
    end if;
    acc := acc || ';' || t || '=' || coalesce(part, '');
  end loop;
  return md5(acc);
end;
$function$;

-- Same grants as the original (create or replace keeps them; restated so the
-- function stays service_role-only however the history is replayed).
revoke all on function public.desk_probe(uuid, text[]) from public;
revoke all on function public.desk_probe(uuid, text[]) from anon;
revoke all on function public.desk_probe(uuid, text[]) from authenticated;
grant execute on function public.desk_probe(uuid, text[]) to service_role;
