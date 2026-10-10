import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("staffAttendanceRowStamps.selftest.ts");

/**
 * Staff register: a punch can't be undone by an office tab's old copy, nor
 * by another punch made at the same moment.
 *  - The office desk sends only the registers it changed, stamped with the
 *    register's `updated_at` as loaded; a register and its marks are written
 *    only while the stored register is still at that stamp (rowStampWrite —
 *    driven end to end in test:ptm-row-stamps).
 *  - A punch, a leave day or an outdoor-duty mark writes only that person's
 *    mark row; other rows are added only where the database has none.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

// ── Office desk: stamped ───────────────────────────────────────────────────
{
  const push = read("staffAttendanceNormalized.server.ts");
  const body = push.slice(
    push.indexOf("export async function pushStaffAttendanceRegistersToDb("),
    push.indexOf("async function touchStaffAttendanceMeta("),
  );
  assert.ok(/\.filter\(\(r\) => !stamps \|\| r\.id in stamps\)/.test(body), "a stamped save writes only the registers it changed");
  assert.ok(/writeStampedRows\(\s*sb,\s*"staff_attendance_desk_registers",/.test(body), "the register header is written conditionally");
  assert.ok(/written = active\.filter\(\(r\) => r\.id in w\.stamps\)/.test(body), "marks only for registers whose header landed");
  assert.ok(/!stamps && i < headers\.length/.test(body), "no unconditional header upsert on a stamped save");
  assert.ok(/touchStaffAttendanceMeta\(sb, tenantId, now\)/.test(body), "meta counts come from the table");
  assert.equal(/register_count: 0/.test(push), false, "an empty save no longer sets the count to 0");
  assert.ok(/stamps: stampsOf\(headers\)/.test(push), "the load returns each register's stamp");
}

// ── Punches: one row each ──────────────────────────────────────────────────
{
  const push = read("staffAttendanceNormalized.server.ts");
  const single = push.slice(push.indexOf("export async function pushStaffAttendanceRegisterToDb("));
  assert.ok(/onlyStaffIds\?: readonly string\[\]/.test(single));
  assert.ok(
    /upsert\(marks\.filter\(\(m\) => !mine\.has\(String\(m\.staff_id\)\)\), \{ onConflict: "id", ignoreDuplicates: true \}\)/.test(single),
    "everyone else's row is only added where missing, never overwritten",
  );
  assert.ok(/const own = marks\.filter\(\(m\) => mine\.has\(String\(m\.staff_id\)\)\);/.test(single), "only the punching person's row is written");
  const server = read("staffAttendance.server.ts");
  assert.ok(/pushStaffAttendanceRegisterToDb\(register, \[staffId\]\)/.test(server), "every punch-path save names its person");
  const calls = server.match(/saveStaffPunchRegister\([^)]*\)/g) ?? [];
  const uses = calls.filter((c) => !c.includes("state: StaffAttendanceState"));
  assert.equal(uses.length, 5, "five punch-path saves");
  for (const c of uses) assert.ok(/, opts\.staff(\.id|Id)\)$/.test(c), `names the person: ${c}`);
}

// ── Route + browser ────────────────────────────────────────────────────────
{
  const route = read("../app/api/school-data/staff-attendance-registers/route.ts");
  assert.ok(/readStampsParam\(body\.stamps, \["registers"\]\)\?\.registers/.test(route) && /\}, stamps\);/.test(route));
  assert.ok(/served\.has\(id\)/.test(route), "GET carries only the served registers' stamps");
  const client = read("staffAttendanceNormalizedClient.ts");
  assert.ok(/stamps: sentStamps/.test(client) && /applyStampedSave\(STAFF_ATTENDANCE_DESK/.test(client) && /onStampConflicts\(STAFF_ATTENDANCE_DESK, body\.conflicts\)/.test(client));
  assert.ok(/captureStaffAttendanceStamps\(stamps, loadStaffAttendance\(\)\)/.test(read("staffAttendancePersistence.ts")), "every load captures stamps");
}

console.log("staffAttendanceRowStamps.selftest: all assertions passed");
