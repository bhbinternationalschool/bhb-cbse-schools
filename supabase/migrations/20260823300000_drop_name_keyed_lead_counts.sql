-- Admissions → Village market: remove the superseded name-keyed lead count.
--
-- public.village_lead_counts(uuid, text[], text, float) attributed leads by
-- VILLAGE NAME. Names repeat across blocks — "Chandapur" is a real settlement
-- in Harhua, Arajiline and Kashi Vidya Peeth — so it credited one lead to
-- every village sharing the spelling and reported ~30% more leads than exist.
-- village_lead_counts_by_id() replaced it and reconciles exactly with
-- village_block_market() and village_lead_coverage().
--
-- It is dropped rather than left in place because a function that silently
-- returns inflated numbers is a trap: the next caller has no way to know the
-- one beside it is the correct one.

drop function if exists public.village_lead_counts(uuid, text[], text, float);

notify pgrst, 'reload schema';
