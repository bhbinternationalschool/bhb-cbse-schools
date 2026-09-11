/**
 * Waive the Security Deposit for named students — as a concession, so every
 * reader agrees at once.
 *
 * Why (2026-09-11): 28 new admissions carried an unpaid "Security Deposit ·
 * April" (₹3,000–4,000 each, ₹93,500 in all). The office had waived it, but
 * nothing in the ERP recorded that: the counter has no waive-deposit action
 * and the admission form does not ask. So the line stayed open, put every
 * one of these families at "S4 Hard since April", and was quoted in each
 * fee reminder and every DUES reply — parents wrote back "only September is
 * pending" and "security deposit kya hai".
 *
 * The one mechanism that zeroes a head is a concession grant. This adds ONE
 * rule (100 % on the deposit head, code SECDEP_WAIVED) and one approved
 * grant per student, ground "director", effective from session start.
 *
 * It writes the way the app writes: the two masters_desk_slices payloads
 * (the authoritative store), the sync-meta revision (so a browser holding
 * an older masters state is refused as stale and rehydrates instead of
 * pushing the grants back out), then the RPC that derives the row tables.
 * Both payloads are snapshotted to .data/ first, so the step is reversible.
 *
 * Idempotent: a student who already holds an approved SECDEP_WAIVED grant is
 * skipped; the rule is created only if absent.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/waive-security-deposit.mts
 *       Dry run: resolves the students, prints the plan, writes nothing.
 *   ALLOW_LOCAL_PROD_WRITES=1 npx tsx scripts/waive-security-deposit.mts --apply
 *       Writes, after a typed confirmation.
 *
 * Afterwards: Fees → Rebuild open dues, so the cached figures (parent app,
 * principal tiles) drop the line too. The bot and the reminders compute live.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { createInterface } from "readline/promises";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  const k = t.slice(0, i);
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const APPLY = process.argv.includes("--apply");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

/** The deposit head and the 28 admission numbers agreed by the director on 2026-09-11. */
const DEPOSIT_HEAD_ID = "fh_st002mvi";
const RULE_ID = "cnc_secdep_waiver_2026";
const RULE_CODE = "SECDEP_WAIVED";
const EFFECTIVE_FROM = "2026-04-01";
const ADMISSION_NOS = [
  "BHB-2025-26-1105", "BHB-2026-27-1165", "BHB-2026-27-1220", "BHB-2026-27-1222", "BHB-2026-27-1223",
  "BHB-2026-27-1224", "BHB-2026-27-1225", "BHB-2026-27-1226", "BHB-2026-27-1227", "BHB-2026-27-1230",
  "BHB-2026-27-1231", "BHB-2026-27-1232", "BHB-2026-27-1233", "BHB-2026-27-1234", "BHB-2026-27-1235",
  "BHB-2026-27-1236", "BHB-2026-27-1237", "BHB-2026-27-1238", "BHB-2026-27-1239", "BHB-2026-27-1240",
  "BHB-2026-27-1241", "BHB-2026-27-1242", "BHB-2026-27-1243", "BHB-2026-27-1244", "BHB-2026-27-1245",
  "BHB-2026-27-1246", "BHB-2026-27-1247", "BHB-2026-27-1248",
];

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: h });
  const j = (await r.json()) as T;
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

type StudentRow = { id: string; admission_no: string; full_name: string; status: string; academic_year_code: string; tenant_id: string };
type Slice = { tenant_id: string; slice_key: string; payload: Record<string, unknown>[]; updated_at: string };
type Meta = { tenant_id: string; slice_count: number; class_count: number; fee_head_count: number; subject_count: number; last_updated_at: string; updated_at: string };

