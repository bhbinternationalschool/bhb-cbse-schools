-- The household geocode has been thrown away on every save since the desk
-- moved to normalized tables.
--
-- WHAT WAS HAPPENING
-- The browser geocodes a family's address and normalizeHousehold keeps eight
-- geo fields, complete with a staleness fingerprint so an edited address
-- invalidates the old pin. Then householdToRow wrote twenty columns to
-- sis_households and none of them were geo, and rowToHousehold read eighteen
-- back and none of them were geo. Every geocode survived until the next load
-- from the server and then vanished.
--
-- WHAT IT COST
-- findMisroutedRiders — "this child's home is closer to a stop on that bus" —
-- is wired into the Riders-by-bus tab and runs on every render. It needs
-- hasGeo, which is false for every household, so it has returned an empty
-- list to a live screen for as long as it has existed. Same for the
-- nearest-stop picker and the route clusters. And the boarding-point audit
-- had to fall back to census village centroids, which place a family in the
-- right village and not at the right corner.
--
-- Columns rather than a jsonb blob, unlike the sis_students.profile fix for
-- the same class of bug: these are read by server-side audits that compare a
-- home against every stop, and a coordinate you cannot filter or index on is
-- half a coordinate.
--
-- The existing geocodes are already gone — this stores what is captured from
-- here on. geo_address_key is what lets the desk notice a pin is stale and
-- re-geocode, so re-populating is a matter of opening the households, not a
-- backfill script.

alter table public.sis_households
  add column if not exists geo_lat double precision,
  add column if not exists geo_lng double precision,
  add column if not exists geo_place_id text,
  add column if not exists geo_formatted_address text,
  add column if not exists geo_geocoded_at text,
  add column if not exists geo_source text,
  add column if not exists geo_confidence text,
  -- Fingerprint of the address fields at the moment the pin was taken. When
  -- the address changes this stops matching and the pin is treated as stale
  -- rather than quietly describing where the family used to live.
  add column if not exists geo_address_key text;

-- Partial: only the geocoded rows, which is what every transport query wants
-- and, today, a small fraction of the table.
create index if not exists sis_households_geo_idx
  on public.sis_households (tenant_id)
  where geo_lat is not null and geo_lng is not null;

comment on column public.sis_households.geo_lat is
  'Google geocode of the family address. Dropped on every save until 2026-09-11; transport stop matching and bus-transfer suggestions are built on it.';

notify pgrst, 'reload schema';
