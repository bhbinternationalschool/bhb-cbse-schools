import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalCallout,
  LegalList,
  LegalPage,
  LegalSection,
} from "@/components/public/LegalPage";
import { CONTACT } from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Cookie policy",
  description:
    "Every cookie bhbinternational.school sets, what it does, how long it lasts, and why the site shows no cookie banner.",
};

/**
 * Cookie policy.
 *
 * The honest version of this page is short, because the site genuinely has no
 * analytics, no advertising and no third-party tags — the three cookies below
 * are the whole list, and each one is strictly necessary. Keeping the list
 * exhaustive is the point: a policy that names three cookies is checkable, and
 * a reader who opens their browser's storage inspector should find exactly
 * these and nothing else.
 *
 * If a tag, pixel or analytics script is ever added, it goes in COOKIES on
 * the same commit, and the "no banner" reasoning in section 4 has to be
 * revisited — consent is required the moment a cookie stops being necessary
 * for a service the user asked for.
 *
 * Static content, no auth, no client JS.
 */

type CookieEntry = {
  name: string;
  purpose: string;
  life: string;
};

/** Every cookie this origin sets. Verified against the code, not assumed. */
const COOKIES: CookieEntry[] = [
  {
    name: "bhb_demo_session",
    purpose:
      "Keeps you signed in to the parent and staff portal, and records which academic year you are working in. It is signed by the server, holds no password, and is not readable by scripts in your browser.",
    life: "Until you sign out or close the browser, and in any case ends after 30 minutes of inactivity.",
  },
  {
    name: "bhb_google_oauth_state",
    purpose:
      "Set for a few seconds while a school administrator connects the school's Google Workspace account, to prove the reply came back from Google and not from somewhere else. Never set for a parent.",
    life: "Ten minutes, or until the connection completes.",
  },
  {
    name: "bhb_meta_oauth_state",
    purpose:
      "The same one-time check when an administrator connects the school's Meta account for WhatsApp messaging. Never set for a parent.",
    life: "Ten minutes, or until the connection completes.",
  },
];

export default function CookiePolicyPage() {
  return (
    <LegalPage
      title="Cookie policy"
      updated="6 September 2026"
      current="/cookie-policy"
      summary={
        <p>
          This site sets three cookies, all of them necessary to sign you in and
          keep the sign-in safe. There is no advertising cookie, no analytics
          cookie, no tracking pixel and no third-party tag anywhere on the site,
          which is why you are not asked to accept anything on arrival.
        </p>
      }
    >
      <LegalSection n={1} title="What a cookie is here">
        <p>
          A cookie is a small piece of text a website asks your browser to keep
          and send back on your next request. We use them for one thing: so that
          the server knows the page you just asked for belongs to the person who
          signed in a moment ago. Without that, you would have to sign in again
          on every screen.
        </p>
      </LegalSection>

      <LegalSection n={2} title="Every cookie this site sets">
        <dl className="mt-4 space-y-4">
          {COOKIES.map((c) => (
            <div
              key={c.name}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <dt className="font-mono text-[13px] font-medium text-slate-900">
                {c.name}
              </dt>
              <dd className="mt-2">{c.purpose}</dd>
              <dd className="mt-2 text-sm text-slate-500">
                <span className="font-medium text-slate-700">How long:</span>{" "}
                {c.life}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4">
          All three are set by this site itself. None is set by an advertiser,
          an analytics company or a social network, and none is readable by
          another website.
        </p>
      </LegalSection>

      <LegalSection n={3} title="What we do not use">
        <LegalList>
          <li>
            No advertising or retargeting cookies, and no advertising
            identifiers. The school sells no advertising space and buys no ads
            that track you here.
          </li>
          <li>
            No third-party analytics — no Google Analytics, no Meta pixel, no
            heatmap or session-recording tool. We do not measure your visit.
          </li>
          <li>
            No cross-site tracking, and nothing that follows you after you leave
            this site.
          </li>
        </LegalList>
        <p>
          When you pay fees, the payment itself happens on the payment
          gateway&rsquo;s own pages. Anything that gateway sets there is theirs,
          governed by its own policy, and is used to complete and secure your
          transaction.
        </p>
      </LegalSection>

      <LegalSection n={4} title="Why there is no cookie banner">
        <p>
          A consent banner exists to ask permission for cookies that are not
          needed to provide the service you asked for — chiefly advertising and
          analytics. We set none of those. A cookie that only keeps you signed
          in is necessary for the very thing you came to do, and asking you to
          consent to it would be a formality with no choice behind it.
        </p>
        <LegalCallout>
          If the school ever adds analytics or any third-party tag, this page
          will list it and you will be asked before it is set. That is a
          commitment, not an intention.
        </LegalCallout>
      </LegalSection>

      <LegalSection n={5} title="Other things stored on your device">
        <p>
          Two more kinds of storage are worth naming, because a browser&rsquo;s
          privacy settings treat them alongside cookies:
        </p>
        <LegalList>
          <li>
            <strong>Local storage in the portal.</strong> Once you are signed
            in, the portal keeps a working copy of the screens you use on your
            own device so they open without waiting for the network. It is a
            cache of data you are already entitled to see, it never leaves your
            browser, and clearing your site data removes it.
          </li>
          <li>
            <strong>The mobile app.</strong> The app keeps a signed sign-in
            token and the same kind of cached copy. Uninstalling the app removes
            both. What the app asks your phone for is set out in the{" "}
            <Link
              className="font-medium text-slate-900 underline underline-offset-4"
              href="/privacy"
            >
              privacy policy
            </Link>
            .
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection n={6} title="Refusing or clearing cookies">
        <p>
          Every browser lets you block or delete cookies for a site, under
          Settings → Privacy. Blocking ours is allowed and breaks nothing you
          can read without signing in — the public pages, the fee structure and
          these policies all work. You will not be able to sign in to the
          portal, because staying signed in is what the cookie is for.
        </p>
        <p>
          Questions about anything on this page can go to{" "}
          <a
            className="font-medium text-slate-900 underline underline-offset-4"
            href={`mailto:${CONTACT.email}?subject=Cookie%20policy`}
          >
            {CONTACT.email}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
