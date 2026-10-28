/**
 * Acceptance check for data-layer step 1.5 (the write kernel) on the local
 * test stack.
 *
 *   bash scripts/e2e-stack.sh check      (runs acceptance.ts, versions.acceptance.ts, then this)
 *
 * Needs the stack up, the app built with .env.e2e and running. Everything goes
 * through the running app's own routes (POST/GET /api/data/<collection>),
 * with the fixture's signed sessions; the database is read back over the
 * stack's PostgREST with the service key. What it proves:
 *
 *  1. rows (sis.students): a write without a base on an existing row → 409
 *     `unversioned`, nothing written; a stale base → 409 `stale`, nothing
 *     written; the current base → 200 and erp_versions("sis") moves; a delete
 *     by an editor without `students` approve → 403 and the row stays; the
 *     principal can insert (null base on an absent id) and delete, and both
 *     move erp_versions (updated_at and count).
 *  2. teacher reach: the class teacher and the timetable-only teacher list
 *     exactly their sections' student rows through GET /api/data/sis.students
 *     (never the school), sis.households only their families; udise.* and
 *     ?ids= are 403 for them.
 *  3. slices (masters.subjects; element `_rev` bases since 2.2b): each element
 *     carries its `_rev`; a write on it → 200 and `_rev` + 1, erp_versions
 *     ("masters") moves, the masters_desk_subjects row is synced, masters-desk
 *     serves it; a DIFFERENT element from the same load lands; the old `_rev`
 *     → 409 `stale` and nothing written; no base → 409 `unversioned`; Masters
 *     view-only → 403; two ops are one all-or-none batch. Object slice
 *     (masters.school-profile) on its slice stamp.
 *  4. the step 1.1 finding: a class link without isOptional, through the new
 *     route, is saved with isOptional:false and the row tables follow (was:
 *     slice written, rows 500); the old masters-desk POST answers 410 and
 *     writes nothing (data-layer 2.2f).
 *  5. soft delete (udise.sheets): put away, then revived only with the
 *     revision read back through ?ids=.
 * Everything changed is put back exactly as seeded (the Playwright gate runs
 * on this stack next and counts it).
 */

import { assertLocalStack, sessionCookieHeader } from "./session";
import { buildFixture } from "./fixture";
import type { DemoSession } from "@/lib/auth";

type Outcome = { name: string; ok: boolean; detail: string };
const outcomes: Outcome[] = [];
function record(name: string, ok: boolean, detail: string): void {
  outcomes.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const short = (v: unknown) => JSON.stringify(v).slice(0, 220);

async function req(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _text: text.slice(0, 120) };
  }
  return { status: res.status, body: Array.isArray(body) ? { _array: body } : obj(body) };
}

