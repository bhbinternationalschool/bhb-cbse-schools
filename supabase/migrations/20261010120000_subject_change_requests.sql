/*
 * Teachers ask to change what a class studies; the principal or office
 * approves in Masters → Subjects (director, 10 Oct 2026; lib/subjectRequests).
 * A request never changes Masters by itself — approval applies it through
 * the versioned Masters save, then marks the row. One row per request;
 * decisions are conditional (status = 'pending') so two approvers cannot
 * both apply it.
 */

create table if not exists public.subject_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id text not null,
  staff_name text not null default '',
  class_id text not null,
  class_name text not null default '',
  action text not null check (action in ('add', 'remove', 'new')),
  /** add / remove: the Masters subject id. '' for a new subject. */
  subject_id text not null default '',
  subject_name text not null default '',
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by text not null default '',
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists subject_change_requests_status_idx
  on public.subject_change_requests (tenant_id, status, created_at desc);
create index if not exists subject_change_requests_staff_idx
  on public.subject_change_requests (tenant_id, staff_id, created_at desc);

alter table public.subject_change_requests enable row level security;

drop policy if exists subject_change_requests_tenant_read on public.subject_change_requests;
create policy subject_change_requests_tenant_read
  on public.subject_change_requests
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- Spelled out: a new table without the service_role grant fails as a bare
-- 42501 that reads like a bug in the caller.
grant select on public.subject_change_requests to authenticated;
grant select, insert, update, delete on public.subject_change_requests to service_role;

notify pgrst, 'reload schema';
