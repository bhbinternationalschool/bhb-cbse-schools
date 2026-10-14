/**
 * The UDISE+ working sheet keeps saving under desk_write_guarded v3
 * (data-layer 1.5).
 *
 * v3 refuses a null base on a record that exists. Before 1.5 this caller sent
 * NO base on any write — the sheet row (which exists after the first upload),
 * every child's row on a re-upload, the rows "start a fresh sheet" removes —
 * so on the day v3 is applied every save after the first would have failed
 * ("Saved in this browser only"). This drives the real saveServerSheet /
 * clearServerSheet / loadServerSheet against a fake /api/data that applies
 * v3's base rules, and checks the caller sends the right base every time:
 *  - a record it loaded or wrote: that revision;
 *  - a soft-deleted record (put away earlier): the revision read back via ?ids=;
 *  - a live record it never loaded (the robot wrote it): no base → refused,
 *    and the save says so instead of overwriting;
 *  - "start a fresh sheet": every row put away, whatever wrote it.
 *
 * Run: npx tsx src/lib/udiseUploadServer.selftest.ts
 */
import assert from "node:assert/strict";
import { udiseEmptyRow } from "@/lib/udiseStudentDetails";
import type { UdiseSheetRecord } from "@/lib/udiseUploadStore";
import { clearServerSheet, loadServerSheet, saveServerSheet, sheetIdFor } from "./udiseUploadServer";

type Stored = { row: Record<string, unknown>; updated_at: string; deleted_at: string | null };
const tables: Record<string, Map<string, Stored>> = { "udise.sheets": new Map(), "udise.rows": new Map() };
let clock = Date.parse("2026-10-14T10:00:00.000Z");
const tick = () => new Date((clock += 1000)).toISOString();
const refusals: { id: string; reason: string }[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** /api/data/<collection> with desk_write_guarded v3's rules. */
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "http://local.test");
  const collection = decodeURIComponent(url.pathname.replace("/api/data/", ""));
  const table = tables[collection];
  if (!table) return json(404, { ok: false, code: "not_found", error: "Unknown collection" });
  if (!init?.method || init.method === "GET") {
    const ids = url.searchParams.get("ids");
    if (ids !== null) {
      const rows = ids.split(",").flatMap((id) => {
        const s = table.get(id);
        return s ? [{ id, updated_at: s.updated_at, deleted_at: s.deleted_at }] : [];
      });
      return json(200, { ok: true, rows, nextCursor: null, serverTime: tick() });
    }
    const rows = [...table.entries()]
      .filter(([, s]) => s.deleted_at === null)
      .map(([id, s]) => ({ ...s.row, id, updated_at: s.updated_at, deleted_at: null }));
    return json(200, { ok: true, rows, nextCursor: null, serverTime: tick() });
  }
  const { ops } = JSON.parse(String(init.body)) as {
    ops: { op: string; id: string; base?: string | null; row?: Record<string, unknown> }[];
  };
  const conflicts: { id: string; status: "conflict"; reason: string; revision: string; stored: unknown }[] = [];
  for (const op of ops) {
    const s = table.get(op.id);
    const base = op.base ?? null;
    if (!s) {
      if (base !== null && op.op === "upsert") conflicts.push({ id: op.id, status: "conflict", reason: "deleted", revision: "", stored: null });
      continue;
    }
    if (base === null) conflicts.push({ id: op.id, status: "conflict", reason: "unversioned", revision: s.updated_at, stored: s.row });
    else if (base !== s.updated_at) conflicts.push({ id: op.id, status: "conflict", reason: "stale", revision: s.updated_at, stored: s.row });
  }
  if (conflicts.length) {
    refusals.push(...conflicts.map((c) => ({ id: c.id, reason: c.reason })));
    return json(409, { ok: false, kind: "conflict", message: "nothing was written", conflicts });
  }
  const versions: Record<string, string> = {};
  const results = ops.map((op) => {
    const at = tick();
    const s = table.get(op.id);
    if (op.op === "delete") {
      if (s) {
        s.deleted_at = at;
        s.updated_at = at;
        versions[op.id] = at;
      }
      return { id: op.id, status: "deleted", revision: at };
    }
    const row = { ...(s?.row ?? {}), ...(op.row ?? {}) };
    const deleted = "deleted_at" in (op.row ?? {}) ? (op.row!.deleted_at as string | null) : (s?.deleted_at ?? null);
    table.set(op.id, { row, updated_at: at, deleted_at: deleted });
    versions[op.id] = at;
    return { id: op.id, status: "applied", revision: at };
  });
  return json(200, { ok: true, results, versions });
}) as typeof fetch;

const AY = "2026-27";
const SHEET = sheetIdFor(AY);
const rid = (key: string) => `${SHEET}:${key}`;
const rec = (key: string, name: string, ord = 0): UdiseSheetRecord => ({
  key,
  ord,
  fields: { ...udiseEmptyRow(), fullName: name },
});
const put = (collection: string, id: string, row: Record<string, unknown>, deleted = false) => {
  const at = tick();
  tables[collection]!.set(id, { row, updated_at: at, deleted_at: deleted ? at : null });
};

