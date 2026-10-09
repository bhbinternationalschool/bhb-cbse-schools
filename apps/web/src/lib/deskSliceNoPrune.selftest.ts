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
assert.ok(/value = mergeSliceById\(stored\.get\(key\), payload\)/.test(push), "merge slices keep stored rows");
assert.ok(push.indexOf("if (existingErr)") < push.indexOf(".from(slicesTable).upsert("), "nothing is written when the desk cannot be read");
assert.ok(/countPayloadRows\(def, after\)/.test(push), "the shrink guard judges what the desk holds afterwards");
assert.ok(push.indexOf("judgeDeskShrink(") < push.indexOf(".from(slicesTable).upsert("), "the shrink guard runs before the write");

// The lists written outside this browser merge; the ones the server or the
// UI deletes from stay replaced until they carry named deletes.
const merged = (id: Parameters<typeof deskSliceDef>[0]) => [...(deskSliceDef(id)?.mergeSlices ?? [])].sort();
assert.deepEqual(merged("automation"), ["approvals", "rules", "runs"]);
assert.deepEqual(deskSliceDef("automation")?.mergeCaps?.approvals?.max, 500);
assert.deepEqual(deskSliceDef("automation")?.mergeCaps?.runs?.max, 200);
assert.deepEqual(merged("erp_chat"), ["messages", "threads"]);
assert.deepEqual(merged("staff_chat"), ["messages", "threads"]);
assert.deepEqual(merged("wa_templates"), ["templates"]);
assert.deepEqual(merged("staff_hr"), ["appraisalCycles", "appraisals", "leaveAllotmentLog", "leaveEncashments"]);
for (const id of ["rbac", "exam_papers", "staff_advances", "fee_recovery_tasks"] as const) {
  assert.deepEqual(merged(id), [], `${id}: the UI or the server deletes rows — replaced, not merged`);
}
// Every merge slice is a real list of its module.
for (const id of ["automation", "erp_chat", "staff_chat", "wa_templates", "staff_hr"] as const) {
  const def = deskSliceDef(id)!;
  for (const k of def.mergeSlices ?? []) assert.ok(def.sliceKeys.includes(k), `${id}.${k} is a slice`);
}

console.log("deskSliceNoPrune.selftest: all assertions passed");
