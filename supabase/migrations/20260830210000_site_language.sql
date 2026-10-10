/* ───────────────────────────────────────────────────────────────
   Website Phase 2 — the language decision, taken while it is free.

   The director chose "English now, structured for Hindi later". The
   structuring is this migration and nothing more: a `lang` column, and a
   uniqueness rule that counts a page's address as (language, slug) rather
   than slug alone.

   It is done now, with both tables empty, because it is the one change in
   the whole plan that is genuinely expensive to retrofit. Adding Hindi later
   means dropping and rebuilding a unique index on a table that by then holds
   the school's live pages, and re-addressing every one of them. Today it
   costs an empty-table index swap.

   A Hindi page is a separate row sharing its English twin's slug: About is
   (en, 'about') served at /about, and (hi, 'about') served at /hi/about.
   Translations are therefore linked by the slug they already share — no
   pointer column to keep in step, and no way for the two to drift apart.
   ─────────────────────────────────────────────────────────────── */

alter table public.site_pages
  add column if not exists lang text not null default 'en';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'site_pages_lang_check'
  ) then
    alter table public.site_pages
      add constraint site_pages_lang_check check (lang in ('en', 'hi'));
  end if;
end $$;

-- The address is the pair. Dropping the slug-only rule is what would cost
-- real downtime later; here the table is empty.
drop index if exists public.site_pages_tenant_slug_uidx;

create unique index if not exists site_pages_tenant_lang_slug_uidx
  on public.site_pages (tenant_id, lang, lower(slug))
  where deleted_at is null;

comment on column public.site_pages.lang is
  'en | hi. A translation is a separate row sharing the English slug.';

/* ───────────────────────────────────────────────────────────────
   Photo consent — recording the decision, not changing the shape.

   The director chose blanket consent through the admission form's terms
   rather than a per-child field. The existing CHECK already expresses that
   without alteration:

     not_required — a building, a certificate, nothing identifiable
     granted      — covered by the admission terms (the normal case now)
     withdrawn    — this family objected; the renderer refuses it everywhere

   `withdrawn` is the part worth keeping even under blanket consent. Blanket
   terms are a default, not a waiver: one family can still object, and a
   school with no way to honour that objection has a problem no schema
   change will fix afterwards. `pending` stays legal so the column need not
   be rewritten if a per-child tick is ever added.
   ─────────────────────────────────────────────────────────────── */

comment on column public.site_media.consent_status is
  'Blanket consent via admission terms (decision 2026-08-30). withdrawn is the per-family override and blocks rendering everywhere.';

notify pgrst, 'reload schema';
