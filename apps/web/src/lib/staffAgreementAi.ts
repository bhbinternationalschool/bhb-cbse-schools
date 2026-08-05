/**
 * CBSE-aligned staff employment agreement AI prompts.
 * Drafts follow clauses commonly used in CBSE-affiliated private schools in India.
 */

import type { SchoolDocumentLanguage } from "@/lib/schoolDocumentAi";

export type StaffAgreementAiMode = "create" | "revise";

export type StaffAgreementAiType =
  | "appointment"
  | "confidentiality"
  | "policy"
  | "conduct";

/** Minimum target length for a full employment agreement body (characters). */
export const CBSE_AGREEMENT_MIN_BODY_CHARS = 2800;

const CBSE_CLAUSE_CATALOG = `
Mandatory themes for CBSE-affiliated school staff agreements (cover ALL that apply):

1. APPOINTMENT & PROBATION — designation, department, reporting authority (Principal/Manager), date of joining, probation period (typically 6–12 months), confirmation criteria.

2. DUTIES & RESPONSIBILITIES — classroom teaching per CBSE curriculum, lesson planning, assignments, assessments, remedial classes, co-curricular activities, sports/cultural events, parent-teacher meetings, staff meetings, examination duties (board/internal), invigilation, paper setting/moderation as assigned.

3. ACADEMIC & CBSE COMPLIANCE — adherence to CBSE affiliation bylaws, NEP 2020 where applicable, academic calendar, syllabus completion, CCE/assessment norms, maintaining records (attendance registers, mark sheets), participation in SQAAF/inspection readiness.

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
- bodyHi must be at least ${Math.round(CBSE_AGREEMENT_MIN_BODY_CHARS * 0.85)} characters for appointment letters.
- Use formal Hindi legal-school terminology (नियुक्ति पत्र, कर्मचारी, विद्यालय, शर्तें).`
      : language === "both"
        ? `- LANGUAGE: BILINGUAL English + Hindi (Devanagari).
- bodyEn: complete English agreement (at least ${CBSE_AGREEMENT_MIN_BODY_CHARS} characters for appointment letters).
- bodyHi: complete Hindi translation — same clauses, same structure, NOT a summary (at least ${Math.round(CBSE_AGREEMENT_MIN_BODY_CHARS * 0.85)} characters).
- titleEn and titleHi must both be present.`
        : `- LANGUAGE: ENGLISH ONLY. Write full content in bodyEn and titleEn.
- Leave titleHi and bodyHi as empty strings "".
- bodyEn must be at least ${CBSE_AGREEMENT_MIN_BODY_CHARS} characters for appointment letters.`;

  return `You are a legal drafting assistant for CBSE-affiliated private schools in India (UP and other states).
You produce comprehensive staff employment agreements matching practices of reputable CBSE schools — detailed, not summary.

${CBSE_CLAUSE_CATALOG}

Output rules:
- Respond with valid JSON only: { "titleEn", "titleHi", "bodyEn", "bodyHi" }
${langRules}
- Use the employee and school facts provided; use [TO BE FILLED] only where data is genuinely missing
- Tone: formal, enforceable, clear — similar to appointment orders used by established CBSE schools
- No markdown fences in the JSON values`;
}

export function buildStaffAgreementUserPrompt(opts: {
  mode: StaffAgreementAiMode;
  agreementType: StaffAgreementAiType;
  language: SchoolDocumentLanguage;
  schoolName: string;
  displayName: string;
  city?: string;
  affiliationNo?: string;
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
City: ${opts.city || "—"} | CBSE Affiliation: ${opts.affiliationNo || "CBSE"}
Document: ${typeLabel}
Language: ${langNote}

TASK: REVISE the draft below to align with CBSE school employment norms and clauses used by other reputed CBSE-affiliated schools in India.
- Expand thin or missing sections using the mandatory clause catalog
- Keep employee-specific facts already correct; improve legal clarity
- Preserve intent of user edits where reasonable
- If user noted changes, apply them: ${opts.changeRequest?.trim() || "(general CBSE alignment)"}

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
City: ${opts.city || "—"} | CBSE Affiliation: ${opts.affiliationNo || "CBSE"}
Document type: ${typeLabel}
Language: ${langNote}

TASK: CREATE a complete, detailed staff agreement suitable for signature at a CBSE school.
Match depth and structure of appointment orders issued by established CBSE private schools — NOT a short letter.

Employee facts:
${opts.staffContext}

Additional terms from HR (salary, probation, notice, special clauses):
${opts.details.trim() || "Use standard CBSE private school terms: 6 months probation, 30 days notice, salary as per school pay scale, PF/ESIC as applicable."}

${langReturn}`;
}

const MIN_HI_BODY = Math.round(CBSE_AGREEMENT_MIN_BODY_CHARS * 0.85);

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
