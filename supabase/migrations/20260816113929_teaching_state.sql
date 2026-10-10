-- Teaching delivery & syllabus pacing (domain blob).
--
-- Holds the school's own record of which timetable periods were actually
-- taught, plus the year syllabus plan they are measured against. Written
-- concurrently by every teacher, so the app merges on hydrate rather
-- than overwriting (see lib/teaching.ts mergeTeachingStates).

create table if not exists public.teaching_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"units":[],"logs":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.teaching_state enable row level security;

drop policy if exists teaching_state_tenant_all on public.teaching_state;
create policy teaching_state_tenant_all on public.teaching_state
  for all to authenticated
  using (
    tenant_id in (
      select p.tenant_id from public.profiles p
      where p.auth_user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select p.tenant_id from public.profiles p
      where p.auth_user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.teaching_state to authenticated;
-- Required explicitly: without it the server-side service_role writes
-- fail with 42501 and the push looks like a silent no-op.
grant all on public.teaching_state to service_role;
