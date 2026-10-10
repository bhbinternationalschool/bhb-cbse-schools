-- learning_chapter_outcomes: run as the caller, not as its owner.
--
-- 20260922100000_learning_standards.sql created this view without
-- security_invoker, so it ran with its owner's (postgres) rights and skipped
-- the RLS on textbook_chapter_standards and learning_standards. With SELECT
-- granted to authenticated, any signed-in user could read every tenant's
-- agreed chapter outcomes through PostgREST. Supabase's security advisor
-- reports it as security_definer_view (ERROR).
--
-- With security_invoker the base tables' own policies apply: a signed-in user
-- sees their tenant's reviewed matches (textbook_chapter_standards_tenant_read)
-- joined to the shared reference standards (learning_standards_read). That is
-- exactly what the view was meant to show them.
--
-- The app's two readers (loadAgreedOutcomesByPosition and
-- loadAgreedSkillsByPosition in lib/chapterStandards.server.ts) go through
-- getServerTenantContext, i.e. the service role, which holds SELECT on both
-- base tables and bypasses RLS — so lesson plans and drills read the same rows
-- as before.
--
-- A later CREATE OR REPLACE VIEW of this view must repeat
-- `with (security_invoker = true)`, or it silently drops the option again.

alter view public.learning_chapter_outcomes set (security_invoker = true);

notify pgrst, 'reload schema';