async function main(): Promise<void> {
  assertLocalStack();
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const app = process.env.E2E_APP_URL || "";
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(app)) throw new Error(`E2E_APP_URL is "${app}", not 127.0.0.1`);
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const svc = { apikey: service, Authorization: `Bearer ${service}` };
  const fx = buildFixture();
  const e = fx.expected;
  const as = (s: DemoSession) => ({ cookie: sessionCookieHeader(s) });
  const office = as(fx.sessions.office);
  const principal = as(fx.sessions.principal);
  const teacher = as(fx.sessions.teacher);
  const ttTeacher = as(fx.sessions.timetableTeacher);

  const tenant = await req(`${api}/rest/v1/tenants?slug=eq.bhb-international&select=id`, { headers: svc });
  const tenantId = String(obj(arr(tenant.body._array)[0]).id || "");
  if (!tenantId) throw new Error("no tenant on the stack");
  const versions = async () =>
    obj((await req(`${api}/rest/v1/rpc/erp_versions`, { method: "POST", headers: svc, body: { p_tenant: tenantId } })).body);
  const rest = async (path: string) => arr((await req(`${api}/rest/v1/${path}`, { headers: svc })).body._array).map(obj);
  const post = (collection: string, who: Record<string, string>, ops: unknown[]) =>
    req(`${app}/api/data/${collection}`, { method: "POST", headers: who, body: { ops } });

  // ── 1. Rows: sis.students ──────────────────────────────────────────────
  const target = fx.sis.students.find((s) => s.status === "active")!;
  const stored0 = (await rest(`sis_students?id=eq.${target.id}&tenant_id=eq.${tenantId}&select=id,notes,updated_at`))[0]!;
  const base0 = String(stored0.updated_at);
  const notes0 = stored0.notes ?? null;
  const v0 = obj((await versions()).sis);

  {
    const r = await post("sis.students", office, [{ op: "upsert", id: target.id, base: null, row: { notes: "stale writer" } }]);
    const c = obj(arr(r.body.conflicts)[0]);
    const after = (await rest(`sis_students?id=eq.${target.id}&select=notes,updated_at`))[0]!;
    record(
      "rows: a write with no base on an existing student → 409 unversioned, nothing written",
      r.status === 409 && c.reason === "unversioned" && after.notes === notes0 && after.updated_at === stored0.updated_at,
      `HTTP ${r.status} reason=${String(c.reason)}; notes still ${short(after.notes)}`,
    );
  }
  {
    const r = await post("sis.students", office, [
      { op: "upsert", id: target.id, base: "2020-01-01T00:00:00+00:00", row: { notes: "old copy" } },
    ]);
    const c = obj(arr(r.body.conflicts)[0]);
    const after = (await rest(`sis_students?id=eq.${target.id}&select=notes`))[0]!;
    record(
      "rows: a stale base → 409 stale, nothing written",
      r.status === 409 && c.reason === "stale" && after.notes === notes0,
      `HTTP ${r.status} reason=${String(c.reason)}`,
    );
  }
  let base1 = "";
  {
    const r = await post("sis.students", office, [{ op: "upsert", id: target.id, base: base0, row: { notes: "kernel 1.5" } }]);
    base1 = String(obj(r.body.versions)[target.id] ?? "");
    const v1 = obj((await versions()).sis);
    record(
      "rows: the current base → 200 applied, erp_versions(sis) moved",
      r.status === 200 && !!base1 && v1.updated_at !== v0.updated_at,
      `HTTP ${r.status}; sis ${String(v0.updated_at)} → ${String(v1.updated_at)}`,
    );
  }
  {
    const r = await post("sis.students", office, [{ op: "delete", id: target.id, base: base1 }]);
    const still = await rest(`sis_students?id=eq.${target.id}&select=id`);
    record(
      "rows: deleting a student with students.edit but no approve → 403, the row stays",
      r.status === 403 && still.length === 1,
      `HTTP ${r.status} ${short(r.body.message)}`,
    );
  }
  {
    // Put the notes back as seeded.
    const r = await post("sis.students", office, [{ op: "upsert", id: target.id, base: base1, row: { notes: notes0 } }]);
    record("rows: restored the seeded notes", r.status === 200, `HTTP ${r.status}`);
  }
  {
    const id = "e2e_kernel_probe_student";
    const before = obj((await versions()).sis);
    const ins = await post("sis.students", principal, [
      { op: "upsert", id, base: null, row: { full_name: "Kernel Probe", status: "inactive", admission_no: "KPROBE1" } },
    ]);
    const mid = obj((await versions()).sis);
    const rev = String(obj(ins.body.versions)[id] ?? "");
    const del = await post("sis.students", principal, [{ op: "delete", id, base: rev }]);
    const after = obj((await versions()).sis);
    const gone = (await rest(`sis_students?id=eq.${id}&select=id`)).length === 0;
    record(
      "rows: the principal inserts (null base, absent id) and deletes (approve held); both move erp_versions",
      ins.status === 200 && del.status === 200 && gone &&
        Number(mid.count) === Number(before.count) + 1 && Number(after.count) === Number(before.count) &&
        mid.updated_at !== before.updated_at && after.updated_at !== mid.updated_at,
      `insert ${ins.status}, delete ${del.status}; count ${String(before.count)} → ${String(mid.count)} → ${String(after.count)}`,
    );
  }

  // ── 2. Teacher reach ───────────────────────────────────────────────────
  const listAll = async (collection: string, who: Record<string, string>) => {
    const rows: Record<string, unknown>[] = [];
    let cursor = "";
    for (let i = 0; i < 20; i++) {
      const r = await req(`${app}/api/data/${collection}?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: who });
      if (r.status !== 200) return { status: r.status, rows, body: r.body };
      rows.push(...arr(r.body.rows).map(obj));
      cursor = String(r.body.nextCursor ?? "");
      if (!cursor) break;
    }
    return { status: 200, rows, body: {} };
  };
  {
    const all = await listAll("sis.students", office);
    record("reach: office (students.edit) lists the whole roster", all.status === 200 && all.rows.length === e.studentRows, `${all.rows.length} rows (seeded ${e.studentRows})`);
  }
  for (const [label, who, want, session] of [
    ["class teacher", teacher, e.classTeacherRows, fx.sessions.teacher],
    ["timetable-only teacher", ttTeacher, e.timetableTeacherRows, fx.sessions.timetableTeacher],
  ] as const) {
    const r = await listAll("sis.students", who);
    const pairs = new Set(r.rows.map((x) => `${String(x.class_id)}|${String(x.section_id)}`));
    record(
      `reach: the ${label} lists exactly their sections' student rows`,
      r.status === 200 && r.rows.length === want && want > 0 && pairs.size <= 2,
      `HTTP ${r.status}, ${r.rows.length} rows (want ${want}), sections ${[...pairs].join(" ")}`,
    );
    const hh = await listAll("sis.households", who);
    const theirs = new Set(r.rows.map((x) => String(x.household_id)));
    record(
      `reach: the ${label} lists only their students' households`,
      hh.status === 200 && hh.rows.length > 0 && hh.rows.length === theirs.size && hh.rows.every((h) => theirs.has(String(h.id))),
      `HTTP ${hh.status}, ${hh.rows.length} households (their students' ${theirs.size}; school ${e.households})`,
    );
    const udise = await req(`${app}/api/data/udise.rows`, { headers: who });
    const ids = await req(`${app}/api/data/sis.students?ids=${fx.sis.students[0]!.id}`, { headers: who });
    record(`reach: the ${label} gets 403 for udise.* and for ?ids=`, udise.status === 403 && ids.status === 403, `udise ${udise.status}, ids ${ids.status}`);
    void session;
  }

  // ── 3. Slices: masters.subjects — element `_rev` bases (data-layer 2.2b) ──
  const subjList = await req(`${app}/api/data/masters.subjects?limit=1000`, { headers: principal });
  const subjects = arr(subjList.body.rows).map(obj);
  const subj = subjects.find((s) => s.id === "e2e_sub_eng") ?? subjects[0]!;
  const other = subjects.find((s) => s.id !== subj.id)!;
  const name0 = String(subj.nameEn ?? "");
  const rev0 = String(subj._rev ?? "");
  record(
    "slice: GET masters.subjects = the seeded subjects, each with its own _rev (no slice stamp)",
    subjList.status === 200 && subjects.length === e.subjects && /^[1-9]\d*$/.test(rev0) && subjList.body.revision === undefined,
    `HTTP ${subjList.status}, ${subjects.length} subjects (seeded ${e.subjects}), _rev ${rev0}, revision ${String(subjList.body.revision)}`,
  );
  const mv0 = obj((await versions()).masters);
  let rev1 = "";
  let otherRev = "";
  {
    const r = await post("masters.subjects", principal, [{ op: "upsert", id: subj.id, base: rev0, row: { nameEn: `${name0} (kernel)` } }]);
    rev1 = String(obj(r.body.versions)[String(subj.id)] ?? "");
    const mv1 = obj((await versions()).masters);
    const row = (await rest(`masters_desk_subjects?id=eq.${String(subj.id)}&select=name_en`))[0] ?? {};
    const desk = await req(`${app}/api/school-data/masters-desk`, { headers: principal });
    const served = obj(arr(desk.body.subjects).map(obj).find((s) => s.id === subj.id)).nameEn;
    record(
      "slice: a write on the element's _rev → 200, _rev +1; erp_versions(masters) moved; row table synced; masters-desk serves it",
      r.status === 200 && Number(rev1) === Number(rev0) + 1 && mv1.updated_at !== mv0.updated_at &&
        row.name_en === `${name0} (kernel)` && served === `${name0} (kernel)`,
      `HTTP ${r.status}; _rev ${rev0} → ${rev1}; masters ${String(mv0.updated_at)} → ${String(mv1.updated_at)}; row ${short(row.name_en)}; served ${short(served)}`,
    );
  }
  {
    // Another person, from the SAME load, edits a DIFFERENT subject: it lands (director, 20 Oct).
    const r = await post("masters.subjects", principal, [
      { op: "upsert", id: other.id, base: String(other._rev ?? ""), row: { nameEn: `${String(other.nameEn ?? "")} (B)` } },
    ]);
    otherRev = String(obj(r.body.versions)[String(other.id)] ?? "");
    record(
      "slice: a different element from the same load lands (only the same element conflicts)",
      r.status === 200 && Number(otherRev) === Number(other._rev) + 1,
      `HTTP ${r.status} ${r.status === 200 ? `_rev ${String(other._rev)} → ${otherRev}` : short(r.body.message)}`,
    );
  }
  {
    const r = await post("masters.subjects", principal, [{ op: "upsert", id: subj.id, base: rev0, row: { nameEn: "From an old copy" } }]);
    const c = obj(arr(r.body.conflicts)[0]);
    const now = await req(`${app}/api/data/masters.subjects?limit=1000`, { headers: principal });
    const seen = obj(arr(now.body.rows).map(obj).find((s) => s.id === subj.id));
    record(
      "slice: the element's old _rev → 409 stale, nothing written",
      r.status === 409 && c.reason === "stale" && seen.nameEn === `${name0} (kernel)` && String(seen._rev) === rev1,
      `HTTP ${r.status} reason=${String(c.reason)}; still ${short(seen.nameEn)} at _rev ${String(seen._rev)}`,
    );
  }
  {
    const r = await post("masters.subjects", principal, [{ op: "upsert", id: subj.id, base: null, row: { nameEn: "No base" } }]);
    record("slice: no base on an existing element → 409 unversioned", r.status === 409 && obj(arr(r.body.conflicts)[0]).reason === "unversioned", `HTTP ${r.status}`);
    const v = await post("masters.subjects", office, [{ op: "upsert", id: subj.id, base: rev1, row: { nameEn: "Office" } }]);
    record("slice: Masters view-only (office) → 403", v.status === 403, `HTTP ${v.status}`);
    // Two ops = ONE all-or-none batch: one stale op and nothing of either lands.
    const two = await post("masters.subjects", principal, [
      { op: "upsert", id: subj.id, base: rev1, row: { nameEn: "Batch A" } },
      { op: "upsert", id: other.id, base: String(other._rev ?? ""), row: { nameEn: "Batch B (stale)" } },
    ]);
    const after = arr((await req(`${app}/api/data/masters.subjects?limit=1000`, { headers: principal })).body.rows).map(obj);
    record(
      "slice: two ops in one request are one batch — one stale op → 409 and NEITHER is written",
      two.status === 409 && obj(after.find((s) => s.id === subj.id)).nameEn === `${name0} (kernel)` &&
        obj(after.find((s) => s.id === other.id)).nameEn === `${String(other.nameEn ?? "")} (B)`,
      `HTTP ${two.status} ${short(two.body.message)}`,
    );
    // Both put back in ONE batch on their current _revs.
    const back = await post("masters.subjects", principal, [
      { op: "upsert", id: other.id, base: otherRev, row: { nameEn: other.nameEn } },
    ]);
    record("slice: the other subject put back", back.status === 200, `HTTP ${back.status}`);
  }
  {
    const r = await post("masters.subjects", principal, [{ op: "upsert", id: subj.id, base: rev1, row: { nameEn: name0 } }]);
    const back = await req(`${app}/api/data/masters.subjects?limit=1000`, { headers: principal });
    const restored = obj(arr(back.body.rows).map(obj).find((s) => s.id === subj.id));
    // Content exactly as seeded; the element's `_rev` (data-layer 2.2a) moved on by
    // the rename and the restore — two versions, never a reset.
    const { _rev: revBack, ...restoredContent } = restored;
    const { _rev: revSeed, ...seedContent } = subj;
    record(
      "slice: restored the seeded subject exactly (content; its _rev moved on by 2)",
      r.status === 200 && JSON.stringify(restoredContent) === JSON.stringify(seedContent) && Number(revBack) === Number(revSeed ?? 0) + 2,
      `HTTP ${r.status} ${short(restored.nameEn)}, _rev ${String(revSeed)} → ${String(revBack)}`,
    );
  }
  {
    const prof = await req(`${app}/api/data/masters.school-profile`, { headers: principal });
    const value0 = obj(arr(prof.body.rows).map(obj)[0]).value;
    const rev = String(prof.body.revision ?? "");
    const changed = { ...obj(value0), name: `${String(obj(value0).name ?? "School")} (kernel)` };
    const w = await post("masters.school-profile", principal, [{ op: "upsert", id: "schoolProfile", base: rev || null, row: changed }]);
    const stale = await post("masters.school-profile", principal, [{ op: "upsert", id: "schoolProfile", base: rev || null, row: { name: "old" } }]);
    const back = await post("masters.school-profile", principal, [
      { op: "upsert", id: "schoolProfile", base: String(w.body.revision ?? ""), row: value0 ?? {} },
    ]);
    record(
      "object: masters.school-profile written with its stamp; the old stamp → 409; restored",
      w.status === 200 && stale.status === 409 && back.status === 200,
      `write ${w.status}, stale ${stale.status} (${String(obj(arr(stale.body.conflicts)[0]).reason)}), restore ${back.status}`,
    );
  }

  // ── 4. The step 1.1 finding: a class link without isOptional ───────────
  {
    const cs = await req(`${app}/api/data/masters.class-subjects?limit=1000`, { headers: principal });
    const link = { classId: "e2e_cls_01", subjectId: "e2e_sub_eng", isActive: true, periodsPerWeek: 1 };
    const id = "e2e_kernel_link";
    void cs;
    // A new element: no base (2.2b — element `_rev`s; the new link gets _rev 1).
    const w = await post("masters.class-subjects", principal, [{ op: "upsert", id, base: null, row: link }]);
    const el = obj(arr((await req(`${app}/api/data/masters.class-subjects?limit=1000`, { headers: principal })).body.rows).map(obj).find((x) => x.id === id));
    const row = (await rest(`masters_desk_class_subjects?id=eq.${id}&select=is_optional`))[0] ?? {};
    const del = await post("masters.class-subjects", principal, [{ op: "delete", id, base: String(obj(w.body.versions)[id] ?? "") }]);
    record(
      "1.1 finding (kernel): a class link without isOptional is saved as false and the rows follow",
      w.status === 200 && el.isOptional === false && row.is_optional === false && del.status === 200,
      `write ${w.status}, element isOptional=${String(el.isOptional)}, row is_optional=${String(row.is_optional)}, cleanup ${del.status}`,
    );
  }
  {
    // Since data-layer 2.2f the old masters-desk POST is gone: the same body
    // answers 410 build_stale and writes nothing (no slice, no row).
    const desk = await req(`${app}/api/school-data/masters-desk`, { headers: principal });
    const links = arr(desk.body.classSubjects).map(obj);
    const stamp = String(obj(desk.body.sliceStamps).classSubjects || "");
    const extra = { id: "e2e_kernel_link_old", classId: "e2e_cls_01", subjectId: "e2e_sub_eng", isActive: true, periodsPerWeek: 1 };
    const w = await req(`${app}/api/school-data/masters-desk`, {
      method: "POST",
      headers: principal,
      body: { classSubjects: [...links, extra], sliceBases: { classSubjects: stamp } },
    });
    const rows = await rest(`masters_desk_class_subjects?id=eq.${extra.id}&select=id`);
    const back = await req(`${app}/api/school-data/masters-desk`, { headers: principal });
    record(
      "1.1 finding (old masters-desk POST): gone since 2.2f — 410 build_stale, nothing written",
      w.status === 410 && obj(w.body).reason === "build_stale" && rows.length === 0 &&
        arr(back.body.classSubjects).length === links.length,
      `write ${w.status} ${short(w.body)}, rows ${rows.length}, links ${arr(back.body.classSubjects).length}/${links.length}`,
    );
  }

  // ── 5. Soft delete and revival (udise.sheets) ───────────────────────────
  {
    const id = "udise-e2e-kernel";
    const ins = await post("udise.sheets", office, [{ op: "upsert", id, base: null, row: { academic_year_code: "2026-27", files: [] } }]);
    const r1 = String(obj(ins.body.versions)[id] ?? "");
    const again = await post("udise.sheets", office, [{ op: "upsert", id, base: null, row: { files: [] } }]);
    const del = await post("udise.sheets", office, [{ op: "delete", id, base: r1 }]);
    const looked = await req(`${app}/api/data/udise.sheets?ids=${id}`, { headers: office });
    const seen = obj(arr(looked.body.rows).map(obj)[0]);
    const blind = await post("udise.sheets", office, [{ op: "upsert", id, base: null, row: { deleted_at: null } }]);
    const revive = await post("udise.sheets", office, [{ op: "upsert", id, base: String(seen.updated_at ?? ""), row: { deleted_at: null } }]);
    const fin = await post("udise.sheets", office, [{ op: "delete", id, base: String(obj(revive.body.versions)[id] ?? "") }]);
    record(
      "soft delete: put away; ?ids= returns it with its revision; reviving blind → 409, with the revision → 200",
      ins.status === 200 && again.status === 409 && del.status === 200 && looked.status === 200 && seen.deleted_at != null &&
        blind.status === 409 && revive.status === 200 && fin.status === 200,
      `insert ${ins.status}, null-base again ${again.status}, delete ${del.status}, ids ${looked.status} (deleted_at ${short(seen.deleted_at)}), blind ${blind.status}, revive ${revive.status}, put away ${fin.status}`,
    );
  }

  const failed = outcomes.filter((o) => !o.ok);
  console.log(`\n${outcomes.length - failed.length}/${outcomes.length} passed (data-layer 1.5)`);
  if (failed.length) {
    console.log("failed:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
