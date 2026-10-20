-- Behavioural test for erp_notify_deliver and the notification tables
-- (20261020120000_erp_notifications).
--
-- Runs in CI against the E2E stack (every migration on Postgres 17):
--   bash scripts/e2e-stack.sh sql-test supabase/tests/erp_notify_deliver.test.sql
-- It makes its own probe school, works inside one transaction and rolls it
-- back — nothing it does survives. Any failed check raises.

\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok  %', what;
end $$;

create or replace function pg_temp.state_of(p_tenant uuid, p_rows jsonb) returns text language plpgsql as $$
declare v text;
begin
  perform public.erp_notify_deliver(p_tenant, p_rows);
  return 'ok';
exception when others then
  get stacked diagnostics v = returned_sqlstate;
  return v;
end $$;

do $test$
declare
  t uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  r jsonb; m1 timestamptz; m2 timestamptz; nid text; rev text; n int;
  leave jsonb := jsonb_build_object(
    'recipient_type','staff','recipient_id','stf_1','kind','staff_leave.requested','topic','approval',
    'dedupe_key','staff_leave:L1:requested','title','Leave request · Asha','body','CL 21 Oct',
    'link','/leave-approvals','web_link','/staff?tab=leave','payload',jsonb_build_object('requestId','L1'));
