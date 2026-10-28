-- Staff leave rules (director, 11 Oct 2026 — "the old SStudy ERP had this").
--
-- Leave requests, the leave types and each person's desk balance stay where
-- they are (staff_hr_desk_slices — the staff app, WhatsApp and the register
-- all file into it). These tables hold the RULES on top of that, per
-- academic year, as server rows:
--
-- 1. staff_leave_policy_types — one row per leave type per year: the days
--    everyone gets, whether half days are allowed, the sandwich rule (a
--    holiday / Sunday between two leave days counts as leave), the most
--    unused days that may roll into the next year, and what approving does
--    when the balance is short ('block' refuses; 'lwp' approves what the
--    balance covers and files the rest as leave without pay).
--    A year with no rows here has no policy: the old desk rules apply.
-- 2. staff_leave_policy_allocations — the days for one staff category
--    (permanent / contract / part_time) or one member of staff. Precedence:
--    staff row > category row > the type's default_days.
-- 3. staff_leave_approvers — who decides whose leave: the whole school, a
--    department, or one member of staff, at level 1 or 2. The most specific
--    scope with any rows wins. Leadership can always decide.
-- 4. staff_leave_carry_forwards — the year-end carry. One row per person and
--    type per receiving year (unique), so committing twice carries nothing
--    twice. Rows are never edited by the app.
--
-- The staff app's ids are text (stf_…); nothing here has a cross-table FK,
-- like the neighbouring desk tables.

create table if not exists public.staff_leave_policy_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  type_code text not null,
  default_days numeric not null default 0 check (default_days >= 0 and default_days <= 365),
  half_day_allowed boolean not null default true,
  sandwich boolean not null default false,
  carry_forward_cap numeric not null default 0 check (carry_forward_cap >= 0 and carry_forward_cap <= 365),
  insufficient_mode text not null default 'block' check (insufficient_mode in ('block', 'lwp')),
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  unique (tenant_id, academic_year_code, type_code)
);

create table if not exists public.staff_leave_policy_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  type_code text not null,
  staff_category text,
  staff_id text,
  days numeric not null check (days >= 0 and days <= 365),
  note text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  check ((staff_category is null) <> (staff_id is null))
);
create unique index if not exists staff_leave_policy_alloc_category_uq
  on public.staff_leave_policy_allocations (tenant_id, academic_year_code, type_code, staff_category)
  where staff_category is not null;
create unique index if not exists staff_leave_policy_alloc_staff_uq
  on public.staff_leave_policy_allocations (tenant_id, academic_year_code, type_code, staff_id)
  where staff_id is not null;

create table if not exists public.staff_leave_approvers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('school', 'department', 'staff')),
  scope_id text not null default '',
  level smallint not null default 1 check (level in (1, 2)),
  approver_staff_id text not null,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  check (scope_kind = 'school' or scope_id <> ''),
  unique (tenant_id, scope_kind, scope_id, level, approver_staff_id)
);

create table if not exists public.staff_leave_carry_forwards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_academic_year_code text not null,
  to_academic_year_code text not null,
  staff_id text not null,
  type_code text not null,
  closing_balance numeric not null,
  cap numeric not null,
  days_carried numeric not null check (days_carried >= 0),
  committed_by text not null default '',
  committed_at timestamptz not null default now(),
  check (from_academic_year_code <> to_academic_year_code),
  unique (tenant_id, to_academic_year_code, staff_id, type_code)
);

create index if not exists staff_leave_policy_types_tenant_ay_idx
  on public.staff_leave_policy_types (tenant_id, academic_year_code);
create index if not exists staff_leave_policy_alloc_tenant_ay_idx
  on public.staff_leave_policy_allocations (tenant_id, academic_year_code);
create index if not exists staff_leave_approvers_tenant_idx
  on public.staff_leave_approvers (tenant_id);
create index if not exists staff_leave_carry_forwards_tenant_to_idx
  on public.staff_leave_carry_forwards (tenant_id, to_academic_year_code);

do $$
declare t text;
begin
  foreach t in array array[
    'staff_leave_policy_types', 'staff_leave_policy_allocations',
    'staff_leave_approvers', 'staff_leave_carry_forwards']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
