/**
 * Staff employment agreement AI prompts.
 * Drafts follow clauses commonly used in private schools in India.
 *
 * The school is recognised by the Government of Uttar Pradesh (Nursery–VIII)
 * and is NOT CBSE-affiliated. These prompts used to present it as a
 * "CBSE-affiliated" school and fill "CBSE Affiliation: CBSE" when no number
 * was on file, inviting agreements that bind staff to "CBSE affiliation
 * bylaws" the school is not under. The model now gets the recognition line
 * and a rule never to claim an affiliation.
 */

import type { SchoolDocumentLanguage } from "@/lib/schoolDocumentAi";

export type StaffAgreementAiMode = "create" | "revise";

export type StaffAgreementAiType =
  | "appointment"
  | "confidentiality"
  | "policy"
  | "conduct";

/** Minimum target length for a full employment agreement body (characters). */
export const AGREEMENT_MIN_BODY_CHARS = 2800;

const SCHOOL_STATUS_RULE = `
School status — follow exactly:
- Describe the school's standing ONLY with the "Recognition" line in the facts. If it is "—", say nothing about recognition or affiliation.
- NEVER state or imply that the school is affiliated to CBSE or any other board, and never write an affiliation number or a CBSE school code. The school is recognised by the State Government; it holds no central-board affiliation.
- "Follows the NCERT/CBSE curriculum framework" is a statement about syllabus and is the furthest you may go.
`;

const CLAUSE_CATALOG = `
Mandatory themes for private school staff agreements (cover ALL that apply):

1. APPOINTMENT & PROBATION — designation, department, reporting authority (Principal/Manager), date of joining, probation period (typically 6–12 months), confirmation criteria.

2. DUTIES & RESPONSIBILITIES — classroom teaching per the school's curriculum (NCERT/CBSE framework), lesson planning, assignments, assessments, remedial classes, co-curricular activities, sports/cultural events, parent-teacher meetings, staff meetings, examination duties (school/internal), invigilation, paper setting/moderation as assigned.

3. ACADEMIC & REGULATORY COMPLIANCE — adherence to UP Basic Education Department norms, the RTE Act and the school's recognition conditions, NEP 2020 where applicable, academic calendar, syllabus completion, assessment norms, maintaining records (attendance registers, mark sheets, UDISE+), inspection readiness.

4. CODE OF CONDUCT & PROFESSIONAL ETHICS — punctuality, dress code, decorum, no corporal punishment, positive discipline, professional boundaries with students, no private tuition without permission, social media policy, conflict of interest.

5. CHILD SAFETY & POCSO — mandatory reporting, safe campus, no harassment, POCSO Act compliance, Protection of Children from Sexual Offences awareness, grievance redressal.

6. CONFIDENTIALITY & DATA — student data, examination papers, fee information, HR matters, UDISE/OASIS data — non-disclosure during and after employment.

7. LEAVE & ATTENDANCE — as per school leave policy and service rules; prior approval; loss of pay; unauthorized absence consequences.

8. REMUNERATION — salary structure reference (basic, allowances if stated), statutory deductions (PF, ESIC, TDS), increment policy reference, no guarantee unless specified in appointment order.

9. INTELLECTUAL PROPERTY — lesson plans, worksheets, digital content created during employment belong to the school unless otherwise agreed.

10. DISCIPLINARY ACTION — warning, suspension, termination for misconduct, breach of code, moral turpitude, criminal charges, subordination, absenteeism.

11. NOTICE PERIOD & TERMINATION — notice period (typically 30–90 days), resignation procedure, termination for cause, surrender of school property/ID, full & final settlement.

12. TRANSFER & DEPUTATION — school may transfer between branches/campuses as per management discretion.

13. DECLARATION — information provided is true; agreement binding; governed by laws of India; disputes subject to local jurisdiction.

Write in formal legal-indian English (or Hindi if requested). Use numbered clauses and sub-clauses. Target at least 18–25 numbered clauses for appointment letters; 12–18 for policy/confidentiality/conduct documents.
Do NOT include signature blocks, witness lines, or notary — the ERP adds consent and e-signature separately.
`;

