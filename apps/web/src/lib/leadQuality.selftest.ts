import assert from "node:assert/strict";
import { emptyAdmissionLead, type AdmissionLead } from "./admissions";
import { engagementCtxFromChat, leadQuality, stalledLeadFlags } from "./leadQuality";

console.log("leadQuality.selftest.ts");
const today = "2026-08-19";
const mk = (p: Partial<AdmissionLead>) => emptyAdmissionLead({ stage: "enquiry", leadDate: "2026-08-10", mobile: "9999900001", ...p });
const ctx0 = engagementCtxFromChat([], today);

// Unknown → warm, never cold.
{
  const q = leadQuality(mk({}), ctx0);
  assert.equal(q.quality, "warm");
  assert.equal(q.signals.length, 0);
}
// Engagement lifts to hot; chat-widget threads count by mobile.
{
  const ctx = engagementCtxFromChat([{ mobile: "9999900001", messages: [{ role: "parent", at: "2026-08-18T10:00:00Z" }, { role: "bot", at: "2026-08-18T10:00:01Z" }] }], today);
  const lead = mk({
    whatsappWaId: "919999900001",
    concerns: ["fees"],
    followUps: [{ id: "f1", at: "2026-08-17T09:00:00Z", channel: "call", outcome: "interested", note: "", by: "R", nextFollowUpAt: "" } as AdmissionLead["followUps"][number]],
  });
  const q = leadQuality(lead, ctx);
  assert.ok(q.signals.some((s) => s.id === "chat_widget") && q.signals.some((s) => s.id === "wa_contact") && q.signals.some((s) => s.id === "replied"));
  assert.equal(q.quality, "hot", `score ${q.score}`);
  assert.equal(q.quietDays, 1);
}
// Payment started → hot regardless; not interested → cold; enrolled → cold.
assert.equal(leadQuality(mk({ registrationPaymentStatus: "partial" }), ctx0).quality, "hot");
assert.equal(leadQuality(mk({ followUps: [{ id: "f", at: "2026-08-18T00:00:00Z", channel: "call", outcome: "not_interested", note: "", by: "R", nextFollowUpAt: "" } as AdmissionLead["followUps"][number]] }), ctx0).quality, "cold");
assert.equal(leadQuality(mk({ stage: "enrolled" }), ctx0).quality, "cold");
// Long silence with zero signals → cold.
assert.equal(leadQuality(mk({ leadDate: "2026-06-01" }), ctx0).quality, "cold");

// Stalled rules.
{
  // Website enquiry, 9 days, nobody spoke → no_contact_after_form (not no_followup twice).
  const f = stalledLeadFlags(mk({ source: "website" }), { today });
  assert.deepEqual(f.map((x) => x.id), ["no_contact_after_form"]);
  assert.match(f[0].hook, /Website 9 days ago/);
  // Walk-in, no follow-ups 9 days → no_followup.
  assert.deepEqual(stalledLeadFlags(mk({ source: "walk_in" }), { today }).map((x) => x.id), ["no_followup"]);
  // Fresh walk-in (2 days) → nothing.
  assert.deepEqual(stalledLeadFlags(mk({ source: "walk_in", leadDate: "2026-08-17" }), { today }), []);
  // Paid 20 days ago, still 'applied' → paid_not_completed, highest severity.
  const paid = stalledLeadFlags(mk({ stage: "applied", registrationPaymentStatus: "paid", registrationDate: "2026-07-30" }), { today });
  assert.equal(paid[0].id, "paid_not_completed");
  assert.match(paid[0].hook, /already paid the registration fee \(on 2026-07-30\)/);
  // Interested on 1 Aug then silence → went_quiet with the thread in the hook.
  const quiet = stalledLeadFlags(
    mk({ followUps: [{ id: "f1", at: "2026-08-01T09:00:00Z", channel: "call", outcome: "interested", note: "asked about bus", by: "R", nextFollowUpAt: "" } as AdmissionLead["followUps"][number]] }),
    { today },
  );
  assert.ok(quiet.some((x) => x.id === "went_quiet"));
  assert.match(quiet.find((x) => x.id === "went_quiet")!.hook, /On 2026-08-01 the family said they were interested \(asked about bus\)/);
  // Lost / enrolled → never flagged.
  assert.deepEqual(stalledLeadFlags(mk({ stage: "lost" }), { today }), []);
}
console.log("OK — leadQuality.selftest.ts");
