import type { MetadataRoute } from "next";
import { getLivePages } from "@/lib/website.server";
import { LANGUAGES } from "@/lib/website";
import { PUBLIC_ROUTES, absoluteUrl, pathFor } from "@/lib/siteSeo";

/**
 * Every address a stranger can reach, for search engines.
 *
 * Two sources, because the site has two: the fixed public routes (legal, fee
 * and enquiry pages, which Cashfree reviewed and which must never be
 * unpublishable by an office edit) and whatever the Website desk has actually
 * published, in each language.
 *
 * Live pages are read through the same cached reader the menu uses, so this
 * costs nothing extra per request and refreshes when a page is published.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixed: MetadataRoute.Sitemap = PUBLIC_ROUTES.map((r) => ({
    url: absoluteUrl(r.path),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const built: MetadataRoute.Sitemap = [];
  for (const lang of LANGUAGES) {
    let pages;
    try {
      pages = await getLivePages(lang.id);
    } catch {
      // A sitemap that 500s is worse than one missing the built pages: the
      // fixed routes above are the ones a payment gateway checks.
      continue;
    }
    for (const p of pages) {
      const path = pathFor(lang.id, p.slug);
      // A published page at the empty slug REPLACES the front page, which is
      // already listed above at priority 1.0. Listing it twice would put two
      // entries against one address.
      if (fixed.some((f) => f.url === absoluteUrl(path))) continue;
      built.push({
        url: absoluteUrl(path),
        lastModified: p.updatedAt ? new Date(p.updatedAt as unknown as string) : undefined,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  return [...fixed, ...built];
}
