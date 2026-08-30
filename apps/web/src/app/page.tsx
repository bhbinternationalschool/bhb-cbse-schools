import { redirect } from "next/navigation";
import { PublicChrome } from "@/components/public/PublicChrome";
import { PublicHome } from "@/components/public/PublicHome";
import { SiteBlocks } from "@/components/public/SiteBlocks";
import { getDemoSession } from "@/lib/auth";
import { HOME_SLUG } from "@/lib/website";
import { getPublishedPage } from "@/lib/website.server";

/**
 * The front page.
 *
 * The director's decision is that the built website replaces this landing
 * page on the same domain. The changeover is by publication rather than by
 * deploy: the moment the office publishes a front page in the Website desk,
 * it takes over here. Until then the hand-written landing page stands, so
 * the domain is never between two websites — and if the new front page is
 * ever unpublished, the old one is still underneath.
 */
export default async function RootPage() {
  const session = await getDemoSession();
  // Signed-out visitors get the public site rather than a bare login form:
  // the legal name, the fee catalogue and the policy pages have to be
  // reachable without credentials for payment-gateway review.
  if (!session) {
    const built = await getPublishedPage("en", HOME_SLUG);
    if (built) {
      return (
        <PublicChrome>
          <article>
            <header className="mx-auto max-w-3xl px-6 pt-14">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                {built.page.title}
              </h1>
            </header>
            <SiteBlocks blocks={built.blocks} media={built.media} />
          </article>
        </PublicChrome>
      );
    }
    return <PublicHome />;
  }
  if (session.persona === "parent") redirect("/parent");
  if (session.persona === "field") redirect("/field");
  redirect("/home");
}
