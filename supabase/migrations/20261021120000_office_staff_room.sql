/*
 * The virtual staff room's "office" tables (director, 20 Oct 2026).
 *
 * AI employees run in self-hosted n8n (automation/n8n) and coordinate
 * through these four tables rather than through ERP state: a task board,
 * a notes log, a meetings record and an AI-usage ledger. n8n writes here
 * with the service role; nothing in the ERP reads or writes them yet, and
 * the employees never write any other table — ERP state changes only
 * through the ERP's own authenticated routes.
 *
 * Additive and safe to re-run: every statement is IF NOT EXISTS or
 * drop-then-create.
 */

/* ─── office_tasks: the shared task board ───────────────────── */
-- Every meeting ends in rows here, never prose. An outward message (to a
-- parent, a vendor, the public) is a task with approval_state = 'pending'
-- until the director answers on WhatsApp.
create table if not exists public.office_tasks (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /** receptionist | academic_incharge | chair | director | ... (roster keys) */
  from_role text not null default '',
  to_role text not null default '',
  title text not null,
  detail text not null default '',
  status text not null default 'open'
    check (status in ('open', 'doing', 'done', 'cancelled')),
  due_on date,
  source text not null default 'huddle'
    check (source in ('huddle', 'receptionist', 'academic', 'director')),
  approval_state text not null default 'none'
    check (approval_state in ('none', 'pending', 'approved', 'rejected')),
  /** Whatever the workflow needs to finish the task: a drafted reply, the
   * Gmail thread id, the sender's address, the meeting id. */
  payload jsonb not null default '{}'::jsonb,
  decided_by text not null default '',
  decided_at timestamptz
);

create index if not exists office_tasks_open_idx
  on public.office_tasks (tenant_id, status, to_role, created_at desc);
create index if not exists office_tasks_pending_idx
  on public.office_tasks (tenant_id, created_at desc)
  where approval_state = 'pending';

comment on table public.office_tasks is
  'Virtual staff room task board (automation/n8n). Written by n8n with the service role; outward messages wait here with approval_state = pending.';

/* ─── office_notes: what each employee noted today ─────────── */
create table if not exists public.office_notes (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null default '',
  note_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  body text not null default '',
  /** Structured facts the note is built from (counts, ids), so the huddle
   * chair can read numbers rather than re-parse prose. */
  facts jsonb not null default '{}'::jsonb
);

create index if not exists office_notes_day_idx
  on public.office_notes (tenant_id, note_date desc, role);

comment on table public.office_notes is
  'Virtual staff room notes log: one row per employee per run. The morning huddle reads yesterday''s rows.';

/* ─── office_meetings: the huddle, kept whole ───────────────── */
create table if not exists public.office_meetings (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  meeting_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  kind text not null default 'huddle'
    check (kind in ('huddle', 'weekly')),
  agenda jsonb not null default '[]'::jsonb,
  /** [{role, text}] in speaking order — the chair's opening first. */
  transcript jsonb not null default '[]'::jsonb,
  minutes text not null default '',
  /** [{title, to_role, due_on, detail}] — each one also becomes an office_tasks row. */
  decisions jsonb not null default '[]'::jsonb
);

create index if not exists office_meetings_day_idx
  on public.office_meetings (tenant_id, meeting_date desc);

comment on table public.office_meetings is
  'Virtual staff room meetings: agenda, full transcript, minutes and decisions of each huddle.';

/* ─── office_ai_usage: every Claude call, with its cost ─────── */
create table if not exists public.office_ai_usage (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  workflow text not null default '',
  role text not null default '',
  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  /** Estimated from the public per-token price list at the time of the call. */
  est_cost_usd numeric(12, 6) not null default 0
);

create index if not exists office_ai_usage_day_idx
  on public.office_ai_usage (tenant_id, created_at desc);

comment on table public.office_ai_usage is
  'One row per Claude Messages API call made by the virtual staff room, with token counts and estimated USD cost.';

/* ─── RLS + grants ─────────────────────────────────────────── */
-- Every new table needs the service_role grant spelled out, or the server's
-- writes fail with a bare 42501 that reads like a bug in the caller.

alter table public.office_tasks enable row level security;
alter table public.office_notes enable row level security;
alter table public.office_meetings enable row level security;
alter table public.office_ai_usage enable row level security;

-- Server only (director, 22 Oct 2026): these hold the director's huddle
-- minutes, drafted replies to parents and AI cost — no signed-in browser
-- user (teacher, office) may read them. n8n uses the service role; any ERP
-- screen that shows them must read through a server route with its own
-- permission check.
drop policy if exists office_tasks_tenant_read on public.office_tasks;
drop policy if exists office_notes_tenant_read on public.office_notes;
drop policy if exists office_meetings_tenant_read on public.office_meetings;
drop policy if exists office_ai_usage_tenant_read on public.office_ai_usage;
revoke all on public.office_tasks, public.office_notes, public.office_meetings, public.office_ai_usage from public, anon, authenticated;
grant select, insert, update, delete on public.office_tasks, public.office_notes, public.office_meetings, public.office_ai_usage to service_role;
grant usage, select on sequence public.office_tasks_id_seq to service_role;
grant usage, select on sequence public.office_notes_id_seq to service_role;
grant usage, select on sequence public.office_meetings_id_seq to service_role;
grant usage, select on sequence public.office_ai_usage_id_seq to service_role;

notify pgrst, 'reload schema';
