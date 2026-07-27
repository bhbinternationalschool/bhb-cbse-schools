/**
 * Reconcile CRM leads with the SIS student register (all sessions,
 * active AND inactive students):
 * - strong match → lead marked Admitted, linked to the student
 * - weaker match (same family mobile, or same child name without a
 *   guardian/mobile confirmation) → lead tagged "Suspected in SIS"
 * - every matched lead carries the student's Active/Inactive status
 * - lead admission year is normalized from the enquiry date
 *   (Oct Y-1 … Sep Y → admission year Y).
 */

import {
  admissionYearForEnquiryDate,
  updateLead,
  type AdmissionLead,
  type AdmissionsState,
} from "@/lib/admissions";
import { normalizeMobile, type SisState, type SisStudent } from "@/lib/sis";

export type LeadSisMatchKind =
  | "mobile_and_child_name"
  | "child_and_guardian_name"
  | "child_name_only"
  | "family_mobile_only";

export type LeadSisMatch = {
  leadId: string;
  enquiryNo: string;
  childName: string;
  mobile: string;
  kind: LeadSisMatchKind;
  student: {
    id: string;
    fullName: string;
    admissionNo: string;
    classId: string;
    academicYearCode: string;
    status: string;
  };
};

export type LeadSisReconcileResult = {
  state: AdmissionsState;
  /** Leads flipped to Admitted (strong match) */
  admitted: LeadSisMatch[];
  /** Possible matches: same family mobile or same child name — tagged, left open */
  suspected: LeadSisMatch[];
  /** Leads whose admission year was corrected from the enquiry date */
  yearFixed: number;
  checked: number;
};

function normName(v: string): string {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First-name-aware child match: exact, containment, or same first token. */
function childNamesMatch(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) {
    return true;
  }
  const xf = x.split(" ")[0]!;
  const yf = y.split(" ")[0]!;
  return xf.length >= 4 && xf === yf;
}

function guardianNamesMatch(a: string, b: string): boolean {
  const x = normName(a).replace(/^(shri|smt|mr|mrs|ms)\s+/, "");
  const y = normName(b).replace(/^(shri|smt|mr|mrs|ms)\s+/, "");
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 5 && y.length >= 5 && (x.includes(y) || y.includes(x));
}

type StudentIndexEntry = {
  student: SisStudent;
  mobiles: Set<string>;
};

function buildStudentIndex(sis: SisState): {
  byMobile: Map<string, StudentIndexEntry[]>;
  byId: Map<string, SisStudent>;
  all: StudentIndexEntry[];
} {
  const byMobile = new Map<string, StudentIndexEntry[]>();
  const byId = new Map<string, SisStudent>();
  const all: StudentIndexEntry[] = [];
  // Deliberately no status filter: inactive / left students are matched too.
  for (const s of sis.students) {
    byId.set(s.id, s);
    const hh = sis.households.find((h) => h.id === s.householdId);
    const mobiles = new Set(
      [
        s.fatherMobile,
        s.motherMobile,
        s.emergencyMobile,
        hh?.mobile,
        hh?.whatsappMobile,
        hh?.altMobile,
      ]
        .map((m) => normalizeMobile(m || ""))
        .filter((m) => m.length === 10),
    );
    const entry = { student: s, mobiles };
    all.push(entry);
    for (const m of mobiles) {
      const list = byMobile.get(m) || [];
      list.push(entry);
      byMobile.set(m, list);
    }
  }
  return { byMobile, byId, all };
}

function studentStatusLabel(s: SisStudent): string {
  return s.status === "inactive" ? "inactive" : "active";
}

function studentInfoLine(s: SisStudent): string {
  return `${s.fullName} · Adm ${s.admissionNo || "—"} · ${s.academicYearCode || "—"} · ${studentStatusLabel(s)}`;
}

