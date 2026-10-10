/**
 * Structured data for the school, so search engines can render a knowledge
 * panel with the right name, address and phone number.
 *
 * Every field is drawn from publicOrgProfile, which is the file that already
 * has to be exactly right for the payment gateway. Nothing is added here that
 * is not stated there — a school's grade range and affiliation are precisely
 * the claims that must not be embellished, and this file publishes them in
 * machine-readable form where a wrong one travels furthest.
 *
 * The type is EducationalOrganization rather than School: `School` in
 * schema.org carries no meaning this school can substantiate beyond what
 * EducationalOrganization already says, and the narrower type invites the
 * grade-range assumptions that caused trouble once already.
 */

import {
  CONTACT,
  LEGAL_ENTITY_NAME,
  PARENT_BODY_LEGAL_NAME,
  POSTAL_ADDRESS,
  RECOGNITION_STATEMENT,
  TRADING_NAME,
} from "@/lib/publicOrgProfile";
import { SITE_ORIGIN } from "@/lib/siteSeo";

export function SiteJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: TRADING_NAME,
    legalName: PARENT_BODY_LEGAL_NAME ?? LEGAL_ENTITY_NAME,
    url: SITE_ORIGIN,
    // The recognition sentence verbatim, because a paraphrase is how a claim
    // drifts. It says state-recognised for Nursery to Class VIII and no
    // central-board affiliation, which is the fact.
    description: RECOGNITION_STATEMENT,
    address: {
      "@type": "PostalAddress",
      streetAddress: [POSTAL_ADDRESS.line1, POSTAL_ADDRESS.line2]
        .filter(Boolean)
        .join(", "),
      addressLocality: "Varanasi",
      addressRegion: POSTAL_ADDRESS.state,
      postalCode: POSTAL_ADDRESS.pin,
      addressCountry: "IN",
    },
    ...(CONTACT.phone ? { telephone: CONTACT.phone } : {}),
    email: CONTACT.email,
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "admissions",
        ...(CONTACT.phone ? { telephone: CONTACT.phone } : {}),
        email: CONTACT.email,
        areaServed: "IN",
        availableLanguage: ["en", "hi"],
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // The payload is built from constants in this repo, never from user
      // input, so there is no injection surface here. JSON.stringify still
      // escapes it; `<` is the one character that could close the tag early.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
