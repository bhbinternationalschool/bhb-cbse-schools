-- Google Drive document storage — Phase 0: the OAuth connection record.
--
-- Plan: docs/GOOGLE_DRIVE_DOCUMENTS_PLAN.md
--
-- One admin authorizes once, tenant-wide (confirmed decision — not
-- per-staff, not a service-account/domain-delegation setup). Deliberately
-- NOT following google_classroom.store.server.ts's disk-based store: that
-- store lives at .data/google_classroom.json, which is on Cloud Run's
-- ephemeral filesystem and does not survive a deploy or an idle instance
-- recycling. This table is the durable replacement pattern for that gap,
-- applied to Drive from the start rather than carried over.
--
-- Not security definer, matching sis_promote_enrollment / sis_push_guarded
-- — this project's tables are only ever reached via the service_role
-- connection, which already has full access.

create table if not exists public.google_drive_connection (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  email text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  connected_by text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
