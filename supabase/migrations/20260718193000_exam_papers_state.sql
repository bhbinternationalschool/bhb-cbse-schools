-- Exam question papers blob (sets, sections, images, print log)

create table if not exists public.exam_papers_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.exam_papers_state enable row level security;

drop policy if exists "exam_papers_state_tenant_all" on public.exam_papers_state;
create policy "exam_papers_state_tenant_all"
  on public.exam_papers_state for all to authenticated
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

grant select, insert, update, delete on public.exam_papers_state to authenticated;
grant all on public.exam_papers_state to service_role;

comment on table public.exam_papers_state is
  'Tenant exam question papers: sets A/B/C, sections, media, print codes';
