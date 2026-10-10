/**
 * The two SEO rules that fail silently: a Hindi page canonicalised onto its
 * English twin, and the ERP left open to crawlers.
 */
import assert from "node:assert/strict";
import {
  CRAWLER_DISALLOW,
  PUBLIC_ROUTES,
  absoluteUrl,
  languageAlternates,
  pathFor,
} from "@/lib/siteSeo";

function run() {
  // English lives at the root; Hindi carries its prefix.
  assert.equal(pathFor("en", "about"), "/about");
  assert.equal(pathFor("hi", "about"), "/hi/about");
  // The front page of each language.
  assert.equal(pathFor("en", ""), "/");
  assert.equal(pathFor("hi", ""), "/hi");

  // THE BUG THIS EXISTS FOR: a Hindi page must not canonicalise onto English.
  const hi = languageAlternates({ lang: "hi", slug: "about", available: ["en", "hi"] });
  assert.equal(hi.canonical, "/hi/about", "a Hindi page is not the English one");
  assert.equal(hi.languages.hi, "/hi/about");
  assert.equal(hi.languages.en, "/about");
  assert.equal(hi.languages["x-default"], "/about", "printed links point at English");

  const en = languageAlternates({ lang: "en", slug: "about", available: ["en", "hi"] });
  assert.equal(en.canonical, "/about");

  // An untranslated page must not advertise a twin that would 404.
  const only = languageAlternates({ lang: "en", slug: "fees-2027", available: ["en"] });
  assert.equal(only.canonical, "/fees-2027");
  assert.deepEqual(Object.keys(only.languages).sort(), ["en", "x-default"]);
  assert.equal(only.languages.hi, undefined, "never link a translation that does not exist");

  // A Hindi-only page has no x-default, because English is what x-default means
  // here and there is no English page to send anyone to.
  const hiOnly = languageAlternates({ lang: "hi", slug: "suchna", available: ["hi"] });
  assert.equal(hiOnly.canonical, "/hi/suchna");
  assert.equal(hiOnly.languages["x-default"], undefined);

  assert.equal(absoluteUrl("/about"), "https://bhbinternational.school/about");
  assert.equal(absoluteUrl("about"), "https://bhbinternational.school/about");

  // The pages a payment gateway checks must be in the sitemap.
  const paths = PUBLIC_ROUTES.map((r) => r.path);
  for (const must of ["/", "/about", "/contact", "/fee-structure", "/terms", "/privacy", "/refund-policy"]) {
    assert.ok(paths.includes(must), `${must} must be listed for crawlers and reviewers`);
  }

  // The ERP and anything holding a child's record stays out.
  for (const must of ["/api/", "/login", "/parent", "/receipt", "/pay"]) {
    assert.ok(CRAWLER_DISALLOW.includes(must), `${must} must be disallowed`);
  }
  // A disallow that also appears in the sitemap would be telling a crawler
  // both to fetch and not to fetch the same address.
  for (const d of CRAWLER_DISALLOW) {
    assert.ok(!paths.includes(d), `${d} is both listed and disallowed`);
  }

  console.log("siteSeo selftest: ok");
}

run();
