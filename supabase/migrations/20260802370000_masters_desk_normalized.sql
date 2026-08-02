-- Masters desk — foundation + fee setup slices (school_mirror_state.masters retained)

create table if not exists public.masters_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.masters_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  class_count int not null default 0,
  fee_head_count int not null default 0,
  subject_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.masters_desk_slices is
  'Foundation + fee setup masters — system of record';
