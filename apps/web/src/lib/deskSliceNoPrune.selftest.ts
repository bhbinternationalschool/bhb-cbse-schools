import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deskSliceDef } from "./deskSliceRegistry";

console.log("deskSliceNoPrune.selftest.ts");

/**
 * The generic slice desks (roles & grants, exam papers, WhatsApp templates,
 * staff HR, advances, agreements, module switches, fee follow-ups,
 * automation, staff chats) deleted every slice a save lacked or sent empty,
 * and replaced every slice it carried with the browser's copy. The shrink
 * guard only stopped losses past 20 rows and half the desk.
 *
 * Now: a slice a save does not carry is left alone; one it carries is
 * written as sent (an empty list is a real edit); and the lists something
 * else also writes — the scheduler tick, other staff browsers, the staff
 * app — are merged by id, never replaced. This reads the code itself.
 */

const src = readFileSync(join(__dirname, "deskSliceNormalized.server.ts"), "utf8");
const push = src.slice(src.indexOf("export async function pushDeskSliceToDb"), src.indexOf("export async function fetchDeskSliceFromDb"));
assert.ok(push.length > 500, "found the push");

assert.equal(/\.delete\(\)/.test(push), false, "no slice row is deleted by a save");
assert.ok(/return Array\.isArray\(payload\);/.test(push), "a carried list is written, empty included");
assert.ok(/mergeWithRevs\(storedNow, incoming, \{ key: field, base: opts\?\.revs\?\.\[key\], union: def\.mergeUnion\?\.\[key\] \}\)/.test(push), "merge slices keep stored rows (with per-row versions)");
assert.ok(push.indexOf("if (existingErr)") < push.indexOf("casWriteSlice("), "nothing is written when the desk cannot be read");
assert.ok(/countPayloadRows\(def, after\)/.test(push), "the shrink guard judges what the desk holds afterwards");
assert.ok(push.indexOf("judgeDeskShrink(") < push.indexOf("casWriteSlice("), "the shrink guard runs before the write");

// The lists written outside this browser merge; the ones the server or the
// UI deletes from stay replaced until they carry named deletes.
const merged = (id: Parameters<typeof deskSliceDef>[0]) => [...(deskSliceDef(id)?.mergeSlices ?? [])].sort();
assert.deepEqual(merged("automation"), ["approvals", "rules", "runs"]);
assert.deepEqual(deskSliceDef("automation")?.mergeCaps?.approvals?.max, 500);
assert.deepEqual(deskSliceDef("automation")?.mergeCaps?.runs?.max, 200);
assert.deepEqual(merged("erp_chat"), ["messages", "threads"]);
assert.deepEqual(merged("staff_chat"), ["messages", "threads"]);
assert.deepEqual(merged("wa_templates"), ["templates"]);
assert.deepEqual(merged("staff_hr"), ["appraisalCycles", "appraisals", "leaveAllotmentLog", "leaveBalances", "leaveEncashments", "leaveRequests", "leaveTypes"]);
assert.deepEqual(merged("fee_recovery_tasks"), ["meetings"]);
assert.deepEqual(deskSliceDef("fee_recovery_tasks")?.mergeCaps?.meetings?.max, 2000);
// The lists the UI deletes from merge too, with the browser naming its
// deletions (test:desk-slice-client-deletes).
assert.deepEqual(merged("rbac"), ["assignments", "audit", "roles", "userGrants"]);
assert.deepEqual(merged("exam_papers"), ["bank", "blueprints", "papers"]);
assert.deepEqual(merged("staff_advances"), ["advances"]);
// Every merge slice is a real list of its module.
for (const id of ["automation", "erp_chat", "staff_chat", "wa_templates", "staff_hr", "fee_recovery_tasks", "rbac", "exam_papers", "staff_advances"] as const) {
  const def = deskSliceDef(id)!;
  for (const k of def.mergeSlices ?? []) assert.ok(def.sliceKeys.includes(k), `${id}.${k} is a slice`);
}

// ── Named deletes on merge slices ─────────────────────────────────────────
// A merge slice keeps what a save lacks, so a server path that removes a row
// must name it — or the row comes back.
assert.ok(/deletes\?: Record<string, readonly string\[\]>/.test(push), "the push takes named deletes");
assert.ok(/if \(def\.objectSlices\.includes\(key\) \|\| !merge\.has\(key\)\) \{/.test(push) && /const gone = new Set\(opts\?\.deletes\?\.\[key\] \?\? \[\]\);/.test(push), "named deletes apply to merge slices");
{
  const withdraw = readFileSync(join(__dirname, "../app/api/v1/staff/leave/withdraw/route.ts"), "utf8");
  assert.ok(/saveStaffHrServer\(next, \{ deletes: \{ leaveRequests: \[id\] \} \}\)/.test(withdraw), "a withdrawn leave request is named");
  const followups = readFileSync(join(__dirname, "api/v1/feeFollowups.server.ts"), "utf8");
  assert.ok(/saveFeeFollowups\(next, replaced\)/.test(followups), "a replaced open follow-up is named");
  assert.ok(/\{ deletes: \{ meetings: deleteIds \} \}/.test(followups));
}

console.log("deskSliceNoPrune.selftest: all assertions passed");