begin
  insert into public.tenants (id, slug, name) values (t, 'notify-probe-' || left(t::text, 8), 'Notify probe');
  insert into public.tenants (id, slug, name) values (other, 'notify-other-' || left(other::text, 8), 'Other school');

  -- ── Malformed rows are errors, and nothing is stored ────────────────────
  perform pg_temp.check(pg_temp.state_of(t, jsonb_build_array(leave - 'dedupe_key')) = '22023', 'a row without a dedupe key is refused');
  perform pg_temp.check(pg_temp.state_of(t, jsonb_build_array(leave || '{"recipient_type":"everyone"}')) = '22023',
    'a recipient that is not one person or one family is refused');
  perform pg_temp.check(pg_temp.state_of(t, jsonb_build_array(leave || '{"recipient_id":""}')) = '22023', 'a blank recipient is refused');
  perform pg_temp.check(pg_temp.state_of(t, jsonb_build_array(leave, leave || '{"title":""}')) = '22023',
    'one bad row in a batch refuses the batch');
  perform pg_temp.check(not exists (select 1 from public.erp_notifications where tenant_id = t), 'nothing stored by the refused batches');
  perform pg_temp.check(pg_temp.state_of(null, jsonb_build_array(leave)) = '22004', 'a tenant is required');

  -- ── Insert, then the same event again is a duplicate ────────────────────
  select updated_at into m1 from public.erp_notifications_sync_meta where tenant_id = t;
  r := public.erp_notify_deliver(t, jsonb_build_array(leave,
         leave || '{"recipient_id":"stf_2"}'));
  perform pg_temp.check((r->>'inserted')::int = 2, 'two recipients, two rows');
  perform pg_temp.check((select count(*) from public.erp_notifications where tenant_id = t) = 2, 'stored once per recipient');
  select updated_at, item_count into m2, n from public.erp_notifications_sync_meta where tenant_id = t;
  perform pg_temp.check(m2 > coalesce(m1, '-infinity'::timestamptz), 'the change signal moved');
  perform pg_temp.check(n = 2, 'item_count follows the rows');

  r := public.erp_notify_deliver(t, jsonb_build_array(leave));
  perform pg_temp.check((r->>'duplicate')::int = 1 and (r->>'inserted')::int = 0, 'a re-raised event is a duplicate');
  perform pg_temp.check((select count(*) from public.erp_notifications where tenant_id = t) = 2, 'no second row for it');
  perform pg_temp.check((select updated_at from public.erp_notifications_sync_meta where tenant_id = t) = m2,
    'a batch of duplicates does not move the signal');

  -- Another school, same recipient id and key: its own row.
  r := public.erp_notify_deliver(other, jsonb_build_array(leave));
  perform pg_temp.check((r->>'inserted')::int = 1, 'the dedupe is per school');

  -- ── Bursts fold into one unread row ─────────────────────────────────────
  for n in 1..5 loop
    r := public.erp_notify_deliver(t, jsonb_build_array(jsonb_build_object(
      'recipient_type','staff','recipient_id','stf_acc','kind','fees.received','topic','fees',
      'dedupe_key','fee:V' || n,'title','Fee received · ₹1,000','body','Receipt R' || n,
      'group_key','fees.received:2026-10-20','group_title','{n} fees received')));
  end loop;
  perform pg_temp.check((select count(*) from public.erp_notifications where tenant_id = t and recipient_id = 'stf_acc') = 1,
    'five receipts, one row for accounts');
  perform pg_temp.check((select group_count = 5 and title = '5 fees received' and body = 'Receipt R5'
                           from public.erp_notifications where tenant_id = t and recipient_id = 'stf_acc'),
    'the row says five, and shows the latest');
  perform pg_temp.check((r->'results'->0->>'outcome') = 'grouped', 'a folded event says grouped (no second ring)');
  r := public.erp_notify_deliver(t, jsonb_build_array(jsonb_build_object(
      'recipient_type','staff','recipient_id','stf_acc','kind','fees.received','topic','fees',
      'dedupe_key','fee:V3','title','Fee received','group_key','fees.received:2026-10-20')));
  perform pg_temp.check((r->>'duplicate')::int = 1, 'a receipt already folded in is not counted twice');

  -- Once read, the next receipt starts a new row.
  select id, updated_at::text into nid, rev from public.erp_notifications where tenant_id = t and recipient_id = 'stf_acc';
  r := public.desk_write_guarded(t, 'erp_notifications',
         jsonb_build_array(jsonb_build_object('op','upsert','id',nid,'base',rev,'row',jsonb_build_object('read_at', now()))));
  perform pg_temp.check((r->>'ok')::boolean and (r->>'applied')::int = 1, 'a reader marks it read through the kernel');
  r := public.desk_write_guarded(t, 'erp_notifications',
         jsonb_build_array(jsonb_build_object('op','upsert','id',nid,'base',rev,'row',jsonb_build_object('read_at', null))));
  perform pg_temp.check(not (r->>'ok')::boolean, 'a mark from an old copy is refused (stale base)');
  r := public.erp_notify_deliver(t, jsonb_build_array(jsonb_build_object(
      'recipient_type','staff','recipient_id','stf_acc','kind','fees.received','topic','fees',
      'dedupe_key','fee:V6','title','Fee received','group_key','fees.received:2026-10-20')));
  perform pg_temp.check((r->>'inserted')::int = 1, 'after reading, a new receipt is a new row');

  -- ── Settings rows go through the kernel ─────────────────────────────────
  r := public.desk_write_guarded(t, 'erp_notification_prefs', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','nfp_staff_stf_1','base',null,'row',jsonb_build_object(
           'recipient_type','staff','recipient_id','stf_1','muted_topics','["fees"]'::jsonb,'voice',false))));
  perform pg_temp.check((r->>'ok')::boolean, 'a person saves their settings');
  perform pg_temp.check((select muted_topics = '["fees"]'::jsonb and not voice and quiet_start = '21:00' and quiet_end = '07:00'
                           from public.erp_notification_prefs where id = 'nfp_staff_stf_1'),
    'muted topics and voice stored; quiet hours default 9 pm – 7 am');
  perform pg_temp.check((select pref_count = 1 from public.erp_notifications_sync_meta where tenant_id = t), 'pref_count follows');

  -- ── Grants ──────────────────────────────────────────────────────────────
  perform pg_temp.check(not has_function_privilege('anon', 'public.erp_notify_deliver(uuid, jsonb)', 'execute'), 'anon cannot deliver');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.erp_notify_deliver(uuid, jsonb)', 'execute'),
    'a signed-in browser cannot deliver');
  perform pg_temp.check(has_function_privilege('service_role', 'public.erp_notify_deliver(uuid, jsonb)', 'execute'), 'the server can');
  perform pg_temp.check(not has_table_privilege('anon', 'public.erp_notifications', 'select'), 'anon cannot read the inbox');
  perform pg_temp.check(has_table_privilege('service_role', 'public.erp_notifications', 'update'), 'service_role holds the table');
  perform pg_temp.check(has_table_privilege('service_role', 'public.erp_notifications_sync_meta', 'update'), 'service_role holds the signal');
end $test$;

rollback;
