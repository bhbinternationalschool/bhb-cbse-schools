import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicChrome } from "@/components/public/PublicChrome";
import { SiteBlocks } from "@/components/public/SiteBlocks";
import { getPublishedPage } from "@/lib/website.server";
import { LANGUAGES, type SiteLang } from "@/lib/website";

/**
 * Every page the office builds, served from the database.
 *
 * This is a catch-all, so it answers only for addresses no real route
 * claims — Next resolves a concrete route first. That ordering is the whole
 * reason `RESERVED_SLUGS` exists: a page saved at `fees` or `login` would
 * report itself published, be linked from the menu, and quietly show the ERP
 * instead. The desk refuses those addresses so this file never has to.
 *
 * The legal, fee and policy pages Cashfree reviewed are ordinary routes and
 * keep winning here, unchanged.
 */

/** ['hi','about'] → hi + about;  ['about'] → en + about. */
function readAddress(segments: string[]): { lang: SiteLang; slug: string } {
  const [head, ...rest] = segments;
  const match = LANGUAGES.find((l) => l.pathPrefix && l.pathPrefix === head);
  if (match) return { lang: match.id, slug: rest.join("/") };
  return { lang: "en", slug: segments.join("/") };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug: segments } = await params;
  const { lang, slug } = readAddress(segments ?? []);
  const bundle = await getPublishedPage(lang, slug);
  if (!bundle) return {};

  const { page } = bundle;
  // Falling back to the title and the first paragraph beats publishing an
  // empty <meta>, which is what a blank SEO field would otherwise produce.
  const firstProse = bundle.blocks.find(
    (b) => b.kind === "prose" && typeof b.payload.body === "string",
  );
  const fallbackDescription =
    typeof firstProse?.payload.body === "string"
      ? firstProse.payload.body.replace(/\s+/g, " ").trim().slice(0, 160)
      : undefined;

  return {
    title: page.seoTitle || page.title,
    description: page.seoDescription || fallbackDescription,
    alternates: { canonical: slug ? `/${slug}` : "/" },
  };
}

export default async function SitePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug: segments } = await params;
  const { lang, slug } = readAddress(segments ?? []);
  const bundle = await getPublishedPage(lang, slug);

  // A draft, a scheduled page before its time, or nothing at all. All three
  // are "not found" to the public — a draft must not be readable by anyone
  // who guesses the address.
  if (!bundle) notFound();

  return (
    <PublicChrome>
      <article>
        <header className="mx-auto max-w-3xl px-6 pt-14">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {bundle.page.title}
          </h1>
        </header>
        <SiteBlocks
          blocks={bundle.blocks}
          media={bundle.media}
          live={bundle.live}
        />
      </article>
    </PublicChrome>
  );
}
