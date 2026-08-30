import "server-only";

import { unstable_cache, revalidateTag } from "next/cache";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  isPageLive,
  mayPublishMedia,
  rowToBlock,
  rowToMedia,
  rowToPage,
  type SiteBlock,
  type SiteLang,
  type SiteMedia,
  type SitePage,
} from "@/lib/website";

/**
 * Reading the public website.
 *
 * Two things here are load-bearing:
 *
 * CACHE TAGS. A published page is cached until something invalidates it, so
 * the school's site does not hit the database once per visitor. Publishing
 * from the desk calls `revalidateSite`, which drops exactly the affected
 * entries. Without the tag the office would edit a page, see no change, and
 * reasonably conclude the desk was broken.
 *
 * A TIME BOUND AS WELL. Tags cannot cover a page that becomes live on its
 * own — a page scheduled for Monday has no edit to trigger an invalidation.
 * The revalidate window is what makes scheduled publishing actually happen,
 * so it is short enough that "goes live at 9" means within the hour.
 */

const PAGE_TAG = "site-page";
const NAV_TAG = "site-nav";

/** Long enough to be worth caching; short enough that a scheduled page lands. */
const REVALIDATE_SECONDS = 300;

export function pageTag(lang: SiteLang, slug: string): string {
  return `${PAGE_TAG}:${lang}:${slug || "__home__"}`;
}

/**
 * Drop the cached copies a change affects.
 *
 * The nav is always dropped alongside the page: a title change, a new page,
 * or one leaving the menu all alter the header on EVERY other page, and
 * invalidating only the edited page leaves the rest of the site showing a
 * menu that no longer matches.
 */
export function revalidateSite(lang: SiteLang, slug: string): void {
  revalidateTag(pageTag(lang, slug));
  revalidateTag(NAV_TAG);
}

type PageBundle = {
  page: SitePage;
  blocks: SiteBlock[];
  media: Record<string, SiteMedia>;
};

async function loadPage(
  lang: SiteLang,
  slug: string,
): Promise<PageBundle | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;

  const { data: pageRows } = await ctx.sb
    .from("site_pages")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("lang", lang)
    .eq("slug", slug)
    .is("deleted_at", null)
    .limit(1);

  const row = pageRows?.[0];
  if (!row) return null;

  const page = rowToPage(row as Record<string, unknown>);
  // Status and schedule decide this, not the mere existence of a row.
  if (!isPageLive(page, new Date())) return null;

  const { data: blockRows } = await ctx.sb
    .from("site_blocks")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("page_id", page.id)
    .is("deleted_at", null)
    .order("ord", { ascending: true });

  const blocks = (blockRows ?? []).map((b) =>
    rowToBlock(b as Record<string, unknown>),
  );

  // Only the pictures this page actually asks for.
  const wanted = new Set<string>();
  for (const b of blocks) {
    const id = b.payload.mediaId;
    if (typeof id === "string" && id) wanted.add(id);
  }
  if (page.ogMediaId) wanted.add(page.ogMediaId);

  const media: Record<string, SiteMedia> = {};
  if (wanted.size > 0) {
    const { data: mediaRows } = await ctx.sb
      .from("site_media")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .in("id", [...wanted])
      .is("deleted_at", null);

    for (const m of mediaRows ?? []) {
      const item = rowToMedia(m as Record<string, unknown>);
      // Consent is enforced HERE, at the last moment before rendering, and
      // not only in the desk. A picture whose family has objected is left
      // out of the bundle entirely, so it cannot appear on a page it was
      // placed on before the objection was recorded.
      if (mayPublishMedia(item)) media[item.id] = item;
    }
  }

  return { page, blocks, media };
}

export async function getPublishedPage(
  lang: SiteLang,
  slug: string,
): Promise<PageBundle | null> {
  const cached = unstable_cache(
    () => loadPage(lang, slug),
    ["site-page", lang, slug],
    { tags: [pageTag(lang, slug), NAV_TAG], revalidate: REVALIDATE_SECONDS },
  );
  return cached();
}

async function loadNav(lang: SiteLang): Promise<SitePage[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb
    .from("site_pages")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("lang", lang)
    .is("deleted_at", null)
    .order("nav_order", { ascending: true });

  const now = new Date();
  return (data ?? [])
    .map((r) => rowToPage(r as Record<string, unknown>))
    .filter((p) => isPageLive(p, now));
}

/** Every live page, for the menu and the sitemap. */
export async function getLivePages(lang: SiteLang = "en"): Promise<SitePage[]> {
  const cached = unstable_cache(() => loadNav(lang), ["site-nav", lang], {
    tags: [NAV_TAG],
    revalidate: REVALIDATE_SECONDS,
  });
  return cached();
}
