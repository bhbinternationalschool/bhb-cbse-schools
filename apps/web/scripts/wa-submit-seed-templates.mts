/**
 * Put the school's WhatsApp templates in front of Meta for review.
 *
 * Two kinds of work, both against the PRODUCTION registry blob
 * (wa_templates_state) and the school's WABA:
 *
 *   1. CREATE every seeded template that has never been submitted — no
 *      metaTemplateId, not approved. On 2026-09-08 that was 60 of 67: the
 *      registry had carried them as "pending" since August, but "pending"
 *      was only the seed's default word; Meta had never seen them.
 *
 *   2. EDIT, in place, an approved template whose registry text differs
 *      from what Meta holds — the daily absence alert, approved in August
 *      with the old "Dear parent" wording. Meta keeps sending the approved
 *      wording until the edit clears review, so nothing goes quiet.
 *
 * Nothing is sent to a parent by this script. It creates and edits template
 * DEFINITIONS; the approval decision is Meta's and arrives by webhook.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/wa-submit-seed-templates.mts
 *       Dry run. Lists what WOULD be created and edited. Default.
 *
 *   ALLOW_LOCAL_PROD_WRITES=1 npx tsx scripts/wa-submit-seed-templates.mts --submit
 *       Real run: creates/edits on Meta and writes the ids and statuses back
 *       to the production registry. Gated behind a typed confirmation.
 *
 *   --only <metaName[,metaName]>   restrict to named templates
 *   --skip-edits                   create only, never edit approved ones
 *   --lang en|hi                   one language only
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createInterface } from "readline/promises";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i);
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    console.error("Missing apps/web/.env.local");
    process.exit(1);
  }
}
loadEnvLocal();

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const SUBMIT = flag("--submit");
const SKIP_EDITS = flag("--skip-edits");
const ONLY = new Set((opt("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const LANG = opt("--lang");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TOKEN = process.env.WA_META_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";
const WABA = process.env.WA_BUSINESS_ACCOUNT_ID || process.env.WHATSAPP_WABA_ID || "";
const GRAPH = process.env.WA_GRAPH_API_VERSION || process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase env missing");
if (!TOKEN || !WABA) throw new Error("WHATSAPP_TOKEN / WHATSAPP_WABA_ID missing");

const {
  buildMetaTemplateCreatePayload,
  buildMetaTemplateEditPayload,
  markTemplateEditedOnMeta,
  markTemplateSubmittedToMeta,
  normalizeWaTemplatesState,
  withSeedText,
} = await import("../src/lib/waTemplates");
type WaTemplatesState = import("../src/lib/waTemplates").WaTemplatesState;
type WaTemplate = import("../src/lib/waTemplates").WaTemplate;

const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function readRegistry(): Promise<{ tenantId: string; state: WaTemplatesState }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/wa_templates_state?select=tenant_id,state`, { headers: sbHeaders });
  const rows = (await r.json()) as { tenant_id: string; state: WaTemplatesState }[];
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`expected one registry row, got ${JSON.stringify(rows).slice(0, 200)}`);
  return { tenantId: rows[0]!.tenant_id, state: normalizeWaTemplatesState(rows[0]!.state) };
}

async function writeRegistry(tenantId: string, state: WaTemplatesState) {
  if (process.env.ALLOW_LOCAL_PROD_WRITES !== "1") {
    throw new Error("Refusing to write production without ALLOW_LOCAL_PROD_WRITES=1");
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/wa_templates_state?tenant_id=eq.${tenantId}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ state, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`registry write failed: HTTP ${r.status} ${await r.text()}`);
}

type MetaComponent = { type: string; format?: string; text?: string; buttons?: { type: string; text: string }[] };
type MetaRow = { name: string; language: string; status: string; id: string; components?: MetaComponent[] };

/** The parts of a template Meta would show a parent, for a like-for-like compare. */
function shapeOf(components: MetaComponent[] | Record<string, unknown>[] | undefined): string {
  const cs = (components ?? []) as MetaComponent[];
  const header = cs.find((c) => c.type === "HEADER");
  const body = cs.find((c) => c.type === "BODY");
  const footer = cs.find((c) => c.type === "FOOTER");
  const buttons = cs.find((c) => c.type === "BUTTONS");
  return JSON.stringify({
    header: header ? `${header.format ?? "TEXT"}:${header.text ?? ""}` : "",
    body: body?.text ?? "",
    footer: footer?.text ?? "",
    buttons: (buttons?.buttons ?? []).map((b) => `${b.type}:${b.text}`),
  });
}
async function readMeta(): Promise<MetaRow[]> {
  const r = await fetch(
    `https://graph.facebook.com/${GRAPH}/${WABA}/message_templates?limit=200&fields=name,language,status,id,components`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  const j = (await r.json()) as { data?: MetaRow[]; error?: { message?: string } };
  if (!j.data) throw new Error(`Meta list failed: ${j.error?.message ?? r.status}`);
  return j.data;
}

async function metaPost(url: string, body: unknown): Promise<{ ok: boolean; id?: string; status?: string; error?: string }> {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; status?: string; success?: boolean; error?: { message?: string; error_user_msg?: string } };
  if (!r.ok || j.success === false) return { ok: false, error: j.error?.error_user_msg || j.error?.message || `HTTP ${r.status}` };
  return { ok: true, id: j.id, status: j.status };
}

function wanted(t: WaTemplate): boolean {
  if (ONLY.size && !ONLY.has(t.metaName)) return false;
  if (LANG && t.language !== LANG) return false;
  if (t.category === "AUTHENTICATION") return false; // Meta writes that text; one exists already
  return true;
}

const { tenantId, state } = await readRegistry();
const meta = await readMeta();
const onMeta = new Map(meta.map((m) => [`${m.name}/${m.language}`, m]));

