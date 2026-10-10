import type { MetadataRoute } from "next";
import { CRAWLER_DISALLOW, SITE_ORIGIN } from "@/lib/siteSeo";

/**
 * Keep crawlers on the school's public face and out of its ERP.
 *
 * Disallow is not a security control — every path below is already behind
 * authentication. It stops a crawler spending the school's egress on pages it
 * can never read, and stops the ERP's shape being published in search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: CRAWLER_DISALLOW }],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
