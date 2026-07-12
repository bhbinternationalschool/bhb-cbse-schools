-- Fee defaulter playbook policy (§6b.4) — schema for Phase 1 enforcement
-- Demo UI uses in-app engine; tables ready when Fee Take ledger lands.

create table if not exists public.fee_recovery_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stage text not null check (stage in ('S0', 'S1', 'S2', 'S3', 'S4')),
  min_overdue_days int not null default 0,
  min_amount_paise bigint not null default 0,
  unique (tenant_id, stage)
);

create table if not exists public.fee_hold_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hold_code text not null check (hold_code in (
    'HOLD_REPORT_CARD', 'HOLD_TC', 'HOLD_CERT', 'HOLD_TRANSPORT',
    'HOLD_STORE_CREDIT', 'HOLD_LIBRARY', 'HOLD_ADMIT_CARD', 'HOLD_TRIP', 'HOLD_NEXT_AY'
  )),
  from_stage text not null check (from_stage in ('S0', 'S1', 'S2', 'S3', 'S4')),
  mode text not null default 'suggest' check (mode in ('auto', 'suggest')),
  enabled boolean not null default true,
  unique (tenant_id, hold_code)
);

create table if not exists public.student_fee_holds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  hold_code text not null,
  stage text not null,
  status text not null default 'active' check (status in ('active', 'released', 'overridden')),
  reason text,
  overridden_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create index if not exists student_fee_holds_active_idx
  on public.student_fee_holds (tenant_id, student_id)
  where status = 'active';

-- Seed BHB default ladder
insert into public.fee_recovery_policies (tenant_id, stage, min_overdue_days, min_amount_paise)
select t.id, v.stage, v.days, v.amt
from public.tenants t
cross join (values
  ('S0', -3, 0),
  ('S1', 0, 0),
  ('S2', 8, 0),
  ('S3', 16, 100000),
  ('S4', 31, 0)
) as v(stage, days, amt)
where t.slug = 'bhb-international'
on conflict (tenant_id, stage) do nothing;

insert into public.fee_hold_policies (tenant_id, hold_code, from_stage, mode, enabled)
select t.id, v.code, v.stage, v.mode, true
from public.tenants t
cross join (values
  ('HOLD_STORE_CREDIT', 'S1', 'suggest'),
  ('HOLD_REPORT_CARD', 'S2', 'auto'),
  ('HOLD_LIBRARY', 'S2', 'suggest'),
  ('HOLD_TRANSPORT', 'S3', 'auto'),
  ('HOLD_ADMIT_CARD', 'S3', 'suggest'),
  ('HOLD_CERT', 'S3', 'suggest'),
  ('HOLD_TC', 'S4', 'auto'),
  ('HOLD_NEXT_AY', 'S4', 'suggest'),
  ('HOLD_TRIP', 'S3', 'suggest')
) as v(code, stage, mode)
where t.slug = 'bhb-international'
on conflict (tenant_id, hold_code) do nothing;

-- Enable fees.defaulters module flag
insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'fees.defaulters', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;
