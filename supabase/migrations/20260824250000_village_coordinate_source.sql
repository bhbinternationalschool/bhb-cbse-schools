-- Admissions → where each village's coordinates came from.
--
-- WHY
-- village_demographics.latitude/longitude has three possible origins now and
-- they are not equally trustworthy:
--
--   'osm'    an OpenStreetMap node matched by name — a real mapped place,
--            but OSM has only a handful of villages around Varanasi.
--   'shrug'  the centroid of the Census 2011 village polygon, joined on the
--            PC11 town/village code. Correct to within the village, which is
--            what a driving distance needs, but it is a polygon CENTRE, not a
--            settlement centre or a bus stop.
--   ''       not set.
--
-- Without this column the travel resolver labelled every pre-existing
-- coordinate "osm", which would have described 1,291 imported centroids as
-- OpenStreetMap matches. Mislabelled provenance is how a number nobody can
-- source ends up being trusted more than it deserves.
--
-- It also records the licence obligation. The SHRUG polygons are
-- CC BY-NC-SA 4.0 (Development Data Lab, devdatalab.org/shrug): attribution
-- and share-alike apply, and the licence is NonCommercial. The school was
-- told and chose to proceed; this column is what makes that choice
-- reversible — every affected row can be found and cleared with one query if
-- the position ever changes.

alter table public.village_demographics
  add column if not exists coordinate_source text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'village_demographics_coord_source_chk'
  ) then
    alter table public.village_demographics
      add constraint village_demographics_coord_source_chk
      check (coordinate_source in ('', 'osm', 'shrug', 'manual', 'import'));
  end if;
end
$$;

comment on column public.village_demographics.coordinate_source is
  'Origin of latitude/longitude: osm (name-matched OpenStreetMap node), shrug (Census 2011 village polygon centroid, CC BY-NC-SA, joined on PC11 code), manual, import, or empty. Lets provenance be audited and one source be withdrawn without touching the others.';

create index if not exists village_demographics_coord_source_idx
  on public.village_demographics (tenant_id, coordinate_source)
  where coordinate_source <> '';

notify pgrst, 'reload schema';
