import assert from "node:assert/strict";
import { emptyAdmissionLead, type AdmissionLead } from "./admissions";
import { buildLeadTimeline, timelineCounts, timelineTouchpoints } from "./leadTimeline";
import { campaignAttribution, normalizeMarketingSpend } from "./marketingSpend";

console.log("leadTimeline.selftest.ts");
const lead = emptyAdmissionLead({
  id: "L1", mobile: "9999900001", leadDate: "2026-08-10", createdAt: "2026-08-10T05:00:00.000Z", source: "google", campaignId: "cmp_42",
  parentConsentAt: "2026-08-10T05:01:00.000Z", parentConsentBy: "parent (public form)",
  followUps: [{ id: "f1", at: "2026-08-12T06:00:00.000Z", channel: "call", outcome: "interested", note: "asked about bus", by: "Ritu", nextFollowUpAt: "" } as AdmissionLead["followUps"][number]],
});
const ev = buildLeadTimeline({
  lead,
  campaigns: [{ id: "wac_1", name: "Open day" } as never],
  campaignMessages: [
    { id: "m1", campaignId: "wac_1", leadId: "L1", mobile: "9999900001", childName: "", body: "Come visit", status: "sent", sentAt: "2026-08-11T04:00:00.000Z", error: "", waMeUrl: "" },
    { id: "m2", campaignId: "wac_1", leadId: "L1", mobile: "9999900001", childName: "", body: "x", status: "queued", sentAt: "", error: "", waMeUrl: "" },
    { id: "m3", campaignId: "wac_1", leadId: "OTHER", mobile: "9999900002", childName: "", body: "x", status: "sent", sentAt: "2026-08-11T04:00:00.000Z", error: "", waMeUrl: "" },
  ],
  chatThreads: [{ mobile: "919999900001", messages: [{ id: "c1", role: "parent", text: "fees?", at: "2026-08-13T07:00:00.000Z" }, { id: "c2", role: "bot", text: "…", at: "2026-08-13T07:00:05.000Z" }] }],
  waBotThreads: [{ mobile: "9999900003", messages: [{ role: "parent", text: "not me", at: "2026-08-13T08:00:00.000Z" }] }],
});
// Newest first; queued + other-lead messages excluded; milestones present.
assert.equal(ev[0].id, "chat_c2");
assert.ok(ev.some((e) => e.id === "cm_m1") && !ev.some((e) => e.id === "cm_m2") && !ev.some((e) => e.id === "cm_m3"));
assert.ok(ev.some((e) => e.kind === "milestone" && e.title === "Enquiry created" && /cmp_42/.test(e.detail)));
assert.ok(!ev.some((e) => e.kind === "wa_bot"), "other mobile's bot thread excluded");
const c = timelineCounts(ev);
assert.equal(c.inbound, 1);
assert.equal(c.outbound, 3);
const tp = timelineTouchpoints(ev, 3);
assert.equal(tp.length, 3);
assert.match(tp[tp.length - 1], /Bot replied/);
assert.match(tp[0], /Phone call · Interested/);
assert.match(timelineTouchpoints(ev, 4)[0], /Campaign sent/);

// Attribution: source + campaign rows, spend → cost per lead/enrolment; unknown spend = null.
{
  const leads = [
    emptyAdmissionLead({ id: "a", source: "google", campaignId: "cmp_42", stage: "enrolled", leadDate: "2026-07-05" }),
    emptyAdmissionLead({ id: "b", source: "google", campaignId: "cmp_42", stage: "applied", leadDate: "2026-07-06" }),
    emptyAdmissionLead({ id: "c", source: "google", campaignId: "", stage: "enquiry", leadDate: "2026-07-07" }),
    emptyAdmissionLead({ id: "d", source: "walk_in", stage: "lost", leadDate: "2026-07-07" }),
  ];
  const spend = normalizeMarketingSpend({ entries: [{ id: "s1", campaignId: "cmp_42", source: "google", label: "Aug search", amountPaise: 1000000 }] }).entries;
  const rows = campaignAttribution(leads, spend);
  const g = rows.find((r) => r.key === "src:google")!;
  assert.equal(g.leads, 3);
  assert.equal(g.spendPaise, null, "no spend on the source row");
  const cmp = rows.find((r) => r.key === "cmp:cmp_42")!;
  assert.equal(cmp.leads, 2);
  assert.equal(cmp.enrolled, 1);
  assert.equal(cmp.registered, 2);
  assert.equal(cmp.costPerLeadPaise, 500000);
  assert.equal(cmp.costPerEnrolmentPaise, 1000000);
  assert.equal(cmp.conversionPct, 50);
  assert.match(cmp.label, /Aug search/);
  assert.equal(rows.find((r) => r.key === "src:walk_in")!.lost, 1);
}
console.log("OK — leadTimeline.selftest.ts");
