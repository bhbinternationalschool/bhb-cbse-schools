-- Library lending desk — normalized SoR (library_state blob retained for cutover)

create table if not exists public.library_desk_titles (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  isbn text not null default '',
  title text not null default '',
  author text not null default '',
  publisher text not null default '',
  category text not null default 'general',
  shelf text not null default '',
  copies_total int not null default 1 check (copies_total >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.library_desk_copies (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title_id text not null references public.library_desk_titles(id) on delete cascade,
  accession_no text not null,
  barcode text not null default '',
  status text not null default 'available'
    check (status in ('available', 'issued', 'lost', 'damaged', 'reserved')),
  updated_at timestamptz not null default now(),
  unique (tenant_id, accession_no)
);

create table if not exists public.library_desk_issues (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  copy_id text not null references public.library_desk_copies(id) on delete cascade,
  student_id text not null,
  academic_year_code text not null,
  issued_on date not null,
  due_on date not null,
  returned_on date,
  fine_paise bigint not null default 0 check (fine_paise >= 0),
  issued_by text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.library_desk_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  max_books_per_student int not null default 2 check (max_books_per_student >= 1),
  loan_days int not null default 14 check (loan_days >= 1),
  fine_paise_per_day int not null default 500 check (fine_paise_per_day >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.library_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  title_count int not null default 0,
  copy_count int not null default 0,
  issue_count int not null default 0,
  open_issue_count int not null default 0,
  last_issue_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists library_desk_titles_tenant_idx
  on public.library_desk_titles (tenant_id, is_active);

create index if not exists library_desk_issues_student_idx
  on public.library_desk_issues (tenant_id, student_id, issued_on desc);

create index if not exists library_desk_issues_open_idx
  on public.library_desk_issues (tenant_id)
  where returned_on is null;

comment on table public.library_desk_titles is
  'Library catalog titles — system of record (text ids match desk localStorage)';
