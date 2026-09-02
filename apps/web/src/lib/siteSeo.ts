/**
 * What search engines are told about this site.
 *
 * Kept apart from the pages so the rules are stated once and can be tested.
 * Two of them are easy to get wrong and expensive to notice:
 *
 * A Hindi page is NOT a duplicate of its English twin. They share a slug by
 * design — /about and /hi/about — so a canonical that drops the language
 * prefix tells Google the Hindi page IS the English one, and it stops being
 * indexed. Canonical must carry the prefix, and each page must point at its
 * twin with hreflang so the right one is served to the right reader.
 *
 * And the ERP is not the website. /login, /parent, /receipt and the rest are
 * a school's internal system; they must never be indexed, and a crawler
 * walking them is load nobody is paying for.
 */

import { LANGUAGES, type SiteLang } from "@/lib/website";
import { CONTACT } from "@/lib/publicOrgProfile";

/** Absolute origin, no trailing slash. Printed links depend on this exact host. */
export const SITE_ORIGIN = (CONTACT.website || "https://bhbinternational.school").replace(
  /\/$/,
  "",
);

/** `about` + `hi` → `/hi/about`; the root page of a language has no slug. */
export function pathFor(lang: SiteLang, slug: string): string {
  const prefix = LANGUAGES.find((l) => l.id === lang)?.pathPrefix ?? "";
  const parts = [prefix, slug].filter(Boolean);
  return `/${parts.join("/")}`;
}

export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The canonical and hreflang set for one page.
 *
 * `available` is the languages this slug actually exists in — an hreflang
 * pointing at a page that was never translated sends readers to a 404, which
 * is worse than having no hreflang at all.
 */
export function languageAlternates(input: {
  lang: SiteLang;
  slug: string;
  available: SiteLang[];
}): { canonical: string; languages: Record<string, string> } {
  const languages: Record<string, string> = {};
  for (const l of LANGUAGES) {
    if (!input.available.includes(l.id)) continue;
    languages[l.id] = pathFor(l.id, input.slug);
  }
  // x-default is the version to serve when no declared language matches the
  // reader. English is at the root and is what every printed link points to.
  if (input.available.includes("en")) {
    languages["x-default"] = pathFor("en", input.slug);
  }
  return { canonical: pathFor(input.lang, input.slug), languages };
}

/**
 * Routes that are the school's PUBLIC face, and belong in the sitemap.
 *
 * Listed by hand rather than discovered, because "every route under app/" is
 * mostly the ERP. Each entry is a page a parent could arrive at cold.
 */
export const PUBLIC_ROUTES: { path: string; priority: number; changeFrequency: "yearly" | "monthly" | "weekly" }[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/about", priority: 0.8, changeFrequency: "yearly" },
  { path: "/contact", priority: 0.8, changeFrequency: "yearly" },
  { path: "/fee-structure", priority: 0.8, changeFrequency: "yearly" },
  { path: "/apply", priority: 0.9, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/refund-policy", priority: 0.3, changeFrequency: "yearly" },
];

/**
 * Everything a crawler must be kept out of.
 *
 * The ERP, the parent portal, anything holding a receipt or a child's record,
 * and the API. Disallow is not access control — these are all behind auth —
 * it is about not publishing the shape of the system and not paying for
 * crawls of pages no stranger can read.
 */
export const CRAWLER_DISALLOW: string[] = [
  "/api/",
  "/login",
  "/parent",
  "/receipt",
  "/download",
  "/pay",
  "/registration",
  "/field",
  "/visit",
  "/mpd",
  "/pwa",
  "/website",
];
