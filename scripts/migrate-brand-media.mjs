/**
 * One-time: move brand images out of the masters row and into storage.
 *
 * `masters_desk_slices.schoolProfile` carries a 45 kB base64 favicon because
 * the image picker never uploaded anything. Every masters hydrate downloads
 * it. This decodes each data: URL it finds, puts the bytes in the public
 * `site-media` bucket, and rewrites the field to the resulting URL.
 *
 * Idempotent: a field already holding a URL is left alone.
 * Pass --apply to write; without it, it only reports.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname — the repo lives under a directory with a
// space in its name, and .pathname hands back the percent-encoded form.
const ENV_PATH = fileURLToPath(
  new URL("../apps/web/.env.local", import.meta.url),
);

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv(process.env.ENV_FILE || ENV_PATH);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const TENANT = "6558f3c4-6d12-4636-bf53-17423b0eaad3";
const APPLY = process.argv.includes("--apply");

/** Fields in schoolProfile that hold an image and belong on the public site. */
const PUBLIC_IMAGE_FIELDS = [
  "logoUrl",
  "faviconUrl",
  "watermarkUrl",
  "pageBackgroundUrl",
];

const EXT_FOR = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/x-icon": "png",
  "image/vnd.microsoft.icon": "png",
};

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: row, error } = await sb
  .from("masters_desk_slices")
  .select("payload")
  .eq("tenant_id", TENANT)
  .eq("slice_key", "schoolProfile")
  .single();

if (error) {
  console.error("Could not read schoolProfile:", error.message);
  process.exit(1);
}

const profile = { ...row.payload };
const before = JSON.stringify(profile).length;
let moved = 0;

for (const field of PUBLIC_IMAGE_FIELDS) {
  const value = profile[field];
  if (typeof value !== "string" || !value.startsWith("data:")) {
    if (value) console.log(`  ${field.padEnd(20)} already a URL — left alone`);
    continue;
  }

  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(value);
  if (!m) {
    console.log(`  ${field.padEnd(20)} unreadable data: URL — SKIPPED`);
    continue;
  }
  const [, mime, isB64, payload] = m;
  const bytes = isB64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");

  let ext = EXT_FOR[mime];
  if (!ext) {
    console.log(`  ${field.padEnd(20)} ${mime} is not an allowed type — SKIPPED`);
    continue;
  }

  // Content-addressed, so re-running never uploads a second copy and the
  // one-year cache header can never serve a stale image for a new one.
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const path = `brand/${field.replace(/Url$/, "").toLowerCase()}-${hash}.${ext}`;

  console.log(
    `  ${field.padEnd(20)} ${(bytes.length / 1024).toFixed(0)} kB ${mime} -> ${path}`,
  );

  if (!APPLY) {
    moved++;
    continue;
  }

  const up = await sb.storage.from("site-media").upload(path, bytes, {
    contentType: mime === "image/x-icon" ? "image/png" : mime,
    upsert: true,
    cacheControl: "31536000",
  });
  if (up.error) {
    console.error(`    upload failed: ${up.error.message}`);
    process.exit(1);
  }
  profile[field] = `${url.replace(/\/+$/, "")}/storage/v1/object/public/site-media/${path}`;
  moved++;
}

const after = JSON.stringify(profile).length;
console.log(
  `\n${moved} image(s) ${APPLY ? "moved" : "would move"}; ` +
    `slice ${(before / 1024).toFixed(1)} kB -> ${(after / 1024).toFixed(1)} kB`,
);

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to write.");
  process.exit(0);
}
if (moved === 0) {
  console.log("Nothing to write.");
  process.exit(0);
}

const { error: writeErr } = await sb
  .from("masters_desk_slices")
  .update({ payload: profile, updated_at: new Date().toISOString() })
  .eq("tenant_id", TENANT)
  .eq("slice_key", "schoolProfile");

if (writeErr) {
  console.error("Could not write schoolProfile:", writeErr.message);
  process.exit(1);
}
console.log("schoolProfile updated.");
