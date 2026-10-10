import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("commsAttendanceLeaveNoPrune.selftest.ts");

/**
 * Notices, news, albums, photos, notifications, student leave requests, staff
 * registers and the attendance nudges/exceptions were each pruned of every
 * row a desk save did not carry. All of them are also written on the server —
 * WhatsApp class-channel notices and the scheduled-publish cron, job and
 * UDISE notifications, parents' leave from the app, staff punches creating
 * today's register — so a tab that read before those arrived deleted them.
 * Staff registers erased every punch of the day that way.
 *
 * Now nothing is deleted by absence: staff registers never; the rest only by
 * named id. This reads the push code itself, so a prune cannot come back.
 * (Student attendance registers: test:attendance-prune.)
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

function pushOf(src: string, start: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `found ${start}`);
  const ends = ["\nexport ", "\nasync function ", "\nfunction "]
    .map((m) => src.indexOf(m, a + start.length))
    .filter((i) => i > 0);
  return src.slice(a, ends.length ? Math.min(...ends) : undefined);
}

function noDirectDeletes(push: string, label: string, except: RegExp[] = []) {
  let rest = push;
  for (const re of except) rest = rest.replace(re, "");
  assert.equal(/\.delete\(\)/.test(rest), false, `${label}: no direct deletes in the push`);
}

for (const f of [
  "schoolCommsNormalized.server.ts",
  "notificationsNormalized.server.ts",
  "studentLeaveNormalized.server.ts",
  "staffAttendanceNormalized.server.ts",
  "attendanceDeskAncillary.server.ts",
  "attendanceNormalized.server.ts",
]) {
  assert.equal(/deleteStale/.test(read(f)), false, `${f}: no prune-by-absence helper`);
}

// ── School comms: three pushes, one rule ───────────────────────────────────
{
  const src = read("schoolCommsNormalized.server.ts");
  for (const fn of ["pushSchoolCommsDeskToDb", "pushGalleryDeskToDb", "pushNewsDeskToDb"]) {
    const push = pushOf(src, `export async function ${fn}`);
    noDirectDeletes(push, fn);
    assert.ok(/applyNamedCommsDeletes\(sb, tenantId, deletes,/.test(push), `${fn}: named deletes only`);
  }
  for (const r of ["school-comms-desk", "news-desk", "gallery-desk"]) {
    const route = read(`../app/api/school-data/${r}/route.ts`);
    assert.ok(/readNamedDeletes\(body\.deletes, SCHOOL_COMMS_DELETABLE_TABLES\)/.test(route), `${r} reads deletes`);
    assert.ok(/deletes = featureAuthorizedDeletes\(/.test(route), `${r}: function-holder deletes are gate-authorized`);
  }
  // News and gallery pushes send and confirm only their own tables.
  for (const c of ["newsNormalizedClient.ts", "galleryNormalizedClient.ts"]) {
    assert.ok(/OWN_TABLES\.includes\(t\)/.test(read(c)), `${c} confirms only what it applies`);
  }
  const ui = read("schoolComms.ts");
  for (const t of ["notices", "news", "albums", "photos"]) {
    assert.ok(ui.includes(`recordSchoolCommsDeletion("school_comms_desk_${t}"`), `deleting ${t} names it`);
  }
}

// ── Notifications ─────────────────────────────────────────────────────────
{
  const push = pushOf(read("notificationsNormalized.server.ts"), "export async function pushNotificationsDeskToDb");
  noDirectDeletes(push, "notifications");
  assert.ok(/deleteNamedIds\(sb, tenantId, "notifications_desk_items", \[\.\.\.gone\]\)/.test(push));
  assert.ok(/recordNotificationsDeletion\(state\.items\.slice\(50\)/.test(read("notifications.ts")), "only the explicit clear deletes");
}

// ── Student leave ─────────────────────────────────────────────────────────
{
  const push = pushOf(read("studentLeaveNormalized.server.ts"), "export async function pushStudentLeaveDeskToDb");
  noDirectDeletes(push, "student leave");
  assert.ok(/deleteNamedIds\(sb, tenantId, "student_leave_desk_requests", \[\.\.\.gone\]\)/.test(push));
  assert.ok(/recordStudentLeaveDeletion\(id\)/.test(read("studentLeave.ts")));
  assert.ok(/deletes = featureAuthorizedDeletes\(/.test(read("../app/api/school-data/student-leave-desk/route.ts")));
}

// ── Staff attendance: registers never deleted ─────────────────────────────
{
  const push = pushOf(read("staffAttendanceNormalized.server.ts"), "export async function pushStaffAttendanceRegistersToDb");
  noDirectDeletes(push, "staff registers");
  assert.equal(/deleteNamedIds/.test(push), false, "staff registers are never deleted by a save");
  assert.ok(/deleteChildrenNotKept\(\s*sb,\s*tenantId,\s*"staff_attendance_desk_marks",\s*"register_id"/.test(push));
  assert.ok(/stored && stored !== r\.id/.test(push), "a day's stored register stands over a stale copy");
}

// ── Attendance nudges and exceptions ──────────────────────────────────────
{
  const push = pushOf(read("attendanceDeskAncillary.server.ts"), "export async function pushAttendanceDeskAncillaryToDb");
  noDirectDeletes(push, "attendance ancillary");
  assert.ok(/deleteNamedIds\(sb, tenantId, table, \[\.\.\.ids\]\)/.test(push));
  const ui = read("attendance.ts");
  assert.ok(/recordAttendanceDeletion\("attendance_desk_registers", \[registerId\]\)/.test(ui));
  assert.ok(/recordAttendanceDeletion\(\s*"attendance_desk_absent_nudges"/.test(ui));
  // Only superseded OPEN automatic exceptions are named by a rebuild.
  assert.ok(/e\.status === "open" && e\.kind !== "parent_dispute" && !now\.has\(e\.id\)/.test(ui));
  assert.ok(/deletes = featureAuthorizedDeletes\(/.test(read("../app/api/school-data/attendance-registers/route.ts")));
}

console.log("commsAttendanceLeaveNoPrune.selftest: all assertions passed");
