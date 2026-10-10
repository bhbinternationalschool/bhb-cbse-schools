/* ─── UDISE+ working sheet, on the server ──────────────────────
   The office reconciles a UDISE+ export against SIS over days: chase a PEN,
   verify a child on the portal, come back. That working sheet lived in one
   browser's localStorage, so it did not follow the login — uploaded on the
   office desktop, absent on the laptop.

   TWO TABLES, not one blob. A UDISE+ export of 700 children is large, and
   merging a second file changes a handful of rows; storing the sheet as a
   single jsonb document would rewrite the whole thing to add three rows, and
   would make "did this child's row change" unanswerable. One row per child
   makes the merge an ordinary upsert and keeps each write small.

   What is stored is the ROWS AS UPLOADED, never the matched table. The table
   the office sees is derived from these rows against SIS as it stands right
   now, so a child settled since the upload reports itself settled. Storing
   the derived view would freeze it, and the office would keep seeing names
   they had already dealt with. */

create table if not exists public.udise_upload_sheets (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- One working sheet per session: last year's export is not this year's work.
  academic_year_code text not null default '',
  -- Everything above and including the header row, kept verbatim so the
  -- parser sees the file exactly as it came off the portal.
  head jsonb not null default '[]'::jsonb,
  header_row_index int not null default 0,
  -- Every file that has fed this sheet, newest last.
  files jsonb not null default '[]'::jsonb,
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists udise_upload_sheets_tenant_ay_uidx
  on public.udise_upload_sheets (tenant_id, academic_year_code)
  where deleted_at is null;

create table if not exists public.udise_upload_rows (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sheet_id text not null,
  -- PEN, else APAAR, else name+DOB. What makes two rows the same child, and
  -- therefore what a second upload updates rather than duplicates.
  row_key text not null default '',
  ord int not null default 0,
  cells jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One row per child per sheet. This index IS the merge rule: a second export
-- naming the same child updates that row instead of adding another.
create unique index if not exists udise_upload_rows_sheet_key_uidx
  on public.udise_upload_rows (tenant_id, sheet_id, row_key)
  where deleted_at is null;

create index if not exists udise_upload_rows_sheet_ord_idx
  on public.udise_upload_rows (tenant_id, sheet_id, ord);

do $$
declare
  t text;
begin
  foreach t in array array['udise_upload_sheets', 'udise_upload_rows']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_all', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_tenant_member(tenant_id))',
      t || '_tenant_all', t
    );
    -- Without this explicit grant the service role's writes fail 42501, and
    -- they fail SILENTLY through PostgREST. Every new table needs it.
    execute format(
      'grant select, insert, update, delete on public.%I to service_role', t
    );
  end loop;
end
$$;

/* Registering here is what actually grants write access through the generic
   data API — a separate, deliberate step from adding the collection in
   TypeScript, so neither can be done absent-mindedly. */
insert into public.desk_writable_tables (table_name, soft_delete, note) values
  ('udise_upload_sheets', true,  'UDISE+ working sheet. Soft delete — "start a fresh sheet" must be undoable'),
  ('udise_upload_rows',   true,  'UDISE+ working sheet rows. Soft delete follows the sheet')
on conflict (table_name) do nothing;

notify pgrst, 'reload schema';
