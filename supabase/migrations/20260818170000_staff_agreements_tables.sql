-- Staff agreements: the module was registered as a desk-slice module
-- (deskSliceRegistry: staff_agreements → staff_agreements_desk_slices /
-- staff_agreements_desk_sync_meta, blob staff_agreements_state) but the
-- tables were never created. Every save since go-live failed server-side
-- with 42P01 "Could not find the table … in the schema cache" (7 log hits,
-- 2026-08-11 → 18) and the browser only console.warned. Same shape as the
-- other secondary desk-slice modules (20260802400000).
create table if not exists public.staff_agreements_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.staff_agreements_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_agreements_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"agreements":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.staff_agreements_desk_slices enable row level security;
alter table public.staff_agreements_desk_sync_meta enable row level security;
alter table public.staff_agreements_state enable row level security;

drop policy if exists staff_agreements_desk_slices_tenant_all on public.staff_agreements_desk_slices;
create policy staff_agreements_desk_slices_tenant_all on public.staff_agreements_desk_slices for all using (is_tenant_member(tenant_id));
drop policy if exists staff_agreements_desk_sync_meta_tenant_all on public.staff_agreements_desk_sync_meta;
create policy staff_agreements_desk_sync_meta_tenant_all on public.staff_agreements_desk_sync_meta for all using (is_tenant_member(tenant_id));
drop policy if exists staff_agreements_state_tenant_all on public.staff_agreements_state;
create policy staff_agreements_state_tenant_all on public.staff_agreements_state for all using (is_tenant_member(tenant_id));

grant select, insert, update, delete on public.staff_agreements_desk_slices to service_role;
grant select, insert, update, delete on public.staff_agreements_desk_sync_meta to service_role;
grant select, insert, update, delete on public.staff_agreements_state to service_role;

notify pgrst, 'reload schema';
