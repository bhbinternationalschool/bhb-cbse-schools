/**
 * What a parent-uploaded document IS, chosen by the teacher who verifies it
 * (request mr_mv9z5lg1jlih, approved 20 Oct 2026) — pure.
 *
 * A parent picks a slot in the app ("Aadhaar", "Birth certificate" …) and
 * often picks the wrong one: the mother's Aadhaar lands in the child's
 * Aadhaar slot, a TC under address proof. The verifier now says what the
 * document really is, and the document goes where the record keeps that
 * kind — the same destinations the WhatsApp document intake uses
 * (lib/udiseDocIntakeAi docSlotFor, PR #158/#247):
 *
 *   a child's document  → its slot in the child's documents
 *                         (birth certificate, Aadhaar, TC, …);
 *   a parent's Aadhaar  → no slot of its own (exactly as the intake files
 *                         it): kept on the school's list of filed documents,
 *                         and — when the verifier types the 12 digits — the
 *                         number goes onto the parent's Aadhaar field of
 *                         every child of the family, as "received"
 *                         (lib/appPopups.server saveFamilyAadhaar);
 *   a custom type       → the school's list of filed documents.
 *
 * Custom types and the filed list live in module_local_state
 * "student_doc_types" (no migration). Self-tested in
 * studentDocTypes.selftest.ts.
 */

import { emptyStudentDocs, type StudentDocFile, type StudentDocKey, type StudentDocs } from "@/lib/sis";

export type AadhaarOf = "child" | "father" | "mother";

export type StudentDocTypeDef = {
  id: string;
  label: string;
  labelHi: string;
  /** The child's document slot this type lives in; null = filed off-slot. */
  slot: StudentDocKey | null;
  /** An Aadhaar card, and whose — the verifier may type its number. */
  aadhaarOf: AadhaarOf | null;
  custom: boolean;
};

/** Built-in types: the child's slots, plus the parents' Aadhaar the intake already knows. */
export const BUILT_IN_DOC_TYPES: StudentDocTypeDef[] = [
  { id: "birthCert", label: "Birth certificate", labelHi: "जन्म प्रमाणपत्र", slot: "birthCert", aadhaarOf: null, custom: false },
  { id: "aadhaar", label: "Child's Aadhaar", labelHi: "बच्चे का आधार", slot: "aadhaar", aadhaarOf: "child", custom: false },
  { id: "fatherAadhaar", label: "Father's Aadhaar", labelHi: "पिता का आधार", slot: null, aadhaarOf: "father", custom: false },
  { id: "motherAadhaar", label: "Mother's Aadhaar", labelHi: "माता का आधार", slot: null, aadhaarOf: "mother", custom: false },
  { id: "addressProof", label: "Address proof", labelHi: "पते का प्रमाण", slot: "addressProof", aadhaarOf: null, custom: false },
  { id: "tc", label: "Transfer certificate", labelHi: "स्थानांतरण प्रमाणपत्र (TC)", slot: "tc", aadhaarOf: null, custom: false },
  { id: "casteCert", label: "Caste / category certificate", labelHi: "जाति प्रमाणपत्र", slot: "casteCert", aadhaarOf: null, custom: false },
  { id: "incomeCert", label: "Income certificate", labelHi: "आय प्रमाणपत्र", slot: "incomeCert", aadhaarOf: null, custom: false },
  { id: "photo", label: "Passport photo", labelHi: "पासपोर्ट फ़ोटो", slot: "photo", aadhaarOf: null, custom: false },
];

export type CustomDocType = { id: string; label: string; createdBy: string; createdAt: string };

/** A verified document kept off the child's slots (a parent's Aadhaar, a custom type). */
export type FiledStudentDoc = {
  id: string;
  studentId: string;
  householdId: string;
  typeId: string;
  typeLabel: string;
  /** The slot the parent uploaded it under. */
  fromSlot: StudentDocKey;
  fileName: string;
  mimeType: string;
  size: number;
  /** Server-only; never sent to a client. */
  driveFileId: string;
  uploadedAt: string;
  submittedBy: string;
  submittedAt: string;
  verifiedBy: string;
  verifiedAt: string;
  note: string;
};

export type StudentDocTypesState = {
  version: 1;
  custom: CustomDocType[];
  filed: FiledStudentDoc[];
};

export function emptyStudentDocTypesState(): StudentDocTypesState {
  return { version: 1, custom: [], filed: [] };
}

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function normalizeStudentDocTypesState(raw: unknown): StudentDocTypesState {
  if (!raw || typeof raw !== "object") return emptyStudentDocTypesState();
  const o = raw as Partial<StudentDocTypesState>;
  const custom = (Array.isArray(o.custom) ? o.custom : [])
    .map((c) => ({ id: str(c?.id, 80), label: str(c?.label, 60), createdBy: str(c?.createdBy, 120), createdAt: str(c?.createdAt, 40) }))
    .filter((c) => c.id && c.label);
  const filed = (Array.isArray(o.filed) ? o.filed : []).filter(
    (f): f is FiledStudentDoc => !!f && typeof f === "object" && typeof f.id === "string" && typeof f.studentId === "string",
  );
  return { version: 1, custom, filed };
}

const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, " ").trim();

/** Built-ins first, then the school's own types (alphabetical). */
export function docTypeCatalogue(state: StudentDocTypesState | null): StudentDocTypeDef[] {
  const custom = [...(state?.custom ?? [])]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map<StudentDocTypeDef>((c) => ({ id: c.id, label: c.label, labelHi: c.label, slot: null, aadhaarOf: null, custom: true }));
  return [...BUILT_IN_DOC_TYPES, ...custom];
}

