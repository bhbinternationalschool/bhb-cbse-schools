-- Proxy-proof staff punch (director, 30 Sep 2026): a punch counts only from
-- the staff member's OWN phone, and only while they stand in front of the
-- office QR screen.
--
-- staff_punch_devices — one row per (staff, phone). The phone is identified
-- by a signing key its browser made and cannot export (WebCrypto ECDSA P-256,
-- non-extractable, kept in IndexedDB); device_id is the SHA-256 of that
-- public key. Every punch is signed with it, so a staff id and OTP handed to
-- a colleague is not enough — the colleague's phone holds a different key.
--
-- status:
--   active   — this is the staff member's punch phone. At most ONE per staff,
--              and a phone may be active for only ONE staff member (partial
--              unique indexes below), so one phone cannot punch for two.
--   pending  — a punch came from a different phone; the office decides.
--   rejected / revoked — kept for the record, never deleted.
create table if not exists public.staff_punch_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id text not null,
  device_id text not null,
  public_key jsonb not null,
  status text not null check (status in ('active', 'pending', 'rejected', 'revoked')),
  -- "Android · Chrome" — what the office sees when approving.
  label text not null default '',
  created_at timestamptz not null default now(),
  decided_by text not null default '',
  decided_at timestamptz,
  last_used_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_punch_devices_one_active_per_staff
  on public.staff_punch_devices (tenant_id, staff_id) where status = 'active';
create unique index if not exists staff_punch_devices_one_staff_per_phone
  on public.staff_punch_devices (tenant_id, device_id) where status = 'active';
create unique index if not exists staff_punch_devices_one_pending
  on public.staff_punch_devices (tenant_id, staff_id, device_id) where status = 'pending';
create index if not exists staff_punch_devices_staff_idx
  on public.staff_punch_devices (tenant_id, staff_id);

-- staff_punch_displays — the office tablet / desktop that shows the QR. A
-- screen holds a random token (only its hash is stored) instead of a login,
-- because the login's 30-minute idle logout would blank a screen that
-- nobody touches. Revoking a row turns that screen off.
create table if not exists public.staff_punch_displays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null unique,
  label text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

comment on table public.staff_punch_devices is
  'Staff punch phones. A punch is accepted only when signed by the staff member''s active device key. One active phone per staff, one staff per phone; a new phone waits for the office.';
comment on table public.staff_punch_displays is
  'Office screens that show the rotating punch QR. token_hash = sha256 of the screen''s token; revoked_at switches a screen off.';

-- Server-only tables: no browser ever reads them directly.
alter table public.staff_punch_devices enable row level security;
alter table public.staff_punch_displays enable row level security;

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 while the request "succeeds".
grant all on public.staff_punch_devices to service_role;
grant all on public.staff_punch_displays to service_role;

notify pgrst, 'reload schema';
