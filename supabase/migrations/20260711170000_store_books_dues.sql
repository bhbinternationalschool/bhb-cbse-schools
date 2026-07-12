-- Store / books catalog + credit issues linked to Fee Take dues

create table if not exists public.store_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sku text not null,
  name text not null,
  category text not null default 'other'
    check (category in ('book', 'uniform', 'stationery', 'other')),
  size_label text not null default '',
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, sku)
);

create table if not exists public.store_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  issue_no text not null,
  student_id uuid not null references public.students(id),
  household_id uuid references public.households(id),
  academic_year_code text not null,
  issued_on date not null,
  total_paise bigint not null check (total_paise >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  unique (tenant_id, issue_no)
);

create table if not exists public.store_issue_lines (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.store_issues(id) on delete cascade,
  item_id uuid references public.store_items(id),
  sku text not null,
  name text not null,
  size_label text not null default '',
  qty integer not null check (qty > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  line_paise bigint not null check (line_paise >= 0)
);

create index if not exists store_issues_student_idx
  on public.store_issues (tenant_id, student_id, issued_on desc);

comment on table public.store_issues is
  'Credit issue of books/uniforms; unpaid balance collected via Fee Take due_key store:student:issue';
