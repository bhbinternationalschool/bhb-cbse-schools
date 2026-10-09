import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("attendanceSideListsForwardOnly.selftest.ts");

/**
 * Attendance side lists: every attendance save rewrote the cut-off policy,
 * the absent-child nudges and the exceptions from the browser's copy — a
 * tab holding last week's cut-off put it back the moment anyone marked a
 * register, and a resolved exception came back open.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const src = read("attendanceDeskAncillary.server.ts");
const push = src.slice(src.indexOf("export async function pushAttendanceDeskAncillaryToDb("), src.indexOf("export async function fetchAttendanceDeskAncillaryFromDb("));

// Policy: written only when changed after the stored one (or none stored).
assert.ok(/if \(spErr\) return \{ ok: false/.test(push), "an unreadable stored policy writes nothing");
assert.ok(/!storedPolicy \|\|\s*\(Number\.isFinite\(policyAt\) && policyAt > Date\.parse\(/.test(push), "newer-only policy write");
assert.ok(/!writePolicy \? \{ error: null \} : await sb\.from\("attendance_desk_policy"\)\.upsert\(/.test(push));
assert.ok(/updated_at: policy\.updatedAt \|\| now/.test(push), "the stored time is the change's own time");
assert.ok(/updatedAt: String\(policyRow\.updated_at \|\| ""\)/.test(src), "a load hands the time to the browser");
const att = read("attendance.ts");
assert.ok(/\.\.\.patch, updatedAt: new Date\(\)\.toISOString\(\)/.test(att), "saving the settings stamps them");
assert.ok(/updatedAt: raw\?\.updatedAt \|\| "",/.test(att), "the normaliser carries the stamp");

// Nudges: insert-only.
assert.ok(/from\("attendance_desk_absent_nudges"\)\s*\.upsert\(rows, \{ onConflict: "id", ignoreDuplicates: true \}\)/.test(push));

// Exceptions: resolved stays resolved; a failed read writes nothing.
assert.ok(/if \(read\.error\) return \{ ok: false/.test(push));
assert.ok(/exceptions\.filter\(\(e\) => e\.status === "resolved" \|\| !resolved\.has\(e\.id\)\)/.test(push));

// Meta from the tables.
assert.equal(/nudge_count: nudges\.length/.test(push), false);
assert.ok(/count\("attendance_desk_exceptions"\)\.eq\("status", "open"\)/.test(push));

// The rule itself, as the push applies it.
const newer = (mine: string, stored: string | null) => {
  const a = Date.parse(mine || "");
  return stored === null || (Number.isFinite(a) && a > Date.parse(stored));
};
assert.equal(newer("2026-10-10T09:00:00Z", "2026-10-10T10:00:00+00:00"), false, "a stale tab's cut-off is not written");
assert.equal(newer("2026-10-10T11:00:00Z", "2026-10-10T10:00:00+00:00"), true, "a later change is");
assert.equal(newer("", "2026-10-10T10:00:00+00:00"), false, "a copy without a time never overwrites");
assert.equal(newer("", null), true, "the first policy is written");

console.log("attendanceSideListsForwardOnly.selftest: all assertions passed");
