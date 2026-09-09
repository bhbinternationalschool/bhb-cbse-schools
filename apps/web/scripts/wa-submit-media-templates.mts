/**
 * Submit the MEDIA-header templates, which the ordinary submit path cannot.
 *
 * Meta refuses an IMAGE / VIDEO / DOCUMENT header without an EXAMPLE file, so
 * `buildMetaTemplateCreatePayload` used to warn and drop the header — which
 * meant `bhb_exam_datesheet` and `bhb_open_day_invite` were never submitted at
 * all, and an exam datesheet simply could not be sent to a parent. The example
 * is a sample for Meta's reviewer; every real send supplies its own file.
 *
 * Dry run by default. To actually submit:
 *
 *   ALLOW_LOCAL_PROD_WRITES=1 npx tsx apps/web/scripts/wa-submit-media-templates.mts \
 *     --sample exams_datesheet=/path/sample.pdf:application/pdf \
 *     --sample admissions_open_day=public/logo-crest.png:image/png \
 *     --submit
 *
 * The body text and positional variables come from the ERP's own payload
 * builder, so what Meta approves is exactly what the sender will fill.
 */
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opts = (n: string) =>
  args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]!] : []));

const SUBMIT = flag("--submit");
const SAMPLES = new Map<string, { path: string; mime: string }>();
for (const s of opts("--sample")) {
  const [family, rest] = s.split("=");
  const idx = (rest ?? "").lastIndexOf(":");
  if (!family || idx < 0) throw new Error(`--sample wants family=path:mime, got ${s}`);
  SAMPLES.set(family, { path: rest!.slice(0, idx), mime: rest!.slice(idx + 1) });
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TOKEN = process.env.WA_META_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";
const WABA = process.env.WA_BUSINESS_ACCOUNT_ID || process.env.WHATSAPP_WABA_ID || "";
const GRAPH = process.env.WA_GRAPH_API_VERSION || process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase env missing");
if (!TOKEN || !WABA) throw new Error("WHATSAPP_TOKEN / WHATSAPP_WABA_ID missing");

const {
  buildMetaTemplateCreatePayload,
  markTemplateSubmittedToMeta,
  normalizeWaTemplatesState,
  withSeedText,
} = await import("../src/lib/waTemplates");
type WaTemplatesState = import("../src/lib/waTemplates").WaTemplatesState;

const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function readRegistry() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/wa_templates_state?select=tenant_id,state`,
    { headers: sbHeaders },
  );
  const rows = (await r.json()) as { tenant_id: string; state: WaTemplatesState }[];
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`expected one registry row, got ${JSON.stringify(rows).slice(0, 200)}`);
  }
  return { tenantId: rows[0]!.tenant_id, state: normalizeWaTemplatesState(rows[0]!.state) };
}

async function writeRegistry(tenantId: string, state: WaTemplatesState) {
  if (process.env.ALLOW_LOCAL_PROD_WRITES !== "1") {
    throw new Error("Refusing to write production without ALLOW_LOCAL_PROD_WRITES=1");
  }
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/wa_templates_state?tenant_id=eq.${tenantId}`,
    {
      method: "PATCH",
      headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ state, updated_at: new Date().toISOString() }),
    },
  );
  if (!r.ok) throw new Error(`registry write failed: ${r.status} ${await r.text()}`);
}

/** Two-step resumable upload. The endpoint wants `OAuth`, not `Bearer`. */
async function uploadSample(bytes: Buffer, mime: string): Promise<string> {
  const dbg = await fetch(
    `https://graph.facebook.com/${GRAPH}/debug_token?input_token=${encodeURIComponent(TOKEN)}&access_token=${encodeURIComponent(TOKEN)}`,
  );
  const appId = ((await dbg.json()) as { data?: { app_id?: string } }).data?.app_id;
  if (!appId) throw new Error("could not read app id from the token");

  const start = await fetch(
    `https://graph.facebook.com/${GRAPH}/${appId}/uploads?file_length=${bytes.byteLength}` +
      `&file_type=${encodeURIComponent(mime)}&access_token=${encodeURIComponent(TOKEN)}`,
    { method: "POST" },
  );
  const session = (await start.json()) as { id?: string; error?: { message?: string } };
  if (!session.id) throw new Error(session.error?.message || "upload session failed");

  const put = await fetch(`https://graph.facebook.com/${GRAPH}/${session.id}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${TOKEN}`,
      file_offset: "0",
      "Content-Type": "application/octet-stream",
    },
    body: bytes as unknown as BodyInit,
  });
  const done = (await put.json()) as { h?: string; error?: { message?: string } };
  if (!done.h) throw new Error(done.error?.message || "upload failed");
  return done.h;
}

const { tenantId, state } = await readRegistry();
const media = state.templates.filter(
  (t) => t.headerFormat !== "NONE" && t.headerFormat !== "TEXT",
);
const families = [...new Set(media.map((t) => t.familyKey))];
console.log(`Media-header templates in the registry: ${media.length} across ${families.length} families`);

let next = state;
for (const family of families) {
  const sample = SAMPLES.get(family);
  const rows = media.filter((t) => t.familyKey === family);
  if (!sample) {
    console.log(`  – ${family}: no --sample given, skipping (${rows.map((r) => r.language).join("/")})`);
    continue;
  }
  const bytes = await readFile(sample.path);
  console.log(`\n${family}  sample=${sample.path} (${bytes.byteLength} bytes, ${sample.mime})`);

  // One upload per family: the same example serves both languages.
  let handle = "";
  if (SUBMIT) {
    handle = await uploadSample(bytes, sample.mime);
    console.log(`  handle ${handle.slice(0, 42)}…`);
  }

  for (const t of rows) {
    const desired = withSeedText(t);
    const p = buildMetaTemplateCreatePayload(desired, { headerHandle: handle || "SAMPLE" });
    const header = p.components.find((c) => (c as { type?: string }).type === "HEADER");
    const body = p.components.find((c) => (c as { type?: string }).type === "BODY") as { text: string };
    console.log(`  ${t.metaName} [${t.language}] header=${header ? (header as { format?: string }).format : "MISSING"}`);
    console.log(`      ${body.text.replace(/\n/g, "⏎").slice(0, 150)}`);
    if (p.warnings.length) console.log(`      warnings: ${p.warnings.join("; ")}`);
    if (!SUBMIT) continue;

    const r = await fetch(`https://graph.facebook.com/${GRAPH}/${WABA}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: p.name,
        language: p.language,
        category: p.category,
        components: p.components,
      }),
    });
    const j = (await r.json()) as {
      id?: string;
      status?: string;
      error?: { error_user_msg?: string; message?: string };
    };
    if (!r.ok || !j.id) {
      console.log(`      ✗ ${j.error?.error_user_msg || j.error?.message || r.status}`);
      continue;
    }
    console.log(`      ✓ ${j.id} ${j.status ?? "PENDING"}`);
    // Written after EVERY success, so a crash never leaves a template on
    // Meta that the registry does not know about.
    next = markTemplateSubmittedToMeta(next, t.id, j.id, "script wa-submit-media-templates");
    await writeRegistry(tenantId, next);
  }
}

console.log(SUBMIT ? "\nDone." : "\nDry run — pass --submit to send these to Meta.");
