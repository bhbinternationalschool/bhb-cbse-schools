-- Student curriculum enrollment + parent requests + class templates.
-- Demo ERP keeps localStorage as the working copy; these tables are the
-- Supabase source of truth when NEXT_PUBLIC_SUPABASE_* is configured.
-- student_key / class_key are text so demo ids (stu_…, cls_…) and UUID ids both work.

create table if not exists public.student_curriculum (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_key text not null,
  academic_year_code text not null,
  senior_stream_id text,
  chosen_subject_ids text[] not null default '{}',
  confirmed_at timestamptz,
  confirmed_by text check (confirmed_by is null or confirmed_by in ('office', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, student_key, academic_year_code)
);

create table if not exists public.curriculum_requests (
  id text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_key text not null,
  academic_year_code text not null,
  proposed_stream_id text,
  proposed_chosen_subject_ids text[] not null default '{}',
  note text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text not null default ''
);

create table if not exists public.class_curriculum_templates (
  id text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  class_key text not null,
  academic_year_code text not null,
  label text not null default 'Class template',
  chosen_subject_ids text[] not null default '{}',
  senior_stream_id text,
  updated_at timestamptz not null default now(),
  unique (tenant_id, class_key, academic_year_code)
);

create index if not exists student_curriculum_tenant_ay_idx
  on public.student_curriculum (tenant_id, academic_year_code);

create index if not exists curriculum_requests_pending_idx
  on public.curriculum_requests (tenant_id, status)
  where status = 'pending';

create index if not exists curriculum_requests_student_idx
  on public.curriculum_requests (tenant_id, student_key);

create index if not exists class_curriculum_templates_tenant_ay_idx
  on public.class_curriculum_templates (tenant_id, academic_year_code);

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'academics.curriculum', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;

alter table public.student_curriculum enable row level security;
alter table public.curriculum_requests enable row level security;
alter table public.class_curriculum_templates enable row level security;

drop policy if exists "student_curriculum_tenant_all" on public.student_curriculum;
create policy "student_curriculum_tenant_all"
  on public.student_curriculum for all
  to authenticated
  using (
    tenant_id in (
      select p.tenant_id from public.profiles p where p.auth_user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select p.tenant_id from public.profiles p where p.auth_user_id = auth.uid()
    )
  );

drop policy if exists "curriculum_requests_tenant_all" on public.curriculum_requests;
create policy "curriculum_requests_tenant_all"
  on public.curriculum_requests for all
  to authenticated
  using (
    tenant_id in (
      select p.tenant_id from public.profiles p where p.auth_user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select p.tenant_id from public.profiles p where p.auth_user_id = auth.uid()
    )
  );

drop policy if exists "class_curriculum_templates_tenant_all" on public.class_curriculum_templates;
create policy "class_curriculum_templates_tenant_all"
  on public.class_curriculum_templates for all
  to authenticated
  using (
    tenant_id in (
      select p.tenant_id from public.profiles p where p.auth_user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select p.tenant_id from public.profiles p where p.auth_user_id = auth.uid()
    )
  );

comment on table public.student_curriculum is
  'Confirmed/draft per-student subjects/stream for an AY. student_key = SIS student id.';

comment on table public.curriculum_requests is
  'Parent-requested curriculum changes awaiting office approve/reject.';

comment on table public.class_curriculum_templates is
  'Office class-level curriculum cart templates for bulk apply.';