export function buildStaffAgreementSystemPrompt(
  language: SchoolDocumentLanguage = "en",
): string {
  const langRules =
    language === "hi"
      ? `- LANGUAGE: HINDI ONLY. Write the FULL agreement in Devanagari script in bodyHi and titleHi.
- Leave titleEn and bodyEn as empty strings "".
- bodyHi must be at least ${Math.round(AGREEMENT_MIN_BODY_CHARS * 0.85)} characters for appointment letters.
- Use formal Hindi legal-school terminology (नियुक्ति पत्र, कर्मचारी, विद्यालय, शर्तें).`
      : language === "both"
        ? `- LANGUAGE: BILINGUAL English + Hindi (Devanagari).
- bodyEn: complete English agreement (at least ${AGREEMENT_MIN_BODY_CHARS} characters for appointment letters).
- bodyHi: complete Hindi translation — same clauses, same structure, NOT a summary (at least ${Math.round(AGREEMENT_MIN_BODY_CHARS * 0.85)} characters).
- titleEn and titleHi must both be present.`
        : `- LANGUAGE: ENGLISH ONLY. Write full content in bodyEn and titleEn.
- Leave titleHi and bodyHi as empty strings "".
- bodyEn must be at least ${AGREEMENT_MIN_BODY_CHARS} characters for appointment letters.`;

  return `You are a legal drafting assistant for a private school in Uttar Pradesh, India, recognised under the UP Basic Education Department.
You produce comprehensive staff employment agreements matching practices of reputable private schools in India — detailed, not summary.

${SCHOOL_STATUS_RULE}
${CLAUSE_CATALOG}

Output rules:
- Respond with valid JSON only: { "titleEn", "titleHi", "bodyEn", "bodyHi" }
${langRules}
- Use the employee and school facts provided; use [TO BE FILLED] only where data is genuinely missing
- Tone: formal, enforceable, clear — similar to appointment orders used by established private schools
- No markdown fences in the JSON values`;
}

export function buildStaffAgreementUserPrompt(opts: {
  mode: StaffAgreementAiMode;
  agreementType: StaffAgreementAiType;
  language: SchoolDocumentLanguage;
  schoolName: string;
  displayName: string;
  city?: string;
  /** schoolRecognitionLine(): "Recognised by the Government of Uttar Pradesh", or "". */
  recognition?: string;
  staffContext: string;
  details: string;
  currentTitle?: string;
  currentBody?: string;
  changeRequest?: string;
}): string {
  const typeLabel =
    opts.agreementType === "confidentiality"
      ? "Confidentiality & Non-Disclosure Agreement"
      : opts.agreementType === "policy"
        ? "Policy Acknowledgment & Compliance Agreement"
        : opts.agreementType === "conduct"
          ? "Staff Conduct Rules & Undertaking"
          : "Employment Appointment Letter / Service Agreement";

  const langNote =
    opts.language === "hi"
      ? `HINDI ONLY — entire agreement in Devanagari in bodyHi/titleHi. bodyEn and titleEn must be empty.`
      : opts.language === "en"
        ? `ENGLISH ONLY — full detailed agreement in bodyEn/titleEn. bodyHi and titleHi must be empty.`
        : `BILINGUAL — full English in bodyEn AND full Hindi (Devanagari) translation in bodyHi. Same numbered clauses in both. Do not skip Hindi.`;

  const langReturn =
    opts.language === "hi"
      ? `Return JSON: titleEn:"", titleHi, bodyEn:"", bodyHi (complete Hindi agreement).`
      : opts.language === "en"
        ? `Return JSON: titleEn, bodyEn, titleHi:"", bodyHi:"" (complete English agreement).`
        : `Return JSON: titleEn, titleHi, bodyEn (English), bodyHi (Hindi Devanagari) — all four fields filled.`;

  if (opts.mode === "revise") {
    return `School: ${opts.schoolName} (${opts.displayName})
City: ${opts.city || "—"} | Recognition: ${opts.recognition || "—"}
Document: ${typeLabel}
Language: ${langNote}

TASK: REVISE the draft below to align with private-school employment norms and clauses used by other reputed private schools in India.
- Expand thin or missing sections using the mandatory clause catalog
- Keep employee-specific facts already correct; improve legal clarity
- Preserve intent of user edits where reasonable
- Remove any statement that the school is affiliated to CBSE or any board, and any affiliation number or CBSE school code
- If user noted changes, apply them: ${opts.changeRequest?.trim() || "(general alignment)"}

Employee context:
${opts.staffContext}

Current title: ${opts.currentTitle || "—"}

Current draft body:
---
${opts.currentBody || "(empty)"}
---

Return improved JSON with titleEn, titleHi, bodyEn, bodyHi.
${langReturn}`;
  }

  return `School: ${opts.schoolName} (${opts.displayName})
City: ${opts.city || "—"} | Recognition: ${opts.recognition || "—"}
Document type: ${typeLabel}
Language: ${langNote}

TASK: CREATE a complete, detailed staff agreement suitable for signature at this school.
Match depth and structure of appointment orders issued by established private schools — NOT a short letter.

Employee facts:
${opts.staffContext}

Additional terms from HR (salary, probation, notice, special clauses):
${opts.details.trim() || "Use standard private school terms: 6 months probation, 30 days notice, salary as per school pay scale, PF/ESIC as applicable."}

${langReturn}`;
}