export const SIS_MATCH_KIND_LABELS: Record<LeadSisMatchKind, string> = {
  mobile_and_child_name: "Family mobile + child name",
  child_and_guardian_name: "Child + guardian name",
  child_name_only: "Same child name only",
  family_mobile_only: "Same family mobile (different child)",
};

/** Compare lead fields vs a SIS student and list mismatches / confirmations. */
export function buildSisMismatchDetails(
  lead: AdmissionLead,
  student: SisStudent,
  kind: LeadSisMatchKind,
  classLabel?: string,
): string[] {
  const notes: string[] = [];
  notes.push(`Match reason: ${SIS_MATCH_KIND_LABELS[kind] || kind}`);
  notes.push(
    `SIS: ${student.fullName} · Adm ${student.admissionNo || "—"} · session ${student.academicYearCode || "—"} · ${studentStatusLabel(student)}`,
  );
  if (classLabel) {
    notes.push(`Current class: ${classLabel}`);
  } else if (student.classId) {
    notes.push(`Current class id: ${student.classId}`);
  }
  if (student.joinedOn) {
    notes.push(`SIS joined / admission date: ${student.joinedOn.slice(0, 10)}`);
  }

  const leadChild = normName(lead.childName);
  const sisChild = normName(student.fullName);
  if (leadChild && sisChild && leadChild !== sisChild) {
    notes.push(`Child name differs: lead “${lead.childName}” vs SIS “${student.fullName}”`);
  } else if (leadChild && sisChild) {
    notes.push("Child name matches");
  }

  const leadG = normName(lead.guardianName);
  const sisF = normName(student.fatherName);
  if (leadG && sisF && !guardianNamesMatch(lead.guardianName, student.fatherName)) {
    notes.push(
      `Guardian differs: lead “${lead.guardianName}” vs SIS father “${student.fatherName || "—"}”`,
    );
  } else if (leadG && sisF) {
    notes.push("Guardian / father name matches");
  } else if (leadG && !sisF) {
    notes.push(`Lead guardian “${lead.guardianName}” — SIS father blank`);
  }

  if (lead.motherName && student.motherName) {
    if (!guardianNamesMatch(lead.motherName, student.motherName)) {
      notes.push(
        `Mother differs: lead “${lead.motherName}” vs SIS “${student.motherName}”`,
      );
    } else {
      notes.push("Mother name matches");
    }
  }

  const leadMobile = normalizeMobile(lead.mobile || "");
  const sisMobiles = [
    student.fatherMobile,
    student.motherMobile,
    student.emergencyMobile,
  ]
    .map((m) => normalizeMobile(m || ""))
    .filter((m) => m.length === 10);
  if (leadMobile.length === 10) {
    if (sisMobiles.includes(leadMobile)) {
      notes.push(`Mobile ${leadMobile} found on SIS family`);
    } else if (sisMobiles.length) {
      notes.push(
        `Mobile differs: lead ${leadMobile} vs SIS ${[...new Set(sisMobiles)].join(", ")}`,
      );
    } else {
      notes.push(`Lead mobile ${leadMobile} — no mobile on SIS student`);
    }
  }

  if (
    lead.academicYearCode &&
    student.academicYearCode &&
    lead.academicYearCode !== student.academicYearCode
  ) {
    notes.push(
      `Year differs: lead admission year ${lead.academicYearCode} vs SIS session ${student.academicYearCode}`,
    );
  }

  if (kind === "family_mobile_only") {
    notes.push(
      "Likely sibling / same household — child on lead is not this SIS student",
    );
  }
  if (kind === "child_name_only") {
    notes.push(
      "Name collision only — confirm mobile / guardian before treating as admitted",
    );
  }

  return notes;
}

function toMatch(
  lead: AdmissionLead,
  student: SisStudent,
  kind: LeadSisMatchKind,
): LeadSisMatch {
  return {
    leadId: lead.id,
    enquiryNo: lead.enquiryNo,
    childName: lead.childName,
    mobile: lead.mobile,
    kind,
    student: {
      id: student.id,
      fullName: student.fullName,
      admissionNo: student.admissionNo,
      classId: student.classId,
      academicYearCode: student.academicYearCode,
      status: studentStatusLabel(student),
    },
  };
}

