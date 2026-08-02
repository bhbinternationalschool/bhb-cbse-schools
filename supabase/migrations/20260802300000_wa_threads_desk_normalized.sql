-- WhatsApp bot threads desk — per-slice jsonb SoR (wa_bot_threads_state blob retained)

create table if not exists public.wa_desk_bot_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key),
  constraint wa_desk_bot_slices_key_check check (
    slice_key in (
      'crm',
      'sis',
      'survey',
      'classChannel',
      'unified',
      'hub',
      'staffAtt'
    )
  )
);

create table if not exists public.wa_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  thread_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists wa_desk_bot_slices_updated_idx
  on public.wa_desk_bot_slices (tenant_id, updated_at desc);

comment on table public.wa_desk_bot_slices is
  'WhatsApp bot thread stores by slice — system of record (replaces wa_bot_threads_state jsonb slices)';