export function findDocType(state: StudentDocTypesState | null, id: string): StudentDocTypeDef | undefined {
  return docTypeCatalogue(state).find((t) => t.id === id);
}

/**
 * Add a custom type. A label that names an existing type (built-in or
 * custom, ignoring case and punctuation) returns THAT type, so two teachers
 * typing "Ration card" make one type, not two.
 */
export function addCustomDocType(
  state: StudentDocTypesState,
  rawLabel: string,
  by: string,
  now: string,
  makeId: () => string,
): { ok: true; state: StudentDocTypesState; type: StudentDocTypeDef; created: boolean } | { ok: false; error: string } {
  const label = (rawLabel || "").replace(/\s+/g, " ").trim();
  if (label.length < 2) return { ok: false, error: "Name the document type (at least 2 letters)" };
  if (label.length > 60) return { ok: false, error: "Keep the type's name under 60 characters" };
  const k = keyOf(label);
  if (!k) return { ok: false, error: "Name the document type in words" };
  const existing = docTypeCatalogue(state).find((t) => keyOf(t.label) === k || keyOf(t.labelHi) === k);
  if (existing) return { ok: true, state, type: existing, created: false };
  if (state.custom.length >= 100) return { ok: false, error: "The school already has 100 custom types — use one of them" };
  const c: CustomDocType = { id: `cdt_${makeId()}`, label, createdBy: by, createdAt: now };
  const next = { ...state, custom: [...state.custom, c] };
  return { ok: true, state: next, type: { id: c.id, label, labelHi: label, slot: null, aadhaarOf: null, custom: true }, created: true };
}

/** Where a verified document goes once its type is chosen. */
export type DocTypePlan =
  | { kind: "same_slot"; slot: StudentDocKey }
  | { kind: "move"; from: StudentDocKey; to: StudentDocKey }
  | { kind: "file_off_slot"; from: StudentDocKey };

/**
 * Decide the move. Refused when it would overwrite something: a target slot
 * already holding a file that has not been rejected is somebody's document,
 * not an empty place to put this one. A photo stays a photo (the profile
 * photo is changed from My class).
 */
export function planDocType(input: {
  fromSlot: StudentDocKey;
  type: StudentDocTypeDef;
  docs: StudentDocs;
}): { ok: true; plan: DocTypePlan } | { ok: false; error: string } {
  const { fromSlot, type, docs } = input;
  if (type.slot === fromSlot) return { ok: true, plan: { kind: "same_slot", slot: fromSlot } };
  if (fromSlot === "photo" || type.slot === "photo") {
    return { ok: false, error: "A photo stays a photo — change the child's photo from My class" };
  }
  if (type.slot) {
    const target = docs[type.slot];
    if (target && target.fileUrl && target.status !== "rejected" && target.status !== "missing") {
      return {
        ok: false,
        error: `${type.label} already has a document (${target.status}). Reject this one with a note, or ask the office to replace it.`,
      };
    }
    return { ok: true, plan: { kind: "move", from: fromSlot, to: type.slot } };
  }
  return { ok: true, plan: { kind: "file_off_slot", from: fromSlot } };
}

/**
 * The child's documents after verifying under the chosen type. `proxyUrl`
 * gives the slot's own file URL (documentProxyUrl), because the proxy
 * serves a file BY SLOT — a moved file must carry its new slot's URL.
 */
export function applyDocTypePlan(input: {
  docs: StudentDocs;
  plan: DocTypePlan;
  type: StudentDocTypeDef;
  reviewedBy: string;
  reviewedAt: string;
  note: string;
  proxyUrl: (slot: StudentDocKey) => string;
}): StudentDocs {
  const { docs, plan, type } = input;
  const from = plan.kind === "same_slot" ? plan.slot : plan.from;
  const doc = docs[from];
  const verified: StudentDocFile = {
    ...doc,
    status: "verified",
    reviewedBy: input.reviewedBy,
    reviewedAt: input.reviewedAt,
    reviewNote: input.note,
    docType: type.id,
    docTypeLabel: type.label,
  };
  if (plan.kind === "same_slot") return { ...docs, [from]: verified };
  const emptied = emptyStudentDocs()[from];
  if (plan.kind === "move") {
    return { ...docs, [from]: emptied, [plan.to]: { ...verified, fileUrl: input.proxyUrl(plan.to) } };
  }
  return { ...docs, [from]: emptied };
}

/** The filed-list entry for a document verified off the child's slots. */
export function filedEntryFor(input: {
  id: string;
  studentId: string;
  householdId: string;
  fromSlot: StudentDocKey;
  doc: StudentDocFile;
  type: StudentDocTypeDef;
  verifiedBy: string;
  verifiedAt: string;
  note: string;
}): FiledStudentDoc {
  const d = input.doc;
  return {
    id: input.id,
    studentId: input.studentId,
    householdId: input.householdId,
    typeId: input.type.id,
    typeLabel: input.type.label,
    fromSlot: input.fromSlot,
    fileName: d.fileName,
    mimeType: d.mimeType,
    size: d.size,
    driveFileId: d.driveFileId || "",
    uploadedAt: d.uploadedAt,
    submittedBy: d.submittedBy || "",
    submittedAt: d.submittedAt || "",
    verifiedBy: input.verifiedBy,
    verifiedAt: input.verifiedAt,
    note: input.note,
  };
}
