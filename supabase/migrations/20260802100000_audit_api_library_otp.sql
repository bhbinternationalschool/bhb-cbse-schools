-- Track 0/ B / D foundation: audit log, API keys, parent OTP, library module

-- ── Audit trail ─────────────────────────────────────────────────────────────
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_profile_id uuid,
  actor_name text not null default '',
  actor_email text,
  module text not null,
  action text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  summary text not null default '',
  before_state jsonb,
  after_state jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_tenant_created_idx
  on public.audit_events (tenant_id, created_at desc);

create index if not exists audit_events_module_idx
  on public.audit_events (tenant_id, module, created_at desc);

-- ── API keys (devices / partners) ───────────────────────────────────────────
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  scopes text[] not null default '{}',
  is_active boolean not null default true,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (tenant_id, key_prefix)
);

-- ── Parent login OTP (WhatsApp / SMS) ───────────────────────────────────────
create table if not exists public.parent_otp_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mobile text not null,
  code_hash text not null,
  household_id uuid,
  attempts int not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists parent_otp_mobile_idx
  on public.parent_otp_codes (tenant_id, mobile, created_at desc);

-- ── Library (lending, separate from store sales) ────────────────────────────
create table if not exists public.library_titles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  isbn text not null default '',
  title text not null,
  author text not null default '',
  publisher text not null default '',
  category text not null default 'general',
  shelf text not null default '',
  copies_total int not null default 1 check (copies_total >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists library_titles_tenant_isbn_idx
  on public.library_titles (tenant_id, isbn)
  where isbn <> '';

create table if not exists public.library_copies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title_id uuid not null references public.library_titles(id) on delete cascade,
  accession_no text not null,
  barcode text not null default '',
  status text not null default 'available'
    check (status in ('available', 'issued', 'lost', 'damaged', 'reserved')),
  created_at timestamptz not null default now(),
  unique (tenant_id, accession_no)
);

create table if not exists public.library_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  copy_id uuid not null references public.library_copies(id),
  student_id uuid not null references public.students(id),
  academic_year_code text not null,
  issued_on date not null,
  due_on date not null,
  returned_on date,
  fine_paise bigint not null default 0 check (fine_paise >= 0),
  issued_by text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists library_issues_student_idx
  on public.library_issues (tenant_id, student_id, issued_on desc);

create index if not exists library_issues_open_idx
  on public.library_issues (tenant_id, returned_on)
  where returned_on is null;

create table if not exists public.library_state (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'library', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;

comment on table public.audit_events is 'Immutable audit trail for fees, attendance, marks, RBAC';
comment on table public.library_issues is 'Book lending cycles; fines may link to fee holds';
