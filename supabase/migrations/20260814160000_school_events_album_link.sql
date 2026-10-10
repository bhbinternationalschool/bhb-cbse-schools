-- Events <-> Gallery album linkage — the last item deferred when the
-- Events module was first built. Gallery is a separate, local-first
-- module (localStorage + normalized Supabase mirror), so this is a
-- lookup-only reference, not an enforced foreign key — same pattern
-- Accounts uses for sourceType/sourceId cross-module references.

alter table public.school_events
  add column if not exists album_id text not null default '';
