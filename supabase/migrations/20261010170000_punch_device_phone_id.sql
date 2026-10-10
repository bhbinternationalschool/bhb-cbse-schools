/*
 * The same phone, recognised after the app is reinstalled (director, 10 Oct
 * 2026: "daily some staff phone is not recognising"). A reinstall creates a
 * new punch key, so the phone looked new and waited for approval. The staff
 * app now also sends a SHA-256 of the phone's Android ID (never the raw id);
 * it survives a reinstall of the same app, so a new key from the same phone
 * replaces the old one without asking the office. '' = not known (browser,
 * iPhone, or an older app).
 */
alter table public.staff_punch_devices add column if not exists phone_id text not null default '';
create index if not exists staff_punch_devices_phone_idx on public.staff_punch_devices (tenant_id, staff_id, phone_id) where phone_id <> '';
notify pgrst, 'reload schema';
