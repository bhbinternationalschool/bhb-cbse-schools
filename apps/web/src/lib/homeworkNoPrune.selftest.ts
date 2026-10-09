import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("homeworkNoPrune.selftest.ts");

/**
 * 9 Oct 2026: three homework posts made from the staff app were erased
 * seconds later by an office browser's desk save, which deleted every post
 * its copy did not hold. A homework save must never delete by absence:
 * posts, submissions and seen marks are never deleted at all, and a diary
 * entry only when its id is named. This reads the push code itself, so a
 * prune cannot quietly come back.
 */

const src = readFileSync(join(__dirname, "homeworkNormalized.server.ts"), "utf8");
const push = src.slice(src.indexOf("export async function pushHomeworkDeskToDb"), src.indexOf("export async function fetchHomeworkDeskFromDb"));
assert.ok(push.length > 200, "found the push code");

for (const table of ["homework_desk_posts", "homework_desk_submissions", "homework_desk_seen"]) {
  const deletes = new RegExp(`from\\("${table}"\\)\\s*\\.delete\\(`);
  assert.equal(deletes.test(push), false, `${table} must never be deleted by a desk save`);
}
assert.equal(/deleteStale\(/.test(push), false, "no prune-by-absence helper in the push");
// Every diary delete is restricted to named ids.
const diaryDeletes = push.match(/from\("homework_desk_diary"\)\s*\.delete\(\)[^;]*;/g) ?? [];
assert.ok(diaryDeletes.length >= 1);
for (const d of diaryDeletes) assert.ok(/\.in\("id", (deleteDiaryIds|gone)\)/.test(d), `diary delete must be by named id: ${d}`);

console.log("homeworkNoPrune.selftest: all assertions passed");
