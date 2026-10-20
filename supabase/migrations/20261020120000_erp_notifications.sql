-- Role-based activity notifications (director, 15 Oct 2026: "all approval,
-- document received, message received or whichever is happening in ERP —
-- every activity notification should reach the ERP as well as the app, with
-- voice notification, to every user based on roles").
--
-- APPLY TO PRODUCTION BEFORE THE APP THAT USES IT IS DEPLOYED. Without these
-- tables and erp_notify_deliver the new code fails closed: the bell and the
-- app's list answer "could not load", and an event that cannot be stored is
-- logged (the action that raised it — a leave, a payment — is never undone
-- or blocked by it). Nothing falls back to the old notifications blob.
--
-- One row per RECIPIENT (a member of staff, or a family), never one row per
-- event with an audience the browser filters: who receives an event is
-- decided on the server from roles, grants and relationships
-- (apps/web/src/lib/notify/audience.ts) and written here, so a browser can
-- only ever read its own rows.
--
--   erp_notifications         the inbox rows. Created only by
--                             erp_notify_deliver (below); the one change a
--                             reader makes — read_at — goes through
--                             desk_write_guarded (base = updated_at).
--   erp_notification_keys     one row per (recipient, dedupe key): the same
--                             event raised twice (a retried request, a
--                             re-delivered webhook) is stored once.
--   erp_notification_prefs    per person: muted topics, voice on/off, quiet
--                             hours. Written through desk_write_guarded.
--   erp_notifications_sync_meta
--                             the change signal (erp_versions key
--                             "erp_notifications"); bumped by both writers in
--                             the same transaction as the rows.
--
-- Recipient keys are the push-device keys (lib/pushSubject.ts):
--   ('staff',  <sis_staff id, or the login email for a director/owner login
--               with no roster row>)
--   ('parent', <sis_households id>)

-- ── Tables ────────────────────────────────────────────────────────────────

create table if not exists public.erp_notifications (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('staff', 'parent')),
  recipient_id text not null check (recipient_id <> ''),
  -- What happened, e.g. 'staff_leave.requested' (lib/notify/kinds.ts).
  kind text not null check (kind <> ''),
  -- The group a person can mute, e.g. 'approval', 'fees' (lib/notify/kinds.ts).
  topic text not null check (topic <> ''),
  title text not null check (title <> ''),
  body text not null default '',
  title_hi text not null default '',
  body_hi text not null default '',
  -- In-app route for the phone (e.g. '/leave-approvals'), and the ERP page.
  link text not null default '',
  web_link text not null default '',
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  urgent boolean not null default false,
  -- Burst batching: while a row with this key is unread (and young), later
  -- events with the same key update it (group_count + 1) instead of adding rows.
  group_key text,
  group_count int not null default 1 check (group_count >= 1),
  -- The first event's dedupe key (every key is in erp_notification_keys).
  dedupe_key text not null check (dedupe_key <> ''),
  -- Who caused it (display only), e.g. 'Asha Testwal'.
  actor text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists erp_notifications_recipient_idx
  on public.erp_notifications (tenant_id, recipient_type, recipient_id, updated_at desc);
create index if not exists erp_notifications_unread_idx
  on public.erp_notifications (tenant_id, recipient_type, recipient_id)
  where read_at is null;
create index if not exists erp_notifications_group_idx
  on public.erp_notifications (tenant_id, recipient_type, recipient_id, group_key)
  where read_at is null and group_key is not null;

create table if not exists public.erp_notification_keys (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipient_type text not null,
  recipient_id text not null,
  dedupe_key text not null,
  notification_id text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, recipient_type, recipient_id, dedupe_key)
);

create table if not exists public.erp_notification_prefs (
  -- 'nfp_<recipient_type>_<recipient_id>' (lib/notify/kinds.ts prefsRowId).
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('staff', 'parent')),
  recipient_id text not null check (recipient_id <> ''),
  -- Topics this person does not want pushed to the phone (still listed in the bell).
  muted_topics jsonb not null default '[]'::jsonb check (jsonb_typeof(muted_topics) = 'array'),
  -- false = the phone plays its normal sound, not the spoken line.
  voice boolean not null default true,
  -- Quiet hours in India time, 'HH:MM'. Inside them only urgent alerts reach the phone.
  quiet_enabled boolean not null default true,
  quiet_start text not null default '21:00' check (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end text not null default '07:00' check (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, recipient_type, recipient_id)
);

create table if not exists public.erp_notifications_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  item_count int not null default 0,
  pref_count int not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.erp_notifications is
  'Activity notifications, one row per recipient (staff member or family). Created only by erp_notify_deliver; read_at written through desk_write_guarded.';
comment on table public.erp_notification_keys is
  'Dedupe: one row per (recipient, event key). erp_notify_deliver stores an event once per recipient.';
