-- Concession policies (§8.5) — kinds + rules; student grants in Fee Take later

create table if not exists public.concession_kinds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.concession_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  kind_id uuid not null references public.concession_kinds(id) on delete restrict,
  code text not null,
  name text not null,
  mode text not null check (mode in ('percent', 'fixed')),
  -- percent: whole percent (10 = 10%); fixed: amount in paise
  value bigint not null check (value >= 0),
  auto_approve_max_paise bigint,
  documentation_required boolean not null default false,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, academic_year_id, code)
);

create table if not exists public.concession_rule_fee_heads (
  concession_id uuid not null references public.concession_rules(id) on delete cascade,
  fee_head_id uuid not null references public.fee_heads(id) on delete restrict,
  primary key (concession_id, fee_head_id)
);

create table if not exists public.concession_incompatibilities (
  concession_id uuid not null references public.concession_rules(id) on delete cascade,
  incompatible_code text not null,
  primary key (concession_id, incompatible_code)
);

create table if not exists public.concession_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  concession_id uuid not null references public.concession_rules(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null check (status in ('pending', 'approved', 'rejected')),
  reason text,
  effective_from date not null,
  effective_to date,
  approved_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists concession_rules_tenant_ay_idx
  on public.concession_rules (tenant_id, academic_year_id);

create index if not exists concession_grants_student_idx
  on public.concession_grants (tenant_id, student_id, status);

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'fees.concessions', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;
