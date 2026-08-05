-- Library desk — extend normalized SoR (procurement docs, dedicated title/issue columns)

-- Procurement bills / challans (previously blob-only)
create table if not exists public.library_desk_procurement_docs (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null default '',
  vendor text not null default '',
  bill_no text not null default '',
  purchase_date date,
  amount_paise bigint not null default 0 check (amount_paise >= 0),
  file_url text not null default '',
  file_data_ref text not null default '',
  note text not null default '',
  ocr_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Titles — stop packing edition / purchase / price into publisher
alter table public.library_desk_titles
  add column if not exists purchase_date date,
  add column if not exists edition text not null default '',
  add column if not exists price_paise bigint not null default 0 check (price_paise >= 0);

-- Issues — dedicated borrower / condition columns
alter table public.library_desk_issues
  add column if not exists borrower_type text not null default 'student'
    check (borrower_type in ('student', 'staff')),
  add column if not exists staff_id text not null default '',
  add column if not exists issue_condition text not null default 'good'
    check (issue_condition in ('good', 'fair', 'damaged', 'torn')),
  add column if not exists return_condition text
    check (return_condition is null or return_condition in ('good', 'fair', 'damaged', 'torn')),
  add column if not exists damage_note_on_issue text not null default '',
  add column if not exists damage_note_on_return text not null default '';

-- Settings — staff borrowing limit
alter table public.library_desk_settings
  add column if not exists max_books_per_staff int not null default 3
    check (max_books_per_staff >= 1);

create index if not exists library_desk_procurement_docs_tenant_idx
  on public.library_desk_procurement_docs (tenant_id, purchase_date desc nulls last);

create index if not exists library_desk_issues_staff_idx
  on public.library_desk_issues (tenant_id, staff_id, issued_on desc)
  where borrower_type = 'staff';

comment on table public.library_desk_procurement_docs is
  'Library procurement bills/challans — system of record (text ids match desk localStorage)';

-- RLS (auth_tenant_id / is_tenant_member pattern)
alter table public.library_desk_titles enable row level security;
alter table public.library_desk_copies enable row level security;
alter table public.library_desk_issues enable row level security;
alter table public.library_desk_settings enable row level security;
alter table public.library_desk_sync_meta enable row level security;
alter table public.library_desk_procurement_docs enable row level security;

drop policy if exists "library_desk_titles_tenant_all" on public.library_desk_titles;
create policy "library_desk_titles_tenant_all"
  on public.library_desk_titles for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists "library_desk_copies_tenant_all" on public.library_desk_copies;
create policy "library_desk_copies_tenant_all"
  on public.library_desk_copies for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists "library_desk_issues_tenant_all" on public.library_desk_issues;
create policy "library_desk_issues_tenant_all"
  on public.library_desk_issues for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists "library_desk_settings_tenant_all" on public.library_desk_settings;
create policy "library_desk_settings_tenant_all"
  on public.library_desk_settings for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists "library_desk_sync_meta_tenant_all" on public.library_desk_sync_meta;
create policy "library_desk_sync_meta_tenant_all"
  on public.library_desk_sync_meta for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists "library_desk_procurement_docs_tenant_all" on public.library_desk_procurement_docs;
create policy "library_desk_procurement_docs_tenant_all"
  on public.library_desk_procurement_docs for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

grant select, insert, update, delete on public.library_desk_titles to authenticated;
grant select, insert, update, delete on public.library_desk_copies to authenticated;
grant select, insert, update, delete on public.library_desk_issues to authenticated;
grant select, insert, update, delete on public.library_desk_settings to authenticated;
grant select, insert, update, delete on public.library_desk_sync_meta to authenticated;
grant select, insert, update, delete on public.library_desk_procurement_docs to authenticated;

grant all on public.library_desk_procurement_docs to service_role;
