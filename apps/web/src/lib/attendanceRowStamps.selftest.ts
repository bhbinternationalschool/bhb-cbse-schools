import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildStampedSave, captureRowStamps } from "./rowStampClient";

console.log("attendanceRowStamps.selftest.ts");

/**
 * Attendance registers: an office tab's old copy of a register must not put
 * back the marks a class teacher saved on the app (or approved leave
 * changed) after the tab loaded. The tab sends only registers it changed,
 * stamped with the register's `updated_at` as loaded; a register and its
 * marks are written only while the stored register is still at that stamp.
 * The stamped write itself is driven end to end in test:ptm-row-stamps.
 */

// ── A register is "changed" when any of its marks changed ───────────────────
{
  const reg = (id: string, s1: string) => ({
    id,
    date: "2026-10-09",
    marks: [
      { studentId: "s1", status: s1, note: "" },
      { studentId: "s2", status: "P", note: "" },
    ],
  });
  const local = { registers: [reg("r1", "P"), reg("r2", "P")] };
  captureRowStamps("att-test", { registers: { r1: "t1", r2: "t2" } }, local, ["registers"]);
  assert.deepEqual(buildStampedSave("att-test", local, ["registers"]), { registers: {} }, "nothing changed → nothing sent");
  const edited = { registers: [reg("r1", "A"), reg("r2", "P"), reg("r3", "P")] };
  assert.deepEqual(
    buildStampedSave("att-test", edited, ["registers"]),
    { registers: { r1: "t1", r3: "" } },
    "only the register whose mark changed (from its loaded stamp) and the new one",
  );
}

// ── Wiring ─────────────────────────────────────────────────────────────────
{
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  const push = read("attendanceNormalized.server.ts");
  const body = push.slice(push.indexOf("export async function pushAttendanceRegistersToDb("), push.indexOf("async function touchAttendanceMeta("));
  assert.ok(/\(!stamps \|\| r\.id in stamps\)/.test(body), "a stamped save writes only the registers it changed");
  assert.ok(/writeStampedRows\(\s*sb,\s*"attendance_desk_registers",/.test(body), "the register header is written conditionally");
  assert.ok(/written = active\.filter\(\(r\) => r\.id in w\.stamps\)/.test(body), "marks only for registers whose header landed");
  assert.ok(/!stamps && i < headers\.length/.test(body), "no unconditional header upsert on a stamped save");
  assert.ok(/written\.filter\(\(r\) => \(r\.marks \?\? \[\]\)\.length > 0\)/.test(body), "old marks are cleared only on written registers");
  assert.ok(/touchAttendanceMeta\(sb, tenantId, now\)/.test(body), "meta counts come from the table");
  assert.equal(/register_count: 0/.test(push), false, "an empty save no longer sets the count to 0");
  assert.ok(/stamps: stampsOf\(headers\)/.test(push), "the load returns each register's stamp");
  const route = read("../app/api/school-data/attendance-registers/route.ts");
  assert.ok(/readStampsParam\(body\.stamps, \["registers"\]\)\?\.registers/.test(route) && /\}, deletes, stamps\);/.test(route));
  assert.ok(/stamps: \{ registers: desk\.stamps \}/.test(route), "GET carries the stamps");
  assert.ok(/stamps: stampsOf\(registers, desk\)/.test(route) && /stamps: stampsOf\(cut\.registers, desk\)/.test(route), "a cut desk carries only its registers' stamps");
  const client = read("attendanceNormalizedClient.ts");
  assert.ok(/stamps: sentStamps/.test(client) && /applyStampedSave\(ATTENDANCE_DESK/.test(client) && /onStampConflicts\(ATTENDANCE_DESK, body\.conflicts\)/.test(client));
  assert.ok(/captureAttendanceStamps\(stamps, loadAttendance\(\)\)/.test(read("attendancePersistence.ts")), "every load captures stamps");
}

console.log("attendanceRowStamps.selftest: all assertions passed");