// ── 1. The students, by admission number; exactly one active row each. ──
const inList = ADMISSION_NOS.map((a) => `"${a}"`).join(",");
const rows = await get<StudentRow[]>(`sis_students?admission_no=in.(${inList})&status=eq.active&select=id,admission_no,full_name,status,academic_year_code,tenant_id`);
const byAdm = new Map<string, StudentRow[]>();
for (const r of rows) (byAdm.get(r.admission_no) ?? byAdm.set(r.admission_no, []).get(r.admission_no)!).push(r);
const problems: string[] = [];
const students: StudentRow[] = [];
// SIS keeps one student row per academic year and leaves old ones active
// (see erp-stale-academic-year-rows). The deposit is billed on THIS year's
// row, so that is the one the grant goes on; grants also resolve across the
// admission number's alias rows, so last year's row is covered either way.
const CURRENT_AY = "2026-27";
for (const a of ADMISSION_NOS) {
  const hits = byAdm.get(a) ?? [];
  const pick = hits.length === 1 ? hits : hits.filter((r) => r.academic_year_code === CURRENT_AY);
  if (pick.length !== 1) problems.push(`${a}: ${hits.length} active rows, ${pick.length} in ${CURRENT_AY}`);
  else students.push(pick[0]!);
}
if (problems.length) throw new Error(`Cannot resolve every student, nothing written:\n  ${problems.join("\n  ")}`);
const tenantId = students[0]!.tenant_id;

// ── 2. The masters slices as they stand. ──
const slices = await get<Slice[]>(`masters_desk_slices?tenant_id=eq.${tenantId}&slice_key=in.(concessions,concessionGrants)&select=*`);
const rulesSlice = slices.find((s) => s.slice_key === "concessions");
const grantsSlice = slices.find((s) => s.slice_key === "concessionGrants");
if (!rulesSlice || !grantsSlice) throw new Error("concessions / concessionGrants slices not found — refusing to create them from nothing.");
const meta = (await get<Meta[]>(`masters_desk_sync_meta?tenant_id=eq.${tenantId}&select=*`))[0];
if (!meta) throw new Error("masters_desk_sync_meta row missing — refusing.");
const head = (await get<{ id: string; name_en: string }[]>(`masters_desk_fee_heads?id=eq.${DEPOSIT_HEAD_ID}&select=id,name_en`))[0];
if (!head) throw new Error(`Fee head ${DEPOSIT_HEAD_ID} not found in masters_desk_fee_heads — refusing.`);

const now = new Date().toISOString();
const rules = rulesSlice.payload as Array<Record<string, unknown> & { id: string; code: string }>;
const grants = grantsSlice.payload as Array<Record<string, unknown> & { id: string; concessionId: string; studentId: string; status: string }>;

const ruleExists = rules.some((r) => r.id === RULE_ID || r.code === RULE_CODE);
const newRule = {
  id: RULE_ID,
  code: RULE_CODE,
  name: "Security Deposit waived",
  kind: "other",
  academicYearCode: "*",
  mode: "percent",
  value: 100,
  siblingTiers: [],
  feeHeadIds: [DEPOSIT_HEAD_ID],
  autoApproveMaxPaise: null,
  documentationRequired: false,
  incompatibleCodes: [],
  notes: "Director waived the one-time security deposit for the 2026-27 new admissions listed on 2026-09-11 (scripts/waive-security-deposit.mts). The deposit was never collected, so nothing is refundable.",
  isActive: true,
};

const already = new Set(grants.filter((g) => g.concessionId === RULE_ID && g.status === "approved").map((g) => g.studentId));
const newGrants = students
  .filter((s) => !already.has(s.id))
  .map((s) => ({
    id: `cg_secdep_${s.id.replace(/^stu_/, "")}`,
    concessionId: RULE_ID,
    studentId: s.id,
    status: "approved",
    ground: "director",
    reason: `Security deposit waived by the director · agreed 2026-09-11 · ${s.admission_no}`,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    createdAt: now,
    siblingChildNo: null,
  }));

console.log(`Head: ${head.name_en} (${DEPOSIT_HEAD_ID})`);
console.log(`Rule ${RULE_CODE}: ${ruleExists ? "already present" : "will be created"}`);
console.log(`Students resolved: ${students.length}/${ADMISSION_NOS.length} · already waived: ${already.size} · grants to add: ${newGrants.length}`);
for (const s of students) console.log(`  ${s.admission_no}  ${s.full_name.padEnd(26)} ${s.academic_year_code}  ${already.has(s.id) ? "(already)" : ""}`);
console.log(`Masters revision now: ${meta.updated_at} · ${rules.length} rules · ${grants.length} grants`);

