-- Admissions → Village market: durable cache for OpenStreetMap Overpass.
--
-- WHY: the "Near school" view depends on the public Overpass API, which is
-- routinely overloaded (2026-08-25: main endpoint ~20 s per query with
-- frequent 504s, the kumi.systems fallback mirror plain down with 502). The
-- in-process memo only helps a warm instance; every cold Cloud Run instance
-- had to win the Overpass lottery again, and the office saw "Overpass
-- responded 502" instead of a village list.
--
-- Village nodes move essentially never, so one successful fetch is a good
-- answer for a long time. This table makes that one success durable: any
-- instance that fetches successfully writes here; any instance that cannot
-- reach Overpass serves the stored copy (with its age surfaced as a warning
-- when it is stale), and only errors when there is nothing stored at all.
--
-- Not tenant-scoped: this is public map data keyed by coordinates, carrying
-- nothing of ours. RLS is enabled with no policies — service_role only.

create table if not exists public.osm_place_cache (
  -- "lat:lon:radius" rounded, e.g. "25.435:82.944:10000" — same key the
  -- in-process memo uses, so the two layers always agree.
  cache_key text primary key,
  -- The raw Overpass elements array, exactly as returned.
  payload jsonb not null,
  endpoint text not null default '',
  fetched_at timestamptz not null default now()
);

alter table public.osm_place_cache enable row level security;

grant select, insert, update, delete on public.osm_place_cache to service_role;

notify pgrst, 'reload schema';
