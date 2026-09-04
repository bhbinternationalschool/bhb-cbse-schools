-- A parent's message to a class or subject teacher, sent through the
-- school's WhatsApp number (or the app) rather than to the teacher's own
-- phone: teachers' numbers stay private, and the school can see and
-- enforce its 8 AM–8 PM window. A message that arrives after hours waits
-- here as 'pending' and is delivered by the morning tick.

create table if not exists public.teacher_messages (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id text not null,
  student_id text not null,
  staff_id text not null,
  staff_name text not null default '',
  subject text not null default '',
  body text not null,
  channel text not null check (channel in ('whatsapp', 'app')),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  delivered_via text not null default '',
  error text not null default '',
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists teacher_messages_pending_idx
  on public.teacher_messages (tenant_id, status, created_at)
  where status = 'pending';
create index if not exists teacher_messages_staff_idx
  on public.teacher_messages (tenant_id, staff_id, created_at desc);

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the request "succeeds" while storing nothing.
grant all on public.teacher_messages to service_role;

notify pgrst, 'reload schema';