const MIN_HI_BODY = Math.round(AGREEMENT_MIN_BODY_CHARS * 0.85);

export function validateAgreementDoc(
  doc: { titleEn: string; titleHi: string; bodyEn: string; bodyHi: string },
  language: SchoolDocumentLanguage,
): string | null {
  const bodyEn = doc.bodyEn.trim();
  const bodyHi = doc.bodyHi.trim();
  const titleEn = doc.titleEn.trim();
  const titleHi = doc.titleHi.trim();

  if (language === "hi") {
    if (!bodyHi || bodyHi.length < 400) {
      return "AI did not return Hindi agreement text — please try again";
    }
    if (!titleHi) {
      return "AI did not return Hindi title — please try again";
    }
    return null;
  }
  if (language === "en") {
    if (!bodyEn || bodyEn.length < 400) {
      return "AI did not return English agreement text — please try again";
    }
    return null;
  }
  // both
  if (!bodyEn || bodyEn.length < 400) {
    return "AI did not return English section — please try again";
  }
  if (!bodyHi || bodyHi.length < 400) {
    return "AI did not return Hindi (हिन्दी) section — please try again with language English + Hindi";
  }
  if (!titleEn || !titleHi) {
    return "AI must return both English and Hindi titles — please try again";
  }
  return null;
}

export function pickAgreementTextFromDoc(
  doc: { titleEn: string; titleHi: string; bodyEn: string; bodyHi: string },
  language: SchoolDocumentLanguage,
): { title: string; body: string } {
  const bodyEn = doc.bodyEn.trim();
  const bodyHi = doc.bodyHi.trim();
  const titleEn = doc.titleEn.trim();
  const titleHi = doc.titleHi.trim();

  if (language === "hi") {
    return {
      title: titleHi || "रोज़गार समझौता",
      body: bodyHi,
    };
  }
  if (language === "en") {
    return {
      title: titleEn || "Employment Agreement",
      body: bodyEn,
    };
  }
  // Bilingual — clearly labelled sections
  const title =
    titleEn && titleHi
      ? `${titleEn} / ${titleHi}`
      : titleEn || titleHi || "Employment Agreement";
  const parts: string[] = [];
  if (bodyEn) {
    parts.push(`[English]\n${bodyEn}`);
  }
  if (bodyHi) {
    parts.push(`[हिन्दी]\n${bodyHi}`);
  }
  return {
    title,
    body: parts.join("\n\n————————————————\n\n"),
  };
}

export function buildStaffAgreementRetryPrompt(
  language: SchoolDocumentLanguage,
): string {
  if (language === "hi") {
    return `CRITICAL: Your previous response was missing Hindi content. Regenerate NOW.
Write the COMPLETE staff agreement in Hindi (Devanagari) only in bodyHi and titleHi.
Set titleEn="" and bodyEn="". bodyHi must exceed ${MIN_HI_BODY} characters.`;
  }
  if (language === "both") {
    return `CRITICAL: Your previous response was missing Hindi (bodyHi) or English (bodyEn).
Regenerate with BOTH languages — full English in bodyEn AND full Hindi Devanagari translation in bodyHi.
Both sections must be complete with numbered clauses.`;
  }
  return `CRITICAL: Regenerate with complete English only in bodyEn/titleEn.`;
}