/**
 * Check every lead against SIS students (any academic session, any status).
 * Strong match (family mobile + child name, or exact child + guardian name)
 * → stage becomes "enrolled" with student link + Active/Inactive status.
 * Weaker match (family mobile only, or same child name only) → lead tagged
 * "Suspected in SIS" but left open. Already-linked leads get their
 * Active/Inactive status refreshed. Admission year is corrected from the
 * enquiry date for open leads.
 */
export function reconcileLeadsWithSis(
  state: AdmissionsState,
  sis: SisState,
): LeadSisReconcileResult {
  const { byMobile, byId, all } = buildStudentIndex(sis);
  const admitted: LeadSisMatch[] = [];
  const suspected: LeadSisMatch[] = [];
  let next = state;
  let checked = 0;
  let yearFixed = 0;

  for (const lead of state.leads) {
    // Refresh status on leads already linked to a student
    if (lead.studentId) {
      const s = byId.get(lead.studentId);
      if (s) {
        const status = studentStatusLabel(s);
        const info = studentInfoLine(s);
        const ay = s.academicYearCode || lead.academicYearCode;
        const kind =
          (lead.sisMatchKind as LeadSisMatchKind) || "mobile_and_child_name";
        const mismatches = buildSisMismatchDetails(lead, s, kind);
        if (
          lead.sisMatch !== "admitted" ||
          lead.sisStudentStatus !== status ||
          lead.sisStudentInfo !== info ||
          lead.academicYearCode !== ay ||
          lead.sisMatchKind !== kind
        ) {
          next = updateLead(next, lead.id, {
            sisMatch: "admitted",
            sisStudentId: s.id,
            sisStudentStatus: status,
            sisStudentInfo: info,
            sisMatchKind: kind,
            sisMismatchNotes: mismatches,
            academicYearCode: ay,
          });
        }
      }
      continue;
    }

    // Normalize admission year from the enquiry date (Oct→Sep window)
    const wantAy = admissionYearForEnquiryDate(
      lead.leadDate || lead.createdAt,
    );
    if (wantAy && lead.academicYearCode !== wantAy) {
      next = updateLead(next, lead.id, { academicYearCode: wantAy });
      yearFixed += 1;
    }

    if (lead.stage === "enrolled" || lead.stage === "lost") continue;
    checked += 1;

    const mobile = normalizeMobile(lead.mobile || "");
    const candidates =
      mobile.length === 10 ? (byMobile.get(mobile) ?? []) : [];

    // 1) Family mobile + child name → admitted
    let hit =
      candidates.find((c) =>
        childNamesMatch(lead.childName, c.student.fullName),
      ) || null;
    let kind: LeadSisMatchKind = "mobile_and_child_name";

    // 2) No mobile hit → exact child + guardian name across register
    if (!hit) {
      hit =
        all.find(
          (c) =>
            normName(c.student.fullName) === normName(lead.childName) &&
            normName(lead.childName).length >= 5 &&
            guardianNamesMatch(lead.guardianName, c.student.fatherName),
        ) || null;
      kind = "child_and_guardian_name";
    }

    if (hit) {
      const s = hit.student;
      admitted.push(toMatch(lead, s, kind));
      next = updateLead(next, lead.id, {
        stage: "enrolled",
        studentId: s.id,
        admissionNo: s.admissionNo,
        classAdmittedId: s.classId,
        admissionDate: lead.admissionDate || s.joinedOn || "",
        academicYearCode: s.academicYearCode || lead.academicYearCode,
        sisMatch: "admitted",
        sisStudentId: s.id,
        sisStudentStatus: studentStatusLabel(s),
        sisStudentInfo: studentInfoLine(s),
        sisMatchKind: kind,
        sisMismatchNotes: buildSisMismatchDetails(lead, s, kind),
        note: [lead.note, `Auto-matched to SIS: ${studentInfoLine(s)}`]
          .filter(Boolean)
          .join(" · "),
      });
      continue;
    }

    // 3) Weaker signals → "Suspected in SIS", lead stays open
    let suspect: SisStudent | null = null;
    let suspectKind: LeadSisMatchKind = "family_mobile_only";
    if (candidates.length > 0) {
      suspect = candidates[0]!.student;
    } else if (normName(lead.childName).length >= 6) {
      const byName = all.find(
        (c) => normName(c.student.fullName) === normName(lead.childName),
      );
      if (byName) {
        suspect = byName.student;
        suspectKind = "child_name_only";
      }
    }

    if (suspect) {
      // Counsellor already dismissed / kept-open this SIS student — don't re-tag
      if (
        lead.sisDismissedStudentId &&
        lead.sisDismissedStudentId === suspect.id &&
        (lead.sisReviewStatus === "keep_open" ||
          lead.sisReviewStatus === "closed_not_match")
      ) {
        continue;
      }
      suspected.push(toMatch(lead, suspect, suspectKind));
      const isFamily = suspectKind === "family_mobile_only";
      const mismatches = buildSisMismatchDetails(lead, suspect, suspectKind);
      const patch: Partial<AdmissionLead> = {
        sisMatch: "suspected",
        sisStudentId: suspect.id,
        sisStudentStatus: studentStatusLabel(suspect),
        sisStudentInfo: studentInfoLine(suspect),
        sisMatchKind: suspectKind,
        sisMismatchNotes: mismatches,
      };
      const tag = isFamily
        ? `Family in SIS: sibling ${suspect.fullName} (Adm ${suspect.admissionNo || "—"}, ${suspect.academicYearCode || "—"})`
        : `Suspected in SIS: same name ${studentInfoLine(suspect)}`;
      if (isFamily) patch.siblingInSchool = true;
      const notePrefix = isFamily ? "Family in SIS:" : "Suspected in SIS:";
      if (!lead.note.includes(notePrefix)) {
        patch.note = [lead.note, tag].filter(Boolean).join(" · ");
      }
      const mismatchSame =
        lead.sisMismatchNotes.length === mismatches.length &&
        lead.sisMismatchNotes.every((n, i) => n === mismatches[i]);
      const changed =
        lead.sisMatch !== "suspected" ||
        lead.sisStudentId !== suspect.id ||
        lead.sisStudentStatus !== studentStatusLabel(suspect) ||
        lead.sisMatchKind !== suspectKind ||
        !mismatchSame ||
        patch.note !== undefined ||
        (isFamily && !lead.siblingInSchool);
      if (changed) {
        next = updateLead(next, lead.id, patch);
      }
    } else if (lead.sisMatch === "suspected") {
      // Previously suspected but no longer matches anything → clear
      next = updateLead(next, lead.id, {
        sisMatch: "",
        sisStudentId: "",
        sisStudentStatus: "",
        sisStudentInfo: "",
        sisMatchKind: "",
        sisMismatchNotes: [],
      });
    }
  }

  return { state: next, admitted, suspected, yearFixed, checked };
}

