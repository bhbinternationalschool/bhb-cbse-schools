-- Reports Center — optional audit log for future cloud export jobs.
-- Phase 1 runs exports client-side from existing module catalogs.

create table if not exists public.report_export_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  campus_id text,
  user_id text,
  user_name text,
  module_id text not null,
  report_id text not null,
  report_label text,
  format text,
  filter_note text,
  row_count integer,
  created_at timestamptz not null default now()
);

create index if not exists report_export_audit_created_idx
  on public.report_export_audit (created_at desc);

create index if not exists report_export_audit_module_idx
  on public.report_export_audit (module_id, report_id);

comment on table public.report_export_audit is
  'Reports Center / module export audit (who ran which report). Client localStorage used until wired.';
