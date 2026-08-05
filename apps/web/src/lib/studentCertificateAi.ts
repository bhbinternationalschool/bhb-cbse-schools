/**
 * AI prompts for student certificates — CBSE affiliation norms + UP Basic Education Dept.
 */

import type { CertificateKind } from "@/lib/certificates";
import type { SchoolDocumentLanguage } from "@/lib/schoolDocumentAi";

export type StudentCertificateAiMode = "create" | "revise";

const CBSE_BASE = `
CBSE affiliation requirements (where applicable):
- Affiliation number, school code, UDISE+ / PEN, APAAR ID references when student data provided
- Formal letterhead tone; Annexure-I fields for TC are handled separately — do not duplicate the 23-row TC table in body text
- Child safety, POCSO awareness in conduct certificates
- NEP 2020 / competency-based education references where relevant
`;

const UP_BASIC = `
UP Basic Education Department (Basic Shiksha / प्राथमिक शिक्षा) norms:
- UP private / aided school recognition under Basic Education Dept where applicable
- Hindi as medium / second language; respect for UP RTE rules, EWS admission, fee norms
- References to district Basic Education Officer / DIET only when purpose mentions govt submission
- Bilingual schools: dignified Hindi (Devanagari) parallel to English when requested
`;

const KIND_GUIDANCE: Record<CertificateKind, string> = {
  tc: `Transfer Certificate (TC) supporting narrative — NOT the full Annexure-I grid.
Suggest: reason for leaving wording, subjects studied summary, games/NCC/Scout, annual exam result phrasing, promotion status, fee concession note.
Keep factual; align with CBSE Examination Bye-laws Annexure-I language.`,
  bonafide: `Bonafide / study certificate for passport, visa, bank loan, employer, scholarship, or address proof.
State student is a bona fide scholar of the school, class, session, admission number, parent names, DOB.
UP/CBSE: mention board affiliation and purpose of certificate.`,
  character: `Character certificate — conduct, discipline, moral character, attendance to school rules.
CBSE: no corporal punishment era; positive discipline. UP: suitable for govt forms and transfers.`,
  fee_clearance: `Fee clearance / no-dues certificate — confirms no outstanding tuition or other dues as on date.
Reference fee ledger, session, class. Suitable for TC processing, employer, or school transfer.`,
  fees_paid: `Fees paid certificate for employer reimbursement / income-tax / HRA claim.
Covering letter style: period covered, total paid, categories (tuition, transport, etc.) — amounts may be filled from system; write narrative around reimbursement purpose.`,
};

export function buildStudentCertificateSystemPrompt(
  language: SchoolDocumentLanguage,
): string {
  const langRules =
    language === "hi"
      ? `HINDI ONLY in bodyHi/titleHi. bodyEn and titleEn empty strings.`
      : language === "en"
        ? `ENGLISH ONLY in bodyEn/titleEn. bodyHi and titleHi empty strings.`
        : `BILINGUAL: full English in bodyEn AND full Hindi (Devanagari) in bodyHi.`;

  return `You draft official school certificates for Indian schools — CBSE-affiliated and UP Basic Shiksha recognized.

${CBSE_BASE}
${UP_BASIC}

Output JSON only:
{
  "titleEn", "titleHi", "bodyEn", "bodyHi",
  "remarks": "short purpose line for certificate register",
  "tcSubjectsStudied": "only for TC — comma-separated subjects or empty",
  "tcGamesActivities": "only for TC — games/NCC/Scout line or empty",
  "tcAnnualExamResult": "only for TC — exam result phrasing or empty"
}

${langRules}
Formal, legally appropriate tone. No signature blocks — school adds signatures separately.
Minimum body length: 400 characters for English or Hindi section when that language is requested.`;
}

export function buildStudentCertificateUserPrompt(opts: {
  mode: StudentCertificateAiMode;
  kind: CertificateKind;
  language: SchoolDocumentLanguage;
  schoolName: string;
  displayName: string;
  city?: string;
  affiliationNo?: string;
  udiseCode?: string;
  studentContext: string;
  purpose: string;
  details: string;
  currentBody?: string;
  changeRequest?: string;
}): string {
  const langNote =
    opts.language === "hi"
      ? "Hindi only (Devanagari)."
      : opts.language === "en"
        ? "English only."
        : "English + Hindi (Devanagari) — both complete.";

  const task =
    opts.mode === "revise"
      ? `REVISE the certificate text below per CBSE + UP Basic Education guidelines.\nChange request: ${opts.changeRequest || "align with board norms"}\n\nCurrent body:\n---\n${opts.currentBody || ""}\n---`
      : `CREATE new certificate text.`;

  return `School: ${opts.schoolName} (${opts.displayName})
City: ${opts.city || "—"} | CBSE Affiliation: ${opts.affiliationNo || "—"} | UDISE: ${opts.udiseCode || "—"}
Certificate type: ${opts.kind}
Guidance: ${KIND_GUIDANCE[opts.kind]}
Language: ${langNote}

${task}

Student facts:
${opts.studentContext}

Purpose / use of certificate:
${opts.purpose || "General official use"}

Additional details:
${opts.details || "(none)"}`;
}

export function pickCertificateTextFromDoc(
  doc: {
    titleEn: string;
    titleHi: string;
    bodyEn: string;
    bodyHi: string;
  },
  language: SchoolDocumentLanguage,
): { title: string; body: string } {
  const bodyEn = doc.bodyEn.trim();
  const bodyHi = doc.bodyHi.trim();
  const titleEn = doc.titleEn.trim();
  const titleHi = doc.titleHi.trim();

  if (language === "hi") {
    return { title: titleHi || "प्रमाण पत्र", body: bodyHi };
  }
  if (language === "en") {
    return { title: titleEn || "Certificate", body: bodyEn };
  }
  const title =
    titleEn && titleHi ? `${titleEn} / ${titleHi}` : titleEn || titleHi || "Certificate";
  const parts: string[] = [];
  if (bodyEn) parts.push(`[English]\n${bodyEn}`);
  if (bodyHi) parts.push(`[हिन्दी]\n${bodyHi}`);
  return { title, body: parts.join("\n\n————————————————\n\n") };
}

export function validateStudentCertificateDoc(
  doc: { bodyEn: string; bodyHi: string },
  language: SchoolDocumentLanguage,
): string | null {
  const bodyEn = doc.bodyEn.trim();
  const bodyHi = doc.bodyHi.trim();
  if (language === "hi" && bodyHi.length < 80) {
    return "AI did not return Hindi certificate text — try again";
  }
  if (language === "en" && bodyEn.length < 80) {
    return "AI did not return English certificate text — try again";
  }
  if (language === "both" && (bodyEn.length < 80 || bodyHi.length < 80)) {
    return "AI must return both English and Hindi sections — try again";
  }
  return null;
}

export function buildStudentCertificateRetryPrompt(
  language: SchoolDocumentLanguage,
): string {
  if (language === "hi") {
    return "CRITICAL: Regenerate with COMPLETE Hindi (Devanagari) in bodyHi only.";
  }
  if (language === "both") {
    return "CRITICAL: Regenerate with BOTH bodyEn and bodyHi — full bilingual certificate.";
  }
  return "CRITICAL: Regenerate with complete English in bodyEn.";
}
