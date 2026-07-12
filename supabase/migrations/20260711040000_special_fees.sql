-- Special / misc fees (§6b) — definitions + class/student assignment

create table if not exists public.special_fees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  fee_head_id uuid not null references public.fee_heads(id) on delete restrict,
  code text not null,
  name text not null,
  amount_paise bigint not null check (amount_paise >= 0),
  due_on date,
  reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, academic_year_id, code)
);

create table if not exists public.special_fee_assignments (
  id uuid primary key default gen_random_uuid(),
  special_fee_id uuid not null references public.special_fees(id) on delete cascade,
  scope text not null check (scope in ('classes', 'students', 'mixed')),
  created_at timestamptz not null default now()
);

create table if not exists public.special_fee_assignment_classes (
  assignment_id uuid not null references public.special_fee_assignments(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  primary key (assignment_id, class_id)
);

create table if not exists public.special_fee_assignment_students (
  assignment_id uuid not null references public.special_fee_assignments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  primary key (assignment_id, student_id)
);

create index if not exists special_fees_tenant_ay_idx
  on public.special_fees (tenant_id, academic_year_id);

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'fees.special', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;
