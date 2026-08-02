-- Secondary domain desk slices (RBAC, certificates, config blobs)

create table if not exists public.rbac_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.rbac_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.certificates_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.certificates_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_papers_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.exam_papers_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.wa_templates_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.wa_templates_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_hr_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.staff_hr_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_advances_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.staff_advances_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.module_registry_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.module_registry_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.fee_recovery_tasks_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.fee_recovery_tasks_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.automation_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_chat_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.erp_chat_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_chat_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.staff_chat_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  row_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

-- library_state blob (used by validate + legacy imports)
create table if not exists public.library_state (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