comment on table public.erp_notification_prefs is
  'Per-person notification settings: muted topics, voice, quiet hours (IST). Written through desk_write_guarded.';
comment on table public.erp_notifications_sync_meta is
  'Change signal for notifications (erp_versions key erp_notifications).';

alter table public.erp_notifications enable row level security;
alter table public.erp_notification_keys enable row level security;
alter table public.erp_notification_prefs enable row level security;
alter table public.erp_notifications_sync_meta enable row level security;
revoke all on public.erp_notifications from public, anon, authenticated;
revoke all on public.erp_notification_keys from public, anon, authenticated;
revoke all on public.erp_notification_prefs from public, anon, authenticated;
revoke all on public.erp_notifications_sync_meta from public, anon, authenticated;
-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 while the request "succeeds".
grant select, insert, update, delete on public.erp_notifications to service_role;
grant select, insert, update, delete on public.erp_notification_keys to service_role;
grant select, insert, update, delete on public.erp_notification_prefs to service_role;
grant select, insert, update, delete on public.erp_notifications_sync_meta to service_role;

insert into public.desk_writable_tables (table_name, soft_delete, note, sync_meta_table, sync_count_column) values
  ('erp_notifications', false, 'Activity notifications (20 Oct 2026): readers set read_at only; rows are created by erp_notify_deliver', 'erp_notifications_sync_meta', 'item_count'),
  ('erp_notification_prefs', false, 'Notification settings per person (20 Oct 2026)', 'erp_notifications_sync_meta', 'pref_count')
on conflict (table_name) do update
  set sync_meta_table = excluded.sync_meta_table, sync_count_column = excluded.sync_count_column, note = excluded.note;

insert into public.erp_notifications_sync_meta (tenant_id, updated_at)
select t.id, now() from public.tenants t
on conflict (tenant_id) do nothing;

-- ── erp_notify_deliver ────────────────────────────────────────────────────
--
-- p_rows: [{recipient_type, recipient_id, kind, topic, dedupe_key, title,
--           body?, title_hi?, body_hi?, link?, web_link?, payload?, urgent?,
--           actor?, group_key?, group_window_minutes?, group_title?,
--           group_title_hi?}]
--
-- Per row, in order:
--   1. the (recipient, dedupe_key) pair was stored before  -> 'duplicate'
--   2. group_key given and this recipient has an UNREAD row with that key
--      created within group_window_minutes (default 180)   -> 'grouped':
--      that row's group_count + 1, its title becomes group_title with {n}
--      replaced by the new count (the summary, e.g. "{n} fees received" ->
--      "5 fees received"), its body the latest event's, and
--      it moves to the top (updated_at)
--   3. otherwise                                           -> 'inserted'
-- Returns {ok, results: [{recipient_type, recipient_id, id, outcome,
-- group_count}], inserted, grouped, duplicate}. The caller pushes to a
-- phone only for 'inserted' (a burst rings once).
--
-- All rows in one transaction; any malformed row raises 22023 and nothing
-- is stored. erp_notifications_sync_meta moves with the rows.
--
-- SECURITY DEFINER, search_path public, service_role only: the app calls it
-- through the service client (lib/notify/notify.server.ts).