async function run(): Promise<void> {
  // Production's shape on 14 Oct 2026: one live sheet, rows live and put away.
  put("udise.sheets", SHEET, { academic_year_code: AY, files: [] });
  put("udise.rows", rid("a"), { sheet_id: SHEET, row_key: "a", ord: 0, cells: rec("a", "Asha").fields });
  put("udise.rows", rid("b"), { sheet_id: SHEET, row_key: "b", ord: 1, cells: rec("b", "Bilal").fields });
  put("udise.rows", rid("old"), { sheet_id: SHEET, row_key: "old", ord: 2, cells: rec("old", "Put away").fields }, true);

  const loaded = await loadServerSheet(AY);
  assert.ok(loaded.ok && loaded.sheet, "the sheet loads");
  assert.equal(loaded.ok && loaded.sheet?.records.length, 2, "two live children");

  // 1. A re-upload: one loaded child changed, one new, one revived, one joined away.
  const first = await saveServerSheet({
    academicYearCode: AY,
    files: [{ name: "export.xlsx", at: "2026-10-14", rows: 3 }],
    changed: [rec("a", "Asha K"), rec("new", "Neha"), rec("old", "Put away, back")],
    removed: ["b"],
    actor: "office",
  });
  assert.deepEqual(first, { ok: true, written: 3 }, `the save is accepted (refused: ${JSON.stringify(refusals)})`);
  assert.equal(tables["udise.rows"]!.get(rid("old"))!.deleted_at, null, "the put-away child is revived with its read-back revision");
  assert.ok(tables["udise.rows"]!.get(rid("b"))!.deleted_at, "the joined row is put away");

  // 2. The same page saves again: it uses the revisions its last save returned.
  const second = await saveServerSheet({
    academicYearCode: AY,
    files: [],
    changed: [rec("a", "Asha Kumari"), rec("new", "Neha S")],
    removed: [],
    actor: "office",
  });
  assert.deepEqual(second, { ok: true, written: 2 }, `a second save from the same page is accepted (refused: ${JSON.stringify(refusals)})`);
  assert.equal(refusals.length, 0, "nothing was refused so far");

  // 3. The robot wrote a child this page never loaded: no blind overwrite.
  put("udise.rows", rid("robot"), { sheet_id: SHEET, row_key: "robot", ord: 9, cells: rec("robot", "From the portal").fields });
  const third = await saveServerSheet({
    academicYearCode: AY,
    files: [],
    changed: [rec("robot", "From a file")],
    removed: [],
    actor: "office",
  });
  assert.equal(third.ok, false, "a live row this page never loaded is not overwritten");
  assert.deepEqual(refusals.at(-1), { id: rid("robot"), reason: "unversioned" });
  assert.equal(
    (tables["udise.rows"]!.get(rid("robot"))!.row.cells as { fullName: string }).fullName,
    "From the portal",
    "the robot's row is untouched",
  );

  // 4. Someone else changed a row this page loaded: refused, not overwritten.
  const before = refusals.length;
  tables["udise.rows"]!.get(rid("a"))!.updated_at = tick();
  const fourth = await saveServerSheet({ academicYearCode: AY, files: [], changed: [rec("a", "Mine")], removed: [], actor: "office" });
  assert.equal(fourth.ok, false, "a stale copy is refused");
  assert.equal(refusals.at(-1)?.reason, "stale");
  assert.equal(refusals.length, before + 1);

  // 5. The office reopens the panel (a fresh read), then "Start a fresh
  //    sheet": every row on screen put away — including the robot's, which
  //    the page never loaded — and the sheet.
  assert.ok((await loadServerSheet(AY)).ok, "reload");
  put("udise.rows", rid("robot2"), { sheet_id: SHEET, row_key: "robot2", ord: 10, cells: rec("robot2", "Later pull").fields });
  const cleared = await clearServerSheet(AY, ["a", "new", "old", "robot", "robot2"]);
  assert.deepEqual(cleared, { ok: true }, `start a fresh sheet works (refused: ${JSON.stringify(refusals.slice(before + 1))})`);
  for (const key of ["a", "new", "old", "robot", "robot2"]) {
    assert.ok(tables["udise.rows"]!.get(rid(key))!.deleted_at, `${key} put away`);
  }
  assert.ok(tables["udise.sheets"]!.get(SHEET)!.deleted_at, "the sheet put away");

  // 6. The next upload revives the put-away sheet (its revision read back).
  const fifth = await saveServerSheet({ academicYearCode: AY, files: [], changed: [rec("z", "Zoya")], removed: [], actor: "office" });
  assert.deepEqual(fifth, { ok: true, written: 1 }, "an upload after 'start a fresh sheet' revives the sheet");
  assert.equal(tables["udise.sheets"]!.get(SHEET)!.deleted_at, null, "the sheet is live again");

  console.log("udiseUploadServer selftest: ok");
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
