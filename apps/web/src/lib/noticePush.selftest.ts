/**
 * Self-test: a phone notification when a notice is published, once
 * (director, 13 Oct 2026); payslips one per month.
 * Run: npx tsx src/lib/noticePush.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("noticePush.selftest.ts");

const src = readFileSync(join(__dirname, "noticePush.server.ts"), "utf8");
// Payload: tap opens that notice; the line stops at 200.
assert.ok(/url: `\/notices\?notice=\$\{encodeURIComponent\(n\.id\)\}`/.test(src), "tap opens the notice");
assert.ok(/body\.length > 200 \? `\$\{body\.slice\(0, 197\)\}…`/.test(src));
assert.ok(/data: \{ kind: "notice", noticeId: n\.id \}/.test(src));
// Once, and only fresh notices, never students-only.
assert.ok(src.indexOf("claimNotice(n.id)") > src.indexOf('n.audience === "students"'), "claimed before sending");
assert.ok(/if \(log\.pushed\[noticeId\]\) return false;/.test(src), "a notice already pushed is not pushed again");
assert.ok(/Date\.now\(\) - at > 24 \* 3600 \* 1000/.test(src), "only notices published in the last day");
assert.ok(/audience === "all" \|\| audience === "staff"/.test(src) && /audience === "all" \|\| audience === "parents"/.test(src), "audience decides who");

// Every publish path calls it.
const lib = __dirname;
const app = join(__dirname, "../app/api");
assert.ok(/pushPublishedNotice\(n\)/.test(readFileSync(join(lib, "schoolCommsScheduledPublish.server.ts"), "utf8")), "scheduled publish");
assert.ok(/pushPublishedNotice\(notice\)/.test(readFileSync(join(lib, "schoolNoticePublish.server.ts"), "utf8")), "WhatsApp class-channel drafts");
const desk = readFileSync(join(app, "school-data/school-comms-desk/route.ts"), "utf8");
assert.ok(/pushPublishedNotice\(saved\)/.test(desk) && /saved\?\.status === "published"/.test(desk), "the ERP screen's save, read back first");

// Payslips: one per month, best run wins. The pick lives in
// lib/staffPayslips.ts (shared with the payslip PDF since 13 Oct 2026;
// behaviour tested in staffPayslips.selftest.ts) — the list must use it.
const slipsRoute = readFileSync(join(app, "v1/staff/payslips/route.ts"), "utf8");
assert.ok(/bestPayslipRunsForStaff\(payroll\.runs, staffId\)/.test(slipsRoute), "the payslip list uses the shared pick");
const slips = readFileSync(join(lib, "staffPayslips.ts"), "utf8");
assert.ok(/best\.set\(run\.month, run\)/.test(slips) && /rank\(run\.status\) > rank\(have\.status\)/.test(slips), "one payslip per month, paid first");
assert.ok(/\.filter\(\(m\) => !best\.has\(m\)\)/.test(slips), "'being prepared' only for months with no payslip");

console.log("  ok");