create or replace function public.erp_notify_deliver(p_tenant uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  v_type text; v_rid text; v_key text; v_gkey text; v_win int;
  v_id text; v_existing text; v_count int; v_n int;
  now_ts timestamptz := clock_timestamp();
  results jsonb := '[]'::jsonb;
  n_ins int := 0; n_grp int := 0; n_dup int := 0;
begin
  if p_tenant is null then
    raise exception 'erp_notify_deliver: p_tenant is required' using errcode = '22004';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'erp_notify_deliver: rows must be an array' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'erp_notify_deliver: unknown tenant' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_type := item->>'recipient_type';
    v_rid := nullif(trim(coalesce(item->>'recipient_id', '')), '');
    v_key := nullif(trim(coalesce(item->>'dedupe_key', '')), '');
    if v_type is null or v_type not in ('staff', 'parent') then
      raise exception 'erp_notify_deliver: recipient_type must be staff or parent' using errcode = '22023';
    end if;
    if v_rid is null then
      raise exception 'erp_notify_deliver: recipient_id is required' using errcode = '22023';
    end if;
    if v_key is null then
      raise exception 'erp_notify_deliver: dedupe_key is required' using errcode = '22023';
    end if;
    if nullif(trim(coalesce(item->>'title', '')), '') is null
       or nullif(item->>'kind', '') is null or nullif(item->>'topic', '') is null then
      raise exception 'erp_notify_deliver: title, kind and topic are required' using errcode = '22023';
    end if;
    if item ? 'payload' and jsonb_typeof(item->'payload') <> 'object' then
      raise exception 'erp_notify_deliver: payload must be an object' using errcode = '22023';
    end if;

    v_id := 'nf_' || md5(p_tenant::text || '/' || v_type || '/' || v_rid || '/' || v_key);

    -- 1. Seen before?
    insert into public.erp_notification_keys (tenant_id, recipient_type, recipient_id, dedupe_key, notification_id, created_at)
    values (p_tenant, v_type, v_rid, v_key, v_id, now_ts)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      n_dup := n_dup + 1;
      select k.notification_id into v_existing from public.erp_notification_keys k
       where k.tenant_id = p_tenant and k.recipient_type = v_type and k.recipient_id = v_rid and k.dedupe_key = v_key;
      results := results || jsonb_build_array(jsonb_build_object(
        'recipient_type', v_type, 'recipient_id', v_rid, 'id', v_existing, 'outcome', 'duplicate'));
      continue;
    end if;

    -- 2. Fold into an unread row of the same burst?
    v_gkey := nullif(trim(coalesce(item->>'group_key', '')), '');
    v_existing := null;
    if v_gkey is not null then
      v_win := greatest(1, least(1440, coalesce(nullif(item->>'group_window_minutes', '')::int, 180)));
      select n.id into v_existing from public.erp_notifications n
       where n.tenant_id = p_tenant and n.recipient_type = v_type and n.recipient_id = v_rid
         and n.group_key = v_gkey and n.read_at is null
         and n.created_at > now_ts - make_interval(mins => v_win)
       order by n.created_at desc
       limit 1
       for update;
    end if;

    if v_existing is not null then
      update public.erp_notifications n
         set group_count = n.group_count + 1,
             title = replace(coalesce(nullif(item->>'group_title', ''), item->>'title'), '{n}', (n.group_count + 1)::text),
             title_hi = replace(coalesce(nullif(item->>'group_title_hi', ''), coalesce(item->>'title_hi', '')), '{n}', (n.group_count + 1)::text),
             body = coalesce(item->>'body', ''),
             body_hi = coalesce(item->>'body_hi', ''),
             link = coalesce(item->>'link', n.link),
             web_link = coalesce(item->>'web_link', n.web_link),
             payload = coalesce(item->'payload', n.payload),
             actor = coalesce(item->>'actor', n.actor),
             urgent = n.urgent or coalesce((item->>'urgent')::boolean, false),
             updated_at = greatest(now_ts, n.updated_at + interval '1 microsecond')
       where n.id = v_existing
       returning n.group_count into v_count;
      update public.erp_notification_keys k set notification_id = v_existing
       where k.tenant_id = p_tenant and k.recipient_type = v_type and k.recipient_id = v_rid and k.dedupe_key = v_key;
      n_grp := n_grp + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'recipient_type', v_type, 'recipient_id', v_rid, 'id', v_existing, 'outcome', 'grouped', 'group_count', v_count));
      continue;
    end if;

    -- 3. A new row.
    insert into public.erp_notifications (
      id, tenant_id, recipient_type, recipient_id, kind, topic, title, body, title_hi, body_hi,
      link, web_link, payload, urgent, group_key, group_count, dedupe_key, actor, created_at, updated_at)
    values (
      v_id, p_tenant, v_type, v_rid, item->>'kind', item->>'topic', trim(item->>'title'),
      coalesce(item->>'body', ''), coalesce(item->>'title_hi', ''), coalesce(item->>'body_hi', ''),
      coalesce(item->>'link', ''), coalesce(item->>'web_link', ''), coalesce(item->'payload', '{}'::jsonb),
      coalesce((item->>'urgent')::boolean, false), v_gkey, 1, v_key, coalesce(item->>'actor', ''), now_ts, now_ts)
    on conflict (id) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      -- The key row was removed by hand but the notification is still there.
      n_dup := n_dup + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'recipient_type', v_type, 'recipient_id', v_rid, 'id', v_id, 'outcome', 'duplicate'));
      continue;
    end if;
    n_ins := n_ins + 1;
    results := results || jsonb_build_array(jsonb_build_object(
      'recipient_type', v_type, 'recipient_id', v_rid, 'id', v_id, 'outcome', 'inserted', 'group_count', 1));
  end loop;

  -- The change signal moves with the rows, in this transaction.
  if n_ins + n_grp > 0 then
    insert into public.erp_notifications_sync_meta as m (tenant_id, item_count, updated_at)
    values (p_tenant, 0, now_ts)
    on conflict (tenant_id) do update
      set updated_at = greatest(excluded.updated_at, m.updated_at + interval '1 microsecond');
    update public.erp_notifications_sync_meta
       set item_count = (select count(*) from public.erp_notifications x where x.tenant_id = p_tenant)
     where tenant_id = p_tenant;
  end if;

  return jsonb_build_object('ok', true, 'results', results,
    'inserted', n_ins, 'grouped', n_grp, 'duplicate', n_dup);
end $$;

revoke all on function public.erp_notify_deliver(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.erp_notify_deliver(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
