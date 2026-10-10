/**
 * Phase 5 — the school's own pages, seeded as DRAFTS.
 *
 * What this does and does not do, because the difference matters:
 *
 * It creates the page skeleton — addresses, titles, navigation order and the
 * right block on each page. Where a fact is already verified in
 * publicOrgProfile (the recognition, the classes taught, the constitution)
 * the text is written, because that text is already published elsewhere on
 * this site and must read the same everywhere.
 *
 * It does NOT write prose about the school. A body left empty is deliberate:
 * blockProblem() refuses to publish a page with an empty required field, so
 * nothing seeded here can reach the public until a person has written it.
 * Placeholder copy would defeat that — it would look finished, pass the
 * check, and could be published unread. The school is state-recognised for
 * Nursery to Class VIII, and a generated sentence claiming anything else is
 * the exact mistake that cost a payment-gateway review once already.
 *
 * Everything is created as `draft`, so nothing is public. Re-runnable: rows
 * are addressed by a stable id, so a second run updates rather than
 * duplicates, and it never touches a page whose status has moved on.
 *
 *   node scripts/seed-website-pages.mjs --dry-run
 *   node scripts/seed-website-pages.mjs
 */

import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry-run");
const env = readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8");
const read = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};
const URL_ = read("NEXT_PUBLIC_SUPABASE_URL");
const KEY = read("SUPABASE_SERVICE_ROLE_KEY");
const TENANT = "6558f3c4-6d12-4636-bf53-17423b0eaad3";
if (!URL_ || !KEY) throw new Error("Supabase credentials not found in apps/web/.env.local");

/** Verified, and already published on /about — it must read the same here. */
const RECOGNITION =
  "BHB International School is recognised by the State Government of Uttar " +
  "Pradesh for Nursery to Class VIII. The school is run by Babu Harbans " +
  "Bahadur Singh Smriti Vidya Nyas, a trust registered at the Office of the " +
  "Sub-Registrar I, Varanasi (registration 158 of 2008).";

const CLASSES =
  "The school teaches Nursery to Class VIII.";

/** body: "" means A PERSON MUST WRITE THIS. Publishing is blocked until they do. */
const PAGES = [
  {
    slug: "our-school",
    title: "Our school",
    navOrder: 1,
    blocks: [
      { kind: "prose", payload: { heading: "Recognition", body: RECOGNITION } },
      { kind: "prose", payload: { heading: "About us", body: "" } },
    ],
  },
  {
    slug: "academics",
    title: "Academics",
    navOrder: 2,
    blocks: [
      { kind: "prose", payload: { heading: "Classes", body: CLASSES } },
      { kind: "prose", payload: { heading: "How we teach", body: "" } },
    ],
  },
  {
    slug: "admission-process",
    title: "How to join",
    navOrder: 3,
    blocks: [
      { kind: "prose", payload: { heading: "How admission works", body: "" } },
      // Optional fields only, so this one is publishable as soon as the prose
      // above is written — the form itself needs no copy to work.
      { kind: "enquiry", payload: { heading: "Ask us about admission", intro: "" } },
    ],
  },
  {
    slug: "facilities",
    title: "Facilities",
    navOrder: 4,
    blocks: [{ kind: "prose", payload: { heading: "Our campus", body: "" } }],
  },
  {
    slug: "faculty",
    title: "Our teachers",
    navOrder: 5,
    // `people` is an explicit per-person pick, never "all staff": publishing a
    // roster is a decision about real people, taken one name at a time.
    blocks: [{ kind: "people", payload: { heading: "Our teachers" } }],
  },
  {
    slug: "photo-gallery",
    title: "Photographs",
    navOrder: 6,
    // albumId is required, so this cannot publish until an album is chosen —
    // and consent is checked again at render for every picture in it.
    blocks: [{ kind: "gallery", payload: { heading: "Photographs", albumId: "" } }],
  },
  {
    slug: "calendar",
    title: "School calendar",
    navOrder: 7,
    blocks: [{ kind: "calendar", payload: { heading: "What is coming up", limit: "10" } }],
  },
];

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const now = new Date().toISOString();
let created = 0, updated = 0, skipped = 0, blocksWritten = 0;

for (const p of PAGES) {
  // Stable, readable id — site_pages.id is TEXT, not uuid, because
  // desk_write_guarded compares ids as text.
  const pageId = `seed-en-${p.slug}`;
  const existing = await rest(
    `site_pages?tenant_id=eq.${TENANT}&id=eq.${pageId}&select=id,status,deleted_at`,
  );

  if (existing.length && (existing[0].status !== "draft" || existing[0].deleted_at)) {
    // Someone has published, archived or removed it since. Not ours to touch.
    console.log(`skip    /${p.slug} — status is ${existing[0].status}${existing[0].deleted_at ? " (deleted)" : ""}`);
    skipped++;
    continue;
  }

  const row = {
    id: pageId,
    tenant_id: TENANT,
    lang: "en",
    slug: p.slug,
    title: p.title,
    nav_group: "header",
    nav_order: p.navOrder,
    status: "draft",
    seo_title: "",
    seo_description: "",
    created_by: "seed-website-pages",
    updated_by: "seed-website-pages",
    updated_at: now,
  };

  if (DRY) {
    console.log(`${existing.length ? "would update" : "would create"}  /${p.slug} — ${p.blocks.length} block(s)`);
    continue;
  }

  await rest("site_pages?on_conflict=id", {
    method: "POST",
    body: JSON.stringify(row),
    headers: { Prefer: "return=representation,resolution=merge-duplicates" },
  });
  existing.length ? updated++ : created++;

  for (const [i, b] of p.blocks.entries()) {
    await rest("site_blocks?on_conflict=id", {
      method: "POST",
      body: JSON.stringify({
        id: `${pageId}-b${i + 1}`,
        tenant_id: TENANT,
        page_id: pageId,
        ord: i,
        kind: b.kind,
        payload: b.payload,
        updated_at: now,
      }),
      headers: { Prefer: "return=representation,resolution=merge-duplicates" },
    });
    blocksWritten++;
  }
  console.log(`${existing.length ? "updated" : "created"} /${p.slug} — ${p.blocks.length} block(s)`);
}

console.log(
  DRY
    ? "\nDry run — nothing written."
    : `\n${created} created, ${updated} updated, ${skipped} skipped, ${blocksWritten} blocks. All drafts.`,
);