function studentPatchFromSis(
  lead: AdmissionLead,
  student: SisStudent,
  kind: LeadSisMatchKind,
): Partial<AdmissionLead> {
  const status = studentStatusLabel(student);
  const info = studentInfoLine(student);
  return {
    stage: "enrolled",
    childName: student.fullName || lead.childName,
    guardianName: student.fatherName || lead.guardianName,
    motherName: student.motherName || lead.motherName,
    mobile:
      normalizeMobile(student.fatherMobile || "") ||
      normalizeMobile(student.motherMobile || "") ||
      lead.mobile,
    studentId: student.id,
    admissionNo: student.admissionNo,
    classAdmittedId: student.classId || lead.classAdmittedId,
    classSoughtId: lead.classSoughtId || student.classId,
    sectionId: student.sectionId || lead.sectionId,
    admissionDate: lead.admissionDate || student.joinedOn || "",
    academicYearCode: student.academicYearCode || lead.academicYearCode,
    gender:
      lead.gender ||
      (student.gender === "M" || student.gender === "F" || student.gender === "O"
        ? student.gender
        : lead.gender),
    dob: lead.dob || student.dob || "",
    sisMatch: "admitted",
    sisStudentId: student.id,
    sisStudentStatus: status,
    sisStudentInfo: info,
    sisMatchKind: kind,
    sisMismatchNotes: buildSisMismatchDetails(lead, student, kind),
    sisReviewStatus: "verified",
    sisDismissedStudentId: "",
    note: [
      lead.note,
      `Verified with SIS: ${info}`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * Counsellor confirms a suspected (or linked) SIS hit — update the lead
 * from the SIS student record and mark Admitted.
 */
export function verifySuspectedLeadWithSis(
  state: AdmissionsState,
  leadId: string,
  sis: SisState,
): { ok: true; state: AdmissionsState; student: SisStudent } | { ok: false; reason: string } {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: "Lead not found" };
  const sid = lead.sisStudentId || lead.studentId;
  if (!sid) return { ok: false, reason: "No SIS student linked on this lead" };
  const student = sis.students.find((s) => s.id === sid);
  if (!student) return { ok: false, reason: "SIS student not found in register" };
  const kind = (lead.sisMatchKind || "mobile_and_child_name") as LeadSisMatchKind;
  return {
    ok: true,
    state: updateLead(state, leadId, studentPatchFromSis(lead, student, kind)),
    student,
  };
}

/**
 * Clear the suspected tag and keep the lead open for counsellor work.
 * The dismissed SIS student will not be re-tagged on the next auto-check.
 */
export function keepSuspectedLeadOpen(
  state: AdmissionsState,
  leadId: string,
): { ok: true; state: AdmissionsState } | { ok: false; reason: string } {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: "Lead not found" };
  if (lead.stage === "enrolled") {
    return { ok: false, reason: "Lead is already admitted" };
  }
  const dismissedId = lead.sisStudentId || lead.sisDismissedStudentId;
  return {
    ok: true,
    state: updateLead(state, leadId, {
      sisMatch: "",
      sisStudentId: "",
      sisStudentStatus: "",
      sisStudentInfo: "",
      sisMatchKind: "",
      sisMismatchNotes: [],
      sisReviewStatus: "keep_open",
      sisDismissedStudentId: dismissedId,
      note: [lead.note, "SIS suspect kept open — counsellor still working"]
        .filter(Boolean)
        .join(" · "),
    }),
  };
}

/**
 * Close the lead as not matching this SIS student (mark lost) and stop re-tagging.
 */
export function closeSuspectedLeadNotMatch(
  state: AdmissionsState,
  leadId: string,
  reason?: string,
): { ok: true; state: AdmissionsState } | { ok: false; reason: string } {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: "Lead not found" };
  if (lead.stage === "enrolled") {
    return { ok: false, reason: "Lead is already admitted" };
  }
  const dismissedId = lead.sisStudentId || lead.sisDismissedStudentId;
  const lostReason =
    reason?.trim() ||
    "Closed after SIS review — not the same student / not proceeding";
  return {
    ok: true,
    state: updateLead(state, leadId, {
      stage: "lost",
      lostReason,
      sisMatch: "",
      sisStudentId: "",
      sisStudentStatus: "",
      sisStudentInfo: "",
      sisMatchKind: "",
      sisMismatchNotes: [],
      sisReviewStatus: "closed_not_match",
      sisDismissedStudentId: dismissedId,
      note: [lead.note, `SIS suspect closed: ${lostReason}`]
        .filter(Boolean)
        .join(" · "),
    }),
  };
}

