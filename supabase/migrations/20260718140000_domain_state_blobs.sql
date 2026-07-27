-- Week 3–6: document-store sync for fees / payments / attendance / exams.
-- One jsonb row per tenant. Normalized fee_* / attendance_* / exam_* tables
-- remain future go-live (UUID FKs vs app text ids); blobs are intentional interim.

create table if not exists public.fees_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"vouchers":[],"cheques":[],"manualBooks":[],"dayCloses":[],"installmentPlans":[],"planAllocations":[],"carriedForwardDues":[],"chargeVouchers":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.payments_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"links":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"registers":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.exams_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"terms":[],"subjects":[],"sheets":[],"policy":{},"promotions":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.fees_state enable row level security;
alter table public.payments_state enable row level security;
alter table public.attendance_state enable row level security;
alter table public.exams_state enable row level security;

drop policy if exists "fees_state_tenant_all" on public.fees_state;
create policy "fees_state_tenant_all"
  on public.fees_state for all
  to authenticated
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

drop policy if exists "payments_state_tenant_all" on public.payments_state;
create policy "payments_state_tenant_all"
  on public.payments_state for all
  to authenticated
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

drop policy if exists "attendance_state_tenant_all" on public.attendance_state;
create policy "attendance_state_tenant_all"
  on public.attendance_state for all
  to authenticated
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

drop policy if exists "exams_state_tenant_all" on public.exams_state;
create policy "exams_state_tenant_all"
  on public.exams_state for all
  to authenticated
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

grant select, insert, update, delete on public.fees_state to authenticated;
grant select, insert, update, delete on public.payments_state to authenticated;
grant select, insert, update, delete on public.attendance_state to authenticated;
grant select, insert, update, delete on public.exams_state to authenticated;

grant all on public.fees_state to service_role;
grant all on public.payments_state to service_role;
grant all on public.attendance_state to service_role;
grant all on public.exams_state to service_role;

comment on table public.fees_state is
  'Interim Fee Take blob sync (localStorage mirror). Normalized fee_* tables are future.';
comment on table public.payments_state is
  'Interim payment_links blob sync. Normalized payment_links table is future.';
comment on table public.attendance_state is
  'Interim attendance registers blob sync.';
comment on table public.exams_state is
  'Interim exams / marks / promotions blob sync.';
