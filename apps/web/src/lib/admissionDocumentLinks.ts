/**
 * Deep links from an admission lead into the AI document maker with the
 * facts already filled in — offer letter, fee structure letter, welcome
 * packet. Pure: builds the `details` text and the URL; nothing is sent
 * anywhere until the office generates and prints.
 */

import type { AdmissionLead } from "@/lib/admissions";
import type { MastersState } from "@/lib/masters";
import type { SchoolDocumentType } from "@/lib/schoolDocumentAi";

function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/**
 * Fee lines for a class from the published NEW-admission fee group of the
 * session (or the first active group covering the class). Returns [] when
 * no structure is set up — the letter then says "as per the fee schedule"
 * rather than inventing amounts.
 */
export function feeSummaryForClass(
  masters: MastersState,
  academicYearCode: string,
  classId: string,
): { lines: { head: string; amount: string; installment: string }[]; total: string; groupName: string } {
  const groups = (masters.feeGroups ?? []).filter(
    (g) =>
      g.isActive &&
      g.academicYearCode === academicYearCode &&
      (g.classIds.length === 0 || g.classIds.includes(classId)),
  );
  const group =
    groups.find((g) => g.studentType === "NEW" && g.structurePublishedAt) ??
    groups.find((g) => g.studentType === "NEW") ??
    groups[0];
  if (!group) return { lines: [], total: "", groupName: "" };
  const heads = new Map((masters.feeHeads ?? []).map((h) => [h.id, h]));
  const inst = new Map((masters.installments ?? []).map((i) => [i.id, i]));
  const lines = (masters.feeStructureLines ?? [])
    .filter((l) => l.feeGroupId === group.id && (l.classId === null || l.classId === classId) && l.amountPaise > 0)
    .map((l) => ({
      head: heads.get(l.feeHeadId)?.nameEn ?? "Fee",
      amount: inr(l.amountPaise),
      installment: l.installmentId ? inst.get(l.installmentId)?.label ?? "" : "",
      paise: l.amountPaise,
      sort: heads.get(l.feeHeadId)?.sortOrder ?? 0,
    }))
    .sort((a, b) => a.sort - b.sort);
  const total = lines.reduce((a, l) => a + l.paise, 0);
  return {
    lines: lines.map(({ head, amount, installment }) => ({ head, amount, installment })),
    total: total ? inr(total) : "",
    groupName: group.name,
  };
}

/** Documents the registration checklist still lacks, from the lead's own ticks. */
export function pendingDocumentsForLead(lead: AdmissionLead): string[] {
  const out: string[] = [];
  if (!lead.docsBirthCert) out.push("Birth certificate (original + copy)");
  if (!lead.docsPhoto) out.push("Passport-size photographs of the child");
  if (!lead.docsAadhaar) out.push("Aadhaar of the child (and one parent)");
  if (!lead.docsTc && lead.previousSchool) out.push("Transfer certificate / last report card from the previous school");
  if (!lead.docsCategory && (lead.rte || (lead.category && lead.category.toLowerCase() !== "general"))) out.push("Category / income certificate");
  return out;
}

export function buildAdmissionDocumentDetails(input: {
  type: SchoolDocumentType;
  lead: AdmissionLead;
  masters: MastersState;
  className: string;
  schoolTiming?: string;
}): string {
  const { lead, masters, className } = input;
  const L: string[] = [];
  L.push(`Child: ${lead.childName || "—"}`);
  L.push(`Class: ${className || "—"} · Session ${lead.academicYearCode}`);
  if (lead.guardianName) L.push(`Parent / guardian: ${lead.guardianName}`);
  if (lead.mobile) L.push(`Mobile: ${lead.mobile}`);
  const fee = feeSummaryForClass(masters, lead.academicYearCode, lead.classAdmittedId || lead.classSoughtId);
  if (input.type === "admission_offer") {
    L.push("");
    L.push("Offer: provisional admission, subject to submission of documents and payment of admission-time fees.");
    L.push("Documents to submit: birth certificate, previous school report card / TC (if any), Aadhaar of child and parent, 4 passport photos, address proof.");
    if (fee.total) L.push(`Admission-time fee as per ${fee.groupName}: total ${fee.total} (details in the fee structure letter).`);
    L.push("Offer valid for 7 days from the date of this letter; contact the school office for queries.");
  }
  if (input.type === "admission_deficiency") {
    const pending = pendingDocumentsForLead(lead);
    L.push("");
    L.push(`Status: ${lead.stage === "applied" || lead.stage === "verified" ? "registered" : "enquiry"}${lead.applicationNo ? ` · application ${lead.applicationNo}` : lead.enquiryNo ? ` · ${lead.enquiryNo}` : ""}${lead.registrationPaymentStatus === "paid" ? " · registration fee paid" : ""}.`);
    L.push(pending.length ? `Documents still pending (exactly these): ${pending.join("; ")}.` : "Documents: checklist complete — nothing pending (letter may not be needed).");
    L.push("How to submit: at the school office on working days, or send clear photos on the school WhatsApp number; originals shown at verification.");
    L.push("After submission: the admission file is completed and the parent is informed.");
  }
  if (input.type === "fee_structure_letter") {
    L.push("");
    if (fee.lines.length) {
      L.push(`Fee structure (${fee.groupName}):`);
      for (const l of fee.lines) L.push(`- ${l.head}: ${l.amount}${l.installment ? ` (${l.installment})` : ""}`);
      L.push(`Total for the session: ${fee.total}`);
    } else {
      L.push("Fee structure: as per the school's published fee schedule for the class (amounts not available in the system yet — insert before sending).");
    }
    L.push("Payment: cash / UPI / bank transfer at the school office; receipts issued on the spot.");
  }
  if (input.type === "welcome_packet") {
    L.push("");
    L.push(`School timing: ${input.schoolTiming || "as per the school calendar"}.`);
    L.push("Uniform and books: available as per the school's list; details from the office.");
    L.push("Communication: school WhatsApp number and the parent app for attendance, homework, fees and notices.");
    L.push("Contact: school office for transport, fees and any help settling in.");
  }
  return L.join("\n");
}

export function admissionDocumentHref(type: SchoolDocumentType, details: string, language: "en" | "hi" | "both" = "both"): string {
  const sp = new URLSearchParams({ type, details, language });
  return `/documents?${sp.toString()}`;
}