if (!ruleExists && newGrants.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}
if (!APPLY) {
  console.log("\nDry run. Re-run with --apply (and ALLOW_LOCAL_PROD_WRITES=1) to write the rule and grants.");
  process.exit(0);
}
if (process.env.ALLOW_LOCAL_PROD_WRITES !== "1") throw new Error("Set ALLOW_LOCAL_PROD_WRITES=1 to write production.");

// ── 3. Snapshot, confirm, write. ──
mkdirSync(resolve(process.cwd(), ".data"), { recursive: true });
const snap = resolve(process.cwd(), `.data/masters-concessions-snapshot-${now.replace(/[:.]/g, "-")}.json`);
writeFileSync(snap, JSON.stringify({ meta, rulesSlice, grantsSlice }));
console.log(`Snapshot of both slices + meta → ${snap}`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`Type WAIVE ${newGrants.length} to add ${ruleExists ? "" : "the rule and "}${newGrants.length} approved grants: `);
rl.close();
if (answer.trim() !== `WAIVE ${newGrants.length}`) {
  console.log("Aborted.");
  process.exit(1);
}

// The revision must move only if the meta is still what we read — another
// save between our read and this write would otherwise be overwritten.
const fresh = (await get<Meta[]>(`masters_desk_sync_meta?tenant_id=eq.${tenantId}&select=updated_at`))[0];
if (!fresh || fresh.updated_at !== meta.updated_at) throw new Error(`Masters changed underneath (${fresh?.updated_at} ≠ ${meta.updated_at}). Re-run.`);

const nextRules = ruleExists ? rules : [...rules, newRule];
const nextGrants = [...grants, ...newGrants];
const upsert = await fetch(`${URL_}/rest/v1/masters_desk_slices?on_conflict=tenant_id,slice_key`, {
  method: "POST",
  headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify([
    { tenant_id: tenantId, slice_key: "concessions", payload: nextRules, updated_at: now },
    { tenant_id: tenantId, slice_key: "concessionGrants", payload: nextGrants, updated_at: now },
  ]),
});
if (!upsert.ok) throw new Error(`slice upsert → ${upsert.status} ${(await upsert.text()).slice(0, 300)}`);

const metaW = await fetch(`${URL_}/rest/v1/masters_desk_sync_meta?on_conflict=tenant_id`, {
  method: "POST",
  headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify({ ...meta, last_updated_at: now, updated_at: now }),
});
if (!metaW.ok) throw new Error(`sync meta → ${metaW.status} ${(await metaW.text()).slice(0, 300)} — slices ARE written; the revision did not move. Re-run to retry the meta.`);

const rpc = await fetch(`${URL_}/rest/v1/rpc/masters_sync_rows_from_slices`, { method: "POST", headers: h, body: JSON.stringify({ p_tenant_id: tenantId }) });
console.log(`row-table sync rpc → HTTP ${rpc.status} ${(await rpc.text()).slice(0, 200)}`);

// ── 4. Verify from both stores. ──
const afterSlice = await get<Slice[]>(`masters_desk_slices?tenant_id=eq.${tenantId}&slice_key=eq.concessionGrants&select=payload`);
const inSlice = (afterSlice[0]?.payload ?? []).filter((g) => (g as { concessionId: string }).concessionId === RULE_ID).length;
const inRows = await get<{ id: string }[]>(`masters_desk_concession_grants?tenant_id=eq.${tenantId}&concession_id=eq.${RULE_ID}&status=eq.approved&select=id`);
const ruleRow = await get<{ id: string }[]>(`masters_desk_concessions?tenant_id=eq.${tenantId}&id=eq.${RULE_ID}&select=id`);
console.log(`After: ${inSlice} ${RULE_CODE} grants in the slice · ${inRows.length} in the row table · rule row ${ruleRow.length ? "present" : "MISSING"} · revision ${now}`);
if (inSlice !== students.length || inRows.length !== students.length || !ruleRow.length) {
  console.log("MISMATCH — check the row-table sync output above before trusting any screen.");
  process.exit(2);
}
console.log("Done. Now run Fees → Rebuild open dues so cached figures drop the deposit line.");
