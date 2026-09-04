-- One row per file the ERP has copied into the school's Google Drive.
--
-- Serving storage stays where it is (the two Supabase buckets for media,
-- the database for receipts). Drive is the school's own browsable archive:
-- every upload that goes through /api/upload — gallery photos, videos,
-- website images, private files — and a PDF of every fee receipt, laid out
-- in folders a person can open without the ERP.
--
-- The row is the memory that makes the archive idempotent: (kind, ref) is
-- what was archived, drive_file_id is where it went, and a blank
-- drive_file_id with an error is a failed attempt the sweep retries. Without
-- it, a re-run would upload the same receipt again, and nobody could tell
-- from Drive alone what the ERP had and had not copied.

create table if not exists public.drive_archive (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('media', 'receipt')),
  -- media: "<bucket>/<path>"; receipt: the voucher id.
  ref text not null,
  drive_file_id text not null default '',
  folder text not null default '',
  file_name text not null default '',
  mime_type text not null default '',
  bytes bigint not null default 0,
  archived_at timestamptz,
  error text not null default '',
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind, ref)
);

create index if not exists drive_archive_kind_idx
  on public.drive_archive (tenant_id, kind, archived_at desc);

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the archive reports success while storing nothing.
grant all on public.drive_archive to service_role;

notify pgrst, 'reload schema';
