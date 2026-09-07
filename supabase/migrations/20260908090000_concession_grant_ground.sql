-- Record WHY a family qualifies for a discount, not just where it was applied.
--
-- Every one of the 149 live grants has a `reason` filled in, so the column
-- looks complete. Read them and 108 say:
--
--   Fee Take · Counter concession · from Tuition Fee · April · receipt RCV-00096
--
-- That is the MECHANISM — where the discount was applied. It is not a ground.
-- For 99 of the 120 children on a concession nobody can now say why they have
-- one, which means nobody can check whether it is still right, renew it on the
-- same basis, or explain it to the parent next door paying full.
--
-- `ground` is deliberately NOT back-filled. There is no honest value to put in
-- those 108 rows, and a guessed one would read exactly like a recorded one.
-- The absence is the finding; it stays visible until somebody who knows the
-- family fills it in.
alter table public.masters_desk_concession_grants
  add column if not exists ground text;

comment on column public.masters_desk_concession_grants.ground is
  'Why the family qualifies: sibling, staff_ward, hardship, merit, rte_ews, '
  'director, correction, other. Empty on grants made before 2026-09-08 — not '
  'back-filled, because nobody recorded it and a guess would look like a fact.';

create index if not exists masters_desk_concession_grants_ground_idx
  on public.masters_desk_concession_grants (tenant_id, ground);
