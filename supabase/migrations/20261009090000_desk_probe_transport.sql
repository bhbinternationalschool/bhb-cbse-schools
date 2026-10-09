-- desk_probe: allow transport_desk_slices.
--
-- schoolMirrorRemote's pre-pull probe has listed transport_desk_slices since
-- 16 Sep 2026 (a bus fee must invalidate the mirror like a receipt does), but
-- the function's allowlist never got it. Every probe raised
-- "desk_probe: table transport_desk_slices not allowlisted" (417 POST
-- /rpc/desk_probe 400s in one evening), so the probe failed open and the
-- server re-pulled the whole school mirror far more often than it needed to —
-- slower app and ERP screens and the Supabase egress the probe exists to save.
-- Same body as 20260820120000_desk_probe.sql plus the one table.

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
    'transport_desk_slices'
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
