/*
 * Staff task tracking (proposed 30 Oct 2026 — PR draft, pending the
 * director's review of the design File).
 *
 * Director/office assigns a task to a member of staff; the assignee updates
 * progress and attaches completion evidence; the assigner reviews (accept or
 * return with a note). Distinct from what already exists:
 *   - staff duty roster  : recurring day duties, not tracked work items
 *   - staff requests     : staff -> office (the opposite direction)
 *   - office_tasks       : the n8n virtual staff room's board, role-keyed,
 *                          server-only, no ERP screen (20261021120000)
 *
 * APPLY TO PRODUCTION BEFORE THE APP THAT USES IT IS DEPLOYED. The screens
 * and routes fail closed ("could not load") until these tables exist, the
 * same contract as erp_notifications (20261020120000).
 *
 *   staff_tasks            one row per task. Soft-deleted (deleted_at), never
 *                          hard-removed: a reviewed task stays answerable.
 *   staff_task_updates     the append-only progress log: every progress note,
 *                          percent change and evidence item is a row, so an
 *                          update never erases an earlier one.
 *   staff_tasks_sync_meta  the change signal (erp_versions picks up every
 *                          *_sync_meta table at call time, key "staff_tasks").
 *
 * Ids are text ('st_…' / 'stu_…'), minted by the server route, matching the
 * kernel's text-id collections. Rows only through the server: RLS on,
 * anon/authenticated revoked, service_role granted.
 */

create table if not exists public.staff_tasks (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  detail text not null default '',
  -- sis_staff id of the assignee; resolved against the roster on every read,
  -- never a copied name.
  assignee_staff_id text not null check (assignee_staff_id <> ''),
  -- Who assigned it: sis_staff id, or the login label for a director/owner
  -- login with no roster row (pushSubject convention, 20261020120000).
  assigned_by text not null check (assigned_by <> ''),
  assigned_by_label text not null default '',
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  due_on date,
  status text not null default 'assigned'
    check (status in ('assigned', 'in_progress', 'submitted', 'returned', 'done', 'cancelled')),
  progress_pct int not null default 0 check (progress_pct between 0 and 100),
  evidence_required boolean not null default true,
  -- The review: who decided, when, and the note a returned task carries back
  -- to the assignee.
  reviewed_by text not null default '',
  reviewed_at timestamptz,
  review_note text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_tasks_assignee_idx
  on public.staff_tasks (tenant_id, assignee_staff_id, status, updated_at desc);
create index if not exists staff_tasks_board_idx
  on public.staff_tasks (tenant_id, status, due_on)
  where deleted_at is null;

create table if not exists public.staff_task_updates (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id text not null references public.staff_tasks(id) on delete cascade,
  author_staff_id text not null check (author_staff_id <> ''),
  pct int check (pct between 0 and 100),
  note text not null default '',
  -- [{kind: 'photo'|'file'|'link', name, path}] — storage paths, not bytes;
  -- upload reuses the homework attachment route's pattern.
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  created_at timestamptz not null default now()
);

create index if not exists staff_task_updates_task_idx
  on public.staff_task_updates (tenant_id, task_id, created_at desc);

create table if not exists public.staff_tasks_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  task_count int not null default 0,
  update_count int not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.staff_tasks is
  'Staff task tracking: director/office assigns, assignee reports progress, assigner reviews. Soft-deleted, never hard-removed.';
comment on table public.staff_task_updates is
  'Append-only progress log for staff_tasks: percent, note and evidence per row; an update never erases an earlier one.';
comment on table public.staff_tasks_sync_meta is
  'Change signal for staff tasks (erp_versions key staff_tasks).';

alter table public.staff_tasks enable row level security;
alter table public.staff_task_updates enable row level security;
alter table public.staff_tasks_sync_meta enable row level security;
revoke all on public.staff_tasks from public, anon, authenticated;
revoke all on public.staff_task_updates from public, anon, authenticated;
revoke all on public.staff_tasks_sync_meta from public, anon, authenticated;
grant select, insert, update, delete on public.staff_tasks to service_role;
grant select, insert, update, delete on public.staff_task_updates to service_role;
grant select, insert, update, delete on public.staff_tasks_sync_meta to service_role;

insert into public.desk_writable_tables (table_name, soft_delete, note, sync_meta_table, sync_count_column) values
  ('staff_tasks', true, 'Staff task tracking (30 Oct 2026): assign -> progress -> evidence -> review', 'staff_tasks_sync_meta', 'task_count'),
  ('staff_task_updates', false, 'Staff task progress log, append-only (30 Oct 2026)', 'staff_tasks_sync_meta', 'update_count')
on conflict (table_name) do update
  set sync_meta_table = excluded.sync_meta_table, sync_count_column = excluded.sync_count_column, note = excluded.note;

insert into public.staff_tasks_sync_meta (tenant_id, updated_at)
select t.id, now() from public.tenants t
on conflict (tenant_id) do nothing;

notify pgrst, 'reload schema';
