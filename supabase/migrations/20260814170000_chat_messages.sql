-- Parent <-> class-teacher chat, one thread per student. Server-authoritative
-- (not local-first desk-sync): both sides read/write the same row set live,
-- so there is no browser-owned "state" blob to sync — every request hits
-- Supabase directly, same rationale as school_events.

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  sender_persona text not null check (sender_persona in ('parent', 'staff')),
  sender_id text not null, -- householdId (parent) or staffId (staff)
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_by_parent_at timestamptz,
  read_by_staff_at timestamptz
);

alter table public.chat_messages enable row level security;

create policy chat_messages_tenant_all
  on public.chat_messages
  for all
  using (is_tenant_member(tenant_id));

create index if not exists chat_messages_thread_idx
  on public.chat_messages (tenant_id, student_id, created_at);

grant select, insert, update, delete on public.chat_messages to service_role;

notify pgrst, 'reload schema';
