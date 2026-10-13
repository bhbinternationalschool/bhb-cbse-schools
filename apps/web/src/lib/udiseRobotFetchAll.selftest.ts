/**
 * Self-test: the robot's "Fetch all children's details to ERP" (13 Oct 2026).
 * Run: npx tsx src/lib/udiseRobotFetchAll.selftest.ts
 *
 * Three readers fill one batch; the send cleared the batch AFTER the ERP
 * replied, so children read meanwhile were dropped. And when the portal
 * read nobody, it still said "✓ Sent …". The Portal ↔ ERP card stayed empty
 * while the list itself (a different button) had arrived.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../../extensions/office-robot");
const js = readFileSync(join(root, "content.js"), "utf8");
const send = js.slice(js.indexOf("const send = async () => {"), js.indexOf("const send = async () => {") + 500);
assert.ok(/const out = batch;\s*batch = \[\];\s*const res = await ask\(\{ type: "student-details", academicYearCode: ay, students: out \}\)/.test(send), "the batch is taken before waiting on the ERP");
assert.ok(!/students: batch \}\);\s*batch = \[\];/.test(js), "never cleared after the reply");
assert.ok(/if \(!saved\) throw new Error\(/.test(js), "reading nobody is an error, not a ✓");

const card = readFileSync(join(__dirname, "../components/students/UdisePortalSyncCard.tsx"), "utf8");
assert.ok(/data && !data\.fetchedAt \?/.test(card), "the card says which robot button fills it");

console.log("udiseRobotFetchAll.selftest.ts\n  ok");
