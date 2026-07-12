-- Fee recovery installment plans (Defaulters / Accounts)
-- Demo UI uses localStorage; tables ready for Supabase wiring.

create table if not exists public.fee_installment_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  student_id uuid not null references public.students(id) on delete cascade,
  household_id uuid not null,
  academic_year_code text not null,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled', 'broken')),
  total_paise bigint not null check (total_paise > 0),
  interval text not null default 'monthly'
    check (interval in ('weekly', 'fortnightly', 'monthly')),
  note text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  broken_at timestamptz,
  unique (tenant_id, code)
);

create table if not exists public.fee_installment_plan_covered (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.fee_installment_plans(id) on delete cascade,
  due_key text not null,
  label text not null,
  amount_paise bigint not null check (amount_paise > 0),
  unique (plan_id, due_key)
);

create table if not exists public.fee_installment_plan_slices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.fee_installment_plans(id) on delete cascade,
  seq int not null check (seq >= 1),
  due_on date not null,
  amount_paise bigint not null check (amount_paise > 0),
  label text not null,
  unique (plan_id, seq)
);

create table if not exists public.fee_installment_plan_allocations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.fee_installment_plans(id) on delete cascade,
  voucher_id uuid not null,
  due_key text not null,
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now()
);

create index if not exists fee_installment_plans_student_active_idx
  on public.fee_installment_plans (tenant_id, student_id)
  where status = 'active';

create index if not exists fee_installment_plan_slices_due_idx
  on public.fee_installment_plan_slices (plan_id, due_on);

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'fees.installment_plans', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;
