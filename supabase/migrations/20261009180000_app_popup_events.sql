/*
 * App pop-ups (director, 9 Oct 2026): who saw, dismissed or completed each
 * pop-up the school posts to the parent and staff apps.
 *
 * One row per event, never updated: many phones open the app at the same
 * moment, and a single JSON blob of responses would lose writes between
 * them. The pop-ups themselves live in module_local_state "app_popups".
 *
 * subject_key: "hh:<household id>" for a family, "staff:<staff id>".
 * event:  shown     — the pop-up was put on screen
 *         dismissed — closed with "Later"
 *         done      — the form was completed (value holds what was answered,
 *                     never an Aadhaar number — that goes to the SIS record)
 */

create table if not exists public.app_popup_events (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  popup_id text not null,
  subject_key text not null,
  event text not null check (event in ('shown', 'dismissed', 'done')),
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_popup_events_subject_idx
  on public.app_popup_events (tenant_id, subject_key, popup_id);
create index if not exists app_popup_events_popup_idx
  on public.app_popup_events (tenant_id, popup_id, event);

comment on table public.app_popup_events is
  'Shown / dismissed / done events for app pop-ups (module_local_state app_popups). Append-only.';

/* ─── RLS + grants ─────────────────────────────────────────── */
-- Every new table needs the service_role grant spelled out, or the server's
-- writes fail with a bare 42501 that reads like a bug in the caller.

alter table public.app_popup_events enable row level security;

drop policy if exists app_popup_events_tenant_read on public.app_popup_events;
create policy app_popup_events_tenant_read
  on public.app_popup_events
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

grant select on public.app_popup_events to authenticated;
grant select, insert, update, delete on public.app_popup_events to service_role;
grant usage, select on sequence public.app_popup_events_id_seq to service_role;

notify pgrst, 'reload schema';
