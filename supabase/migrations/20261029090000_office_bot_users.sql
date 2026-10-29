/*
 * Telegram bot users for the virtual staff room (director, 29 Oct 2026).
 * See automation/n8n (the "Office: Telegram bot" workflow).
 *
 * Until now the bot recognised exactly two chats, both from env
 * (TELEGRAM_DIRECTOR_CHAT_ID, TELEGRAM_PRINCIPAL_CHAT_ID). This table lets the
 * director register more people from within Telegram (/adduser) without an env
 * change or a redeploy. An added user has role 'reader': they RECEIVE the
 * broadcasts the principal gets (morning notes, huddle) and may use the read
 * commands (/tasks, /huddle, /plan, /marketing, /transport). They can NOT
 * approve drafts, close tasks, set budgets, or drive the assistant — those stay
 * director-only, enforced in the bot's parse step. The env director/principal
 * still take precedence; this table only adds people.
 *
 * Additive and safe to re-run.
 */

create table if not exists public.office_bot_users (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  /** Telegram chat id, as a string (ids can exceed 32-bit). */
  chat_id text not null,
  /** 'reader' for a /adduser person; 'principal'/'director' reserved for
   * completeness (the env values remain the primary director/principal). */
  role text not null default 'reader'
    check (role in ('reader', 'principal', 'director')),
  name text not null default '',
  /** Who added them (the director's chat id or 'director'). */
  added_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (tenant_id, chat_id)
);

create index if not exists office_bot_users_active_idx
  on public.office_bot_users (tenant_id, is_active);

comment on table public.office_bot_users is
  'Telegram office-bot users the director adds from chat (/adduser). role=reader receives the principal broadcasts and may use the read commands; approvals/close/budget/assistant stay director-only. env director/principal take precedence.';

/* ─── RLS + grants (server only, like the other office_* tables) ──── */
alter table public.office_bot_users enable row level security;
revoke all on public.office_bot_users from public, anon, authenticated;
grant select, insert, update, delete on public.office_bot_users to service_role;
grant usage, select on sequence public.office_bot_users_id_seq to service_role;

notify pgrst, 'reload schema';
