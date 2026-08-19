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
  | "welcome_packet"
  | "compliance_narrative";

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
    id: "compliance_narrative",
    label: "Compliance narrative (CBSE MPD / affiliation / UDISE)",
    hint: "Section text for mandatory public disclosure, affiliation renewal, inspection reports",
    defaultSubjectEn: "Compliance narrative —",
    promptContext:
      "Formal narrative sections for a CBSE school's mandatory public disclosure / affiliation renewal / inspection file. Use ONLY the facts given (enrolment, sections, staff, infrastructure, safety, training, results); write one short factual paragraph per section given, with a heading. Where a required section has no facts, write 'To be provided:' and name the fact needed — never invent numbers, dates, certificates or approvals. Formal register, third person, no marketing.",
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

/**
 * Facts the ERP already knows for a compliance narrative — counts only,
 * pulled client-side and pasted into the details box for the office to
 * extend (infrastructure, safety, training come from the office).
 */
export function buildComplianceFactsFromMasters(input: {
  academicYearCode: string;
  masters: {
    classes: { id: string; name: string; isActive?: boolean }[];
    sections: { id: string; classId: string; isActive?: boolean }[];
    staff?: { status: string; stream: string; category?: string; qualification?: string }[];
    feeGroups?: { academicYearCode: string; isActive: boolean; structurePublishedAt: string | null }[];
  };
  students: { status: string; classId: string; gender?: string; academicYearCode?: string }[];
  examTermCount: number;
}): string {
  const { masters } = input;
  const activeClasses = masters.classes.filter((c) => c.isActive !== false);
  const activeSections = masters.sections.filter((s) => s.isActive !== false);
  const students = input.students.filter(
    (s) => s.status === "active" && (!s.academicYearCode || s.academicYearCode === input.academicYearCode),
  );
  const boys = students.filter((s) => (s.gender || "").toLowerCase().startsWith("m")).length;
  const girls = students.filter((s) => (s.gender || "").toLowerCase().startsWith("f")).length;
  const staff = (masters.staff ?? []).filter((s) => s.status === "active");
  const teaching = staff.filter((s) => s.stream === "teaching");
  const withQual = teaching.filter((s) => (s.qualification || "").trim()).length;
  const publishedGroups = (masters.feeGroups ?? []).filter(
    (g) => g.isActive && g.academicYearCode === input.academicYearCode && g.structurePublishedAt,
  ).length;
  const perClass = activeClasses
    .map((c) => `${c.name}: ${students.filter((s) => s.classId === c.id).length}`)
    .join(", ");
  return [
    `Session: ${input.academicYearCode}`,
    `Enrolment (active): ${students.length} students (${boys} boys, ${girls} girls) across ${activeClasses.length} classes and ${activeSections.length} sections.`,
    `Class-wise: ${perClass}`,
    `Staff (active): ${staff.length} total; ${teaching.length} teaching, ${staff.length - teaching.length} non-teaching. Qualification recorded for ${withQual} of ${teaching.length} teachers.`,
    `Fee: ${publishedGroups} fee structure${publishedGroups === 1 ? "" : "s"} published for the session (see the fee disclosure page).`,
    `Assessment: ${input.examTermCount} exam term${input.examTermCount === 1 ? "" : "s"} configured for the session.`,
    "",
    "Sections to write (add facts below each; leave blank to get a 'To be provided' line):",
    "Infrastructure (rooms, labs, library, playground, toilets, drinking water):",
    "Safety & health (fire NOC, building safety, transport safety, medical, POCSO / anti-bullying committees):",
    "Teacher training (CBSE / other trainings this session, hours, participants):",
    "Academic results (board results, pass %, toppers if applicable):",
    "Committees & governance (SMC, PTA, grievance cell):",
  ].join("\n");
}
