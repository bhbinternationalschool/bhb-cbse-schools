/**
 * The crest must reach a PDF the SERVER renders, not only one a browser does.
 *
 * The school's logo is stored as the relative path `/logo.png?v=2`. A browser
 * resolves that against its own origin. A server has no origin to resolve
 * against, and the loader simply gave up — `if (typeof window === "undefined")
 * return null` — so every server-rendered PDF printed the grey "BHB"
 * placeholder where the crest belongs: the 6 PM brief and the five
 * command-desk reports. Receipts looked right only because
 * receiptPdf.server.ts reads the crest off disk itself, which is why this
 * went unnoticed.
 *
 * Run: npx tsx src/lib/pdfLetterheadAssets.selftest.ts
 */
import assert from "node:assert/strict";
import { resolveAssetUrl } from "./pdfLetterhead";

console.log("pdfLetterheadAssets.selftest.ts");

// This file runs under node: there is no window, which is the case that broke.
assert.equal(typeof window, "undefined", "the point of this test is the server");

const APP = "https://bhbinternational.school";
process.env.NEXT_PUBLIC_APP_URL = APP;

/* The real value from the school profile. */
assert.equal(resolveAssetUrl("/logo.png?v=2"), `${APP}/logo.png?v=2`);
assert.equal(resolveAssetUrl("logo-crest.png"), `${APP}/logo-crest.png`, "a path without a slash still resolves");

/* Absolute URLs and inline data are handed back untouched. */
const supabase = "https://ymamhlcrjsuilzdonkzl.supabase.co/storage/v1/object/public/site-media/brand/favicon.png";
assert.equal(resolveAssetUrl(supabase), supabase);
assert.equal(resolveAssetUrl("http://example.test/a.png"), "http://example.test/a.png");
assert.equal(resolveAssetUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");

/* A trailing slash on the configured origin must not double up. */
process.env.NEXT_PUBLIC_APP_URL = `${APP}/`;
assert.equal(resolveAssetUrl("/logo.png"), `${APP}/logo.png`);

/* With no origin configured the path comes back unchanged, so the caller
 * refuses it rather than fetching something that cannot resolve. */
delete process.env.NEXT_PUBLIC_APP_URL;
delete process.env.APP_URL;
assert.equal(resolveAssetUrl("/logo.png"), "/logo.png");
assert.doesNotMatch(resolveAssetUrl("/logo.png"), /^https?:/);

/* APP_URL is accepted as a fallback name. */
process.env.APP_URL = APP;
assert.equal(resolveAssetUrl("/logo.png"), `${APP}/logo.png`);

console.log("ok");
