/**
 * Self-test: messages drafted for parents follow the family's language —
 * Hindi unless the family chose English — and still carry every fact.
 * Run: npx tsx src/lib/parentMessagesHindi.selftest.ts
 */

import assert from "node:assert/strict";

import { composeAbsentNudgeMessage } from "./attendance";
import {
  composeAdmissionOffer,
  composeAdmissionRegisterStep,
  crmBotWelcomeText,
  replyCrmBotIntent,
} from "./crmAdmissionBotEngine";
import { composeParentMeetingInvite } from "./feeRecoveryTasks";
import { composeWhatsAppInstallmentPlan } from "./installmentPlans";
import { composeEscalationNotice, composeWhatsAppDefaulterReminder } from "./playbook";
import { composeWhatsAppPtmConfirm, composeWhatsAppPtmReminder } from "./ptm";

console.log("parentMessagesHindi.selftest.ts");

const DEVANAGARI = /[ऀ-ॿ]/;
const both = (make: (hindi: boolean) => string, facts: string[], label: string) => {
  const hi = make(true);
  const en = make(false);
  assert.ok(DEVANAGARI.test(hi), `${label}: Hindi version is Hindi`);
  assert.ok(!DEVANAGARI.test(en), `${label}: English version stays English`);
  for (const f of facts) {
    assert.ok(hi.includes(f), `${label}: Hindi drops "${f}"`);
    assert.ok(en.includes(f), `${label}: English drops "${f}"`);
  }
};

both((hindi) => composeAbsentNudgeMessage({ studentName: "AARAV", date: "2026-09-14", classLabel: "V-A", hindi }),
  ["AARAV", "2026-09-14", "V-A", "OK", "WRONG"], "absent");

both((hindi) => composeWhatsAppDefaulterReminder({
  schoolName: "BHB", studentName: "AARAV", classLabel: "V-A", amountPaise: 250000,
  overdueDays: 12, stageLabel: "S1", payUrl: "https://x/pay", hindi,
}), ["AARAV", "₹2,500", "12", "https://x/pay"], "defaulter reminder");

both((hindi) => composeEscalationNotice({
  schoolName: "BHB", studentName: "AARAV", classLabel: "V-A", admissionNo: "A-1",
  amountPaise: 250000, overdueDays: 40, earliestDueOn: "2026-08-01", hindi,
}), ["AARAV", "A-1", "40", "2026-08-01"], "escalation");

both((hindi) => composeParentMeetingInvite({
  id: "m", studentId: "s", householdId: "h", studentName: "AARAV", classLabel: "V-A",
  admissionNo: "A-1", amountPaise: 250000, overdueDays: 40, scheduledOn: "2026-09-20",
  mobile: "", status: "scheduled", note: "", createdBy: "x", createdAt: "",
} as unknown as Parameters<typeof composeParentMeetingInvite>[0], hindi), ["AARAV", "2026-09-20"], "meeting");

both((hindi) => composeWhatsAppInstallmentPlan({
  schoolName: "BHB", studentName: "AARAV", classLabel: "V-A", hindi,
  plan: { code: "IP-1", totalPaise: 600000, note: "", slices: [{ id: "a", label: "Part 1", amountPaise: 300000, dueOn: "2026-10-01" }] },
} as unknown as Parameters<typeof composeWhatsAppInstallmentPlan>[0]), ["IP-1", "₹3,000", "2026-10-01"], "instalment");

const ptm = { childName: "AARAV", eventName: "PTM Sep", date: "2026-09-20", startAt: "10:00", teacherName: "Mrs Rai", roomOrLink: "Room 4" };
both((hindi) => composeWhatsAppPtmConfirm({ ...ptm, hindi }), ["AARAV", "10:00", "Mrs Rai", "Room 4"], "ptm confirm");
both((hindi) => composeWhatsAppPtmReminder({ ...ptm, hindi }), ["AARAV", "10:00", "Mrs Rai"], "ptm reminder");

both((hindi) => crmBotWelcomeText(hindi), ["FEE", "REGISTER", "HUMAN"], "crm welcome");
const lead = { childName: "AARAV", enquiryNo: "ENQ-9", stageLabel: "x", enquiryDate: "2026-08-12" };
both((hindi) => composeAdmissionOffer(lead, "https://x/r", hindi), ["AARAV", "ENQ-9", "https://x/r", "YES", "NO"], "admission offer");
both((hindi) => composeAdmissionRegisterStep("https://x/r", "₹500", hindi), ["https://x/r", "₹500", "HUMAN"], "register step");
for (const intent of ["fee", "register", "docs", "status", "visit", "human", "unknown"] as const) {
  both((hindi) => replyCrmBotIntent(intent, { registerUrl: "https://x/r", lead, hindi }).text, [], `crm ${intent}`);
  assert.equal(
    replyCrmBotIntent(intent, { registerUrl: "u", lead, hindi: true }).escalate,
    replyCrmBotIntent(intent, { registerUrl: "u", lead }).escalate,
    `crm ${intent}: language never changes whether the office is called`,
  );
}

console.log("  ok");
