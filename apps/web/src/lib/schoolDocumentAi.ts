/**
 * AI document maker — type presets and prompt helpers for school letters / govt submissions.
 */

export type SchoolDocumentType =
  | "formal_letter"
  | "govt_submission"
  | "permission_request"
  | "leave_approval"
  | "bonafide_letter"
  | "fee_concession"
  | "transport_noc"
  | "event_permission"
  | "staff_appointment"
  | "general_circular"
  | "admission_offer"
  | "fee_structure_letter"
  | "welcome_packet";

export type SchoolDocumentLanguage = "en" | "hi" | "both";

export type SchoolDocumentPreset = {
  id: SchoolDocumentType;
  label: string;
  hint: string;
  defaultSubjectEn: string;
  promptContext: string;
};

export const SCHOOL_DOCUMENT_PRESETS: SchoolDocumentPreset[] = [
  {
    id: "formal_letter",
    label: "Formal letter",
    hint: "General official correspondence",
    defaultSubjectEn: "Regarding —",
    promptContext:
      "Formal school letter on letterhead — respectful tone, clear paragraphs, reference number placeholder.",
  },
  {
    id: "govt_submission",
    label: "Govt submission",
    hint: "UDISE, CBSE, district education office",
    defaultSubjectEn: "Submission for —",
    promptContext:
      "Government submission letter for Indian CBSE school — cite UDISE/affiliation where relevant, factual tables if needed.",
  },
  {
    id: "permission_request",
    label: "Permission request",
    hint: "Event, excursion, camp",
    defaultSubjectEn: "Permission for —",
    promptContext:
      "Request permission from authorities/parents — dates, purpose, safety measures.",
  },
  {
    id: "leave_approval",
    label: "Leave approval",
    hint: "Student or staff leave sanction",
    defaultSubjectEn: "Leave approval —",
    promptContext:
      "Approve leave with dates, class/staff reference, conditions if any.",
  },
  {
    id: "bonafide_letter",
    label: "Bonafide / study certificate",
    hint: "Student bonafide for passport, visa, bank",
    defaultSubjectEn: "Bonafide certificate —",
    promptContext:
      "Bonafide certificate text — student name, class, session, conduct good.",
  },
  {
    id: "fee_concession",
    label: "Fee concession letter",
    hint: "Concession approval or request",
    defaultSubjectEn: "Fee concession —",
    promptContext:
      "Fee concession letter — amount/percentage, session, sibling policy if relevant.",
  },
  {
    id: "transport_noc",
    label: "Transport NOC",
    hint: "Private vehicle / route change",
    defaultSubjectEn: "Transport NOC —",
    promptContext:
      "Transport NOC — vehicle details, route, safety compliance.",
  },
  {
    id: "event_permission",
    label: "Event / excursion",
    hint: "Sports, cultural, educational trip",
    defaultSubjectEn: "Excursion permission —",
    promptContext:
      "School event or excursion letter — itinerary, consent, emergency contact.",
  },
  {
    id: "staff_appointment",
    label: "Staff appointment",
    hint: "Offer or appointment order",
    defaultSubjectEn: "Appointment order —",
    promptContext:
      "Staff appointment order — designation, salary terms, reporting date.",
  },
  {
    id: "general_circular",
    label: "Circular / notice",
    hint: "Parent circular or internal notice",
    defaultSubjectEn: "Circular —",
    promptContext:
      "School circular — bullet points, action required, deadline.",
  },
  {
    id: "admission_offer",
    label: "Admission offer letter",
    hint: "Provisional admission for an enquiry / registered lead",
    defaultSubjectEn: "Offer of provisional admission —",
    promptContext:
      "Provisional admission offer to the parent/guardian: child's name, class and session offered, what makes it firm (documents to submit, fee to pay by a date), validity of the offer, contact for queries. Warm but formal; no promises beyond what the details state; leave a reference number placeholder.",
  },
  {
    id: "fee_structure_letter",
    label: "Fee structure letter",
    hint: "Class-wise fee heads, amounts, installments",
    defaultSubjectEn: "Fee structure for session —",
    promptContext:
      "Fee structure communication for a class and session: a clear table of fee heads with amounts (use exactly the amounts given — never invent or round), installment due dates if given, payment modes, late-fee/concession note only if given. Plain, factual, no marketing language.",
  },
  {
    id: "welcome_packet",
    label: "Welcome packet",
    hint: "First-day information for a newly admitted family",
    defaultSubjectEn: "Welcome to —",
    promptContext:
      "Welcome note for a newly admitted family: warm greeting naming the child and class, school timings and first day, uniform and books (only what the details say), transport / app / WhatsApp channel info if given, whom to contact. Short sections with headings; friendly and clear.",
  },
];

export function presetForType(id: SchoolDocumentType): SchoolDocumentPreset {
  return (
    SCHOOL_DOCUMENT_PRESETS.find((p) => p.id === id) ??
    SCHOOL_DOCUMENT_PRESETS[0]!
  );
}

export function buildSchoolDocumentUserPrompt(opts: {
  docType: SchoolDocumentType;
  language: SchoolDocumentLanguage;
  details: string;
  schoolName: string;
  displayName: string;
  city?: string;
  affiliationNo?: string;
}): string {
  const preset = presetForType(opts.docType);
  const langNote =
    opts.language === "hi"
      ? "Hindi only (Devanagari script for title and body)."
      : opts.language === "en"
        ? "English only."
        : "Bilingual — provide English and Hindi (Devanagari) versions.";

  return `School: ${opts.schoolName} (${opts.displayName})
City: ${opts.city || "—"}
Affiliation: ${opts.affiliationNo || "CBSE"}
Document type: ${preset.label}
Context: ${preset.promptContext}
Language: ${langNote}

Staff details / facts to include:
${opts.details.trim() || "(Use professional placeholders where facts are missing)"}

Return JSON with keys: titleEn, titleHi, bodyEn, bodyHi, subject.
For single-language requests, leave unused language fields as empty strings.
Subject is a short email-style subject line (English).`;
}

export function buildSchoolDocumentSystemPrompt(): string {
  return `You draft official school documents for Indian CBSE schools.
Tone: formal, respectful, legally appropriate. Use Indian date format in body when dates appear.
Do not invent specific student names unless provided — use placeholders like [Student Name] if needed.
Respond with valid JSON only — no markdown fences.`;
}
