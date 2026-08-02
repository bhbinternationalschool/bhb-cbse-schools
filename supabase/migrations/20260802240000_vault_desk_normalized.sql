-- Document vault (§21a) — normalized desk SoR (vault_state blob retained for cutover)

create table if not exists public.vault_desk_documents (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  doc_type text not null
    check (doc_type in (
      'fire_noc', 'building_safety', 'land_lease', 'society_reg', 'udise',
      'recognition', 'cbse_affiliation', 'bus_permit', 'insurance', 'puc',
      'trust_pan', '12a_80g', 'other'
    )),
  title text not null default '',
  file_url text not null default '',
  file_name text not null default '',
  issued_on date,
  expires_on date,
  reminder_days int not null default 30 check (reminder_days >= 0),
  owner_role text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_desk_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  digest_mobiles text not null default '',
  last_expiry_digest_at text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  document_count int not null default 0,
  expiring_soon_count int not null default 0,
  last_document_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists vault_desk_documents_expires_idx
  on public.vault_desk_documents (tenant_id, expires_on);

create index if not exists vault_desk_documents_type_idx
  on public.vault_desk_documents (tenant_id, doc_type);

comment on table public.vault_desk_documents is
  'Statutory / compliance documents — system of record';
