-- Complete fee setup masters: groups, structure lines, installments, late fee

create table if not exists public.fee_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  code text not null,
  name text not null,
  student_type text not null check (student_type in ('NEW', 'PROMOTE', 'MID_YEAR', 'RTE')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, academic_year_id, code)
);

create table if not exists public.fee_group_classes (
  fee_group_id uuid not null references public.fee_groups(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  primary key (fee_group_id, class_id)
);

create table if not exists public.fee_installments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  code text not null,
  label text not null,
  due_on date not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  unique (tenant_id, academic_year_id, code)
);

create table if not exists public.fee_structure_lines (
  id uuid primary key default gen_random_uuid(),
  fee_group_id uuid not null references public.fee_groups(id) on delete cascade,
  fee_head_id uuid not null references public.fee_heads(id) on delete restrict,
  class_id uuid references public.classes(id) on delete cascade,
  installment_id uuid references public.fee_installments(id) on delete set null,
  amount_paise bigint not null check (amount_paise >= 0),
  created_at timestamptz not null default now()
);

create index if not exists fee_structure_lines_group_idx
  on public.fee_structure_lines (fee_group_id);

create table if not exists public.late_fee_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  grace_days int not null default 7 check (grace_days >= 0),
  mode text not null check (mode in ('flat', 'percent')),
  value_int bigint not null,
  -- flat: paise; percent: basis points (200 = 2.00%)
  fee_head_id uuid not null references public.fee_heads(id) on delete restrict,
  max_amount_paise bigint,
  is_active boolean not null default true,
  unique (tenant_id, academic_year_id)
);

-- Seed installments for BHB 2025-26
insert into public.fee_installments (tenant_id, academic_year_id, code, label, due_on, sort_order)
select t.id, ay.id, v.code, v.label, v.due_on::date, v.sort_order
from public.tenants t
join public.academic_years ay on ay.tenant_id = t.id and ay.code = '2025-26'
cross join (values
  ('APR', 'April (session start)', '2025-04-10', 1),
  ('JUL', 'July (Q2)', '2025-07-10', 2),
  ('OCT', 'October (Q3)', '2025-10-10', 3),
  ('JAN', 'January (Q4)', '2026-01-10', 4)
) as v(code, label, due_on, sort_order)
where t.slug = 'bhb-international'
on conflict (tenant_id, academic_year_id, code) do update
  set label = excluded.label, due_on = excluded.due_on, sort_order = excluded.sort_order;

-- Late fee default
insert into public.late_fee_rules (
  tenant_id, academic_year_id, grace_days, mode, value_int, fee_head_id, max_amount_paise
)
select t.id, ay.id, 7, 'flat', 10000, fh.id, 50000
from public.tenants t
join public.academic_years ay on ay.tenant_id = t.id and ay.code = '2025-26'
join public.fee_heads fh on fh.tenant_id = t.id and fh.code = 'LATE'
where t.slug = 'bhb-international'
on conflict (tenant_id, academic_year_id) do update
  set grace_days = excluded.grace_days,
      mode = excluded.mode,
      value_int = excluded.value_int,
      max_amount_paise = excluded.max_amount_paise,
      is_active = true;
