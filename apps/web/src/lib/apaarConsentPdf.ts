/**
 * The printable record of a parent's APAAR ID answer (lib/apaarConsent).
 *
 * The parent never prints or signs anything (the director's call, 21 Sep
 * 2026); the school keeps this page instead — one per child, made when the
 * parent taps, filed in the child's Drive folder, and reprinted from the
 * student card. It carries what the Ministry's Annexure-1 carries in
 * substance: who the child is, who answered, the answer, and the words
 * they agreed to — plus how and when it was given, which is the evidence
 * in place of a signature.
 *
 * English only: jsPDF cannot shape Devanagari conjuncts, and a record that
 * prints broken Hindi is worse than one that says the parent was shown the
 * statement in Hindi (the exact words are kept in lib/apaarConsent).
 *
 * No server-only import, so a script or self-test can render one.
 */

import { jsPDF } from "jspdf";

import { CONSENT_VOLUNTARY_EN, consentSentenceEn } from "@/lib/apaarConsent";

export type ApaarConsentRecordInput = {
  schoolName: string;
  schoolPlace: string;
  udiseCode: string;
  student: {
    name: string;
    classLabel: string;
    admissionNo: string;
    dob: string;
    gender: string;
    pen: string;
    fatherName: string;
    motherName: string;
  };
  answer: "given" | "refused";
  /** ISO timestamp of the tap. */
  at: string;
  /** Who and how, as stored: "<guardian> · WhatsApp +91… · msg …". */
  by: string;
  /** The language the question was shown in. */
  shownIn: "hi" | "en";
};

/** The words the parent was shown — the message's own sentence (lib/apaarConsent), not a paraphrase. */
export function consentStatementEn(guardian: string, childName: string): string {
  return `${consentSentenceEn(guardian, childName)} ${CONSENT_VOLUNTARY_EN}`;
}

function ddmmyyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "—";
}

function istStamp(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} IST`;
}

export function apaarConsentRecordFileName(studentName: string, at: string): string {
  const who = studentName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "student";
  return `APAAR-consent-${who}-${(at || "").slice(0, 10)}.pdf`;
}

export function renderApaarConsentRecordPdf(input: ApaarConsentRecordInput): Buffer {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const W = 595.28;
  const L = 56;
  const R = W - 56;
  let y = 64;

  doc.setTextColor(20, 30, 60);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(input.schoolName, W / 2, y, { align: "center" });
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text([input.schoolPlace, input.udiseCode ? `UDISE code ${input.udiseCode}` : ""].filter(Boolean).join(" · "), W / 2, y, { align: "center" });
  y += 24;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("APAAR ID — Parental Consent / Refusal Record", W / 2, y, { align: "center" });
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  doc.text("In substance, the Ministry of Education's Annexure-1 (Parental Consent / Refusal Form for APAAR ID)", W / 2, y, { align: "center" });
  y += 12;
  doc.setDrawColor(180, 180, 180);
  doc.line(L, y, R, y);
  y += 22;

  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(90, 90, 90);
    doc.text(label, L, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    const lines = doc.splitTextToSize(value || "—", R - (L + 150));
    doc.text(lines, L + 150, y);
    y += 16 * Math.max(1, lines.length);
  };
  const heading = (t: string) => {
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20, 30, 60);
    doc.text(t, L, y);
    y += 16;
  };

  const s = input.student;
  heading("Student");
  row("Name", s.name);
  row("Class", s.classLabel);
  row("Admission no.", s.admissionNo);
  row("Date of birth", ddmmyyyy(s.dob));
  row("Gender", s.gender === "M" ? "Male" : s.gender === "F" ? "Female" : s.gender);
  row("PEN", s.pen || "not yet generated");
  row("Father / Mother", [s.fatherName, s.motherName].filter(Boolean).join(" / "));

  const [guardian = "", channel = "", msg = ""] = input.by.split(" · ");
  heading("Parent / guardian who answered");
  row("Name", guardian);
  row("Answered from", channel || "WhatsApp");
  if (msg) row("WhatsApp message", msg.replace(/^msg\s*/, ""));
  row("Date and time", istStamp(input.at));

  y += 8;
  const given = input.answer === "given";
  doc.setFillColor(given ? 232 : 252, given ? 245 : 236, given ? 236 : 236);
  doc.setDrawColor(given ? 60 : 170, given ? 140 : 60, given ? 80 : 60);
  doc.roundedRect(L, y, R - L, 40, 6, 6, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(given ? 30 : 150, given ? 110 : 30, given ? 50 : 30);
  doc.text(given ? "DECISION: CONSENT GIVEN (YES)" : "DECISION: CONSENT REFUSED (NO)", W / 2, y + 25, { align: "center" });
  y += 60;

  heading(given ? "Statement the parent agreed to" : "Statement the parent declined");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  const stmt = doc.splitTextToSize(`"${consentStatementEn(guardian, s.name)}"`, R - L);
  doc.text(stmt, L, y);
  y += 14 * stmt.length + 6;
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  doc.text(
    input.shownIn === "hi" ? "Shown to the parent in Hindi; the English above is the same statement." : "Shown to the parent in English.",
    L,
    y,
  );
  y += 26;

  heading("How this was recorded");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(40, 40, 40);
  const how = doc.splitTextToSize(
    "The school sent the statement above on WhatsApp to the mobile number registered for this family, with two reply buttons " +
      '("Yes, I consent" / "No"). The parent tapped the button recorded above. No printed form or signature was taken; this record, ' +
      "the time, the registered mobile and the WhatsApp message reference are the evidence. The answer can be changed at any time by " +
      'sending "APAAR" to the school on WhatsApp, which creates a new record.',
    R - L,
  );
  doc.text(how, L, y);
  y += 13 * how.length + 30;

  doc.setDrawColor(150, 150, 150);
  doc.line(L, y, L + 200, y);
  doc.line(R - 200, y, R, y);
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  doc.text("Checked by (school office)", L, y + 12);
  doc.text("Date", R - 200, y + 12);

  doc.setFontSize(7.5);
  doc.text(`Generated by the school ERP from the parent's WhatsApp reply · ${input.schoolName}`, W / 2, 810, { align: "center" });

  return Buffer.from(doc.output("arraybuffer"));
}