const toCreate: WaTemplate[] = [];
const toEdit: WaTemplate[] = [];
const skipped: string[] = [];
for (const t of state.templates) {
  if (!wanted(t)) continue;
  if (t.familyKey.startsWith("custom_") || t.familyKey.startsWith("meta_")) {
    skipped.push(`${t.metaName}/${t.language}: school's own, not a seed`);
    continue;
  }
  const payload = buildMetaTemplateCreatePayload(t);
  if (payload.warnings.length) {
    skipped.push(`${t.metaName}/${t.language}: ${payload.warnings.join("; ")}`);
    continue;
  }
  const existing = onMeta.get(`${t.metaName}/${t.language}`);
  if (!existing) {
    toCreate.push(t);
    continue;
  }
  // Already on Meta: the proposal is the SEED's current words. The registry
  // copy of an approved template still holds whatever Meta approved (the
  // normaliser never restyles behind Meta's back), so comparing the registry
  // to Meta would always say "unchanged" — the absence alert did exactly that.
  const desired = withSeedText({ ...t, metaTemplateId: existing.id });
  if (existing.status === "PENDING") {
    skipped.push(`${t.metaName}/${t.language}: in review on Meta right now — edit after the verdict`);
    continue;
  }
  if (shapeOf(existing.components) === shapeOf(buildMetaTemplateCreatePayload(desired).components)) {
    skipped.push(`${t.metaName}/${t.language}: already on Meta as ${existing.status}, same words`);
    continue;
  }
  if (SKIP_EDITS) {
    skipped.push(`${t.metaName}/${t.language}: differs from Meta (${existing.status}) — edits skipped`);
    continue;
  }
  toEdit.push(desired);
}

console.log(`Registry: ${state.templates.length} templates · Meta: ${meta.length} templates\n`);
console.log(`CREATE on Meta (${toCreate.length}):`);
for (const t of toCreate) console.log(`  + ${t.metaName} [${t.language}]  header=${t.headerFormat} buttons=${t.buttons.length}`);
console.log(`\nEDIT in place on Meta (${toEdit.length}):`);
for (const t of toEdit) {
  const now = onMeta.get(`${t.metaName}/${t.language}`)!;
  console.log(`  ~ ${t.metaName} [${t.language}]  id=${t.metaTemplateId}  (${now.status})`);
  console.log(`      now : ${(now.components?.find((c) => c.type === "BODY")?.text ?? "").replace(/\n/g, "⏎")}`);
  const body = buildMetaTemplateCreatePayload(t).components.find((c) => c.type === "BODY") as { text: string };
  console.log(`      new : ${t.headerFormat === "TEXT" ? `[${t.headerText}] ` : ""}${body.text.replace(/\n/g, "⏎")}`);
  if (t.buttons.length) console.log(`      btns: ${t.buttons.map((b) => b.text).join(" | ")}`);
}
console.log(`\nSkipped (${skipped.length}):`);
for (const s of skipped) console.log(`  · ${s}`);

if (!SUBMIT) {
  console.log("\nDry run. Re-run with --submit (and ALLOW_LOCAL_PROD_WRITES=1) to send these to Meta for review.");
  process.exit(0);
}
if (!toCreate.length && !toEdit.length) {
  console.log("\nNothing to do.");
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`\nType SUBMIT to create ${toCreate.length} and edit ${toEdit.length} templates on Meta: `);
rl.close();
if (answer.trim() !== "SUBMIT") {
  console.log("Aborted.");
  process.exit(1);
}

let next = state;
let created = 0;
let edited = 0;
const failures: string[] = [];
for (const t of toCreate) {
  const p = buildMetaTemplateCreatePayload(t);
  const r = await metaPost(`https://graph.facebook.com/${GRAPH}/${WABA}/message_templates`, {
    name: p.name,
    language: p.language,
    category: p.category,
    components: p.components,
  });
  if (!r.ok) {
    failures.push(`${t.metaName}/${t.language}: ${r.error}`);
    console.log(`  ✗ ${t.metaName} [${t.language}] ${r.error}`);
    continue;
  }
  next = markTemplateSubmittedToMeta(next, t.id, r.id ?? "", "script wa-submit-seed-templates");
  created += 1;
  console.log(`  ✓ ${t.metaName} [${t.language}] → ${r.id} ${r.status ?? "PENDING"}`);
  // The registry is written after every success so a crash mid-run never
  // leaves a template on Meta that the registry does not know about.
  await writeRegistry(tenantId, next);
}
for (const t of toEdit) {
  const p = buildMetaTemplateEditPayload(t);
  const r = await metaPost(`https://graph.facebook.com/${GRAPH}/${t.metaTemplateId}`, { components: p.components });
  if (!r.ok) {
    failures.push(`${t.metaName}/${t.language}: ${r.error}`);
    console.log(`  ✗ edit ${t.metaName} [${t.language}] ${r.error}`);
    continue;
  }
  // The registry now carries the words Meta is reviewing, and the Meta id.
  next = {
    ...next,
    templates: next.templates.map((x) => (x.id === t.id ? { ...t, updatedAt: new Date().toISOString() } : x)),
  };
  next = markTemplateEditedOnMeta(next, t.id, "script wa-submit-seed-templates");
  edited += 1;
  console.log(`  ✓ edited ${t.metaName} [${t.language}] (${t.metaTemplateId}) → PENDING review`);
  await writeRegistry(tenantId, next);
}

console.log(`\nDone. Created ${created}, edited ${edited}, failed ${failures.length}.`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log("Meta usually reviews within minutes to 24 hours; statuses arrive by webhook or Masters → WhatsApp templates → Sync from Meta.");
