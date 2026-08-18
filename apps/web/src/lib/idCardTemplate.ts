/**
 * ID card template — orientation, single/double-sided, and which fields
 * print on which side. Two independently-editable instances (student and
 * staff), not one shared template with a kind switch — father/mother/
 * guardian fields must never even be selectable for staff, not just
 * silently ignored at render time (lib/idCardsPdf.ts's buildStaffIdCardDoc
 * is the second, independent backstop: it never populates those keys).
 *
 * Storage: localStorage only, matching lib/dutyRoster.ts's shape — except
 * saveIdCardTemplateState calls the real assertModulePermission guard,
 * which lib/dutyRoster.ts's own saveDutyRoster is missing.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

export type IdCardKind = "student" | "staff";

export type IdCardOrientation = "portrait" | "landscape";
export type IdCardSides = "front_only" | "front_back";

export type IdCardPhotoFieldId =
  | "student_photo"
  | "father_photo"
  | "mother_photo"
  | "guardian_photo";

export type IdCardTextFieldId =
  | "name"
  | "class_section"
  | "roll_no"
  | "admission_no"
  | "designation"
  | "emp_code"
  | "department"
  | "blood_group"
  | "dob"
  | "father_name"
  | "mother_name"
  | "validity";

export type IdCardFieldId = "qr" | IdCardPhotoFieldId | IdCardTextFieldId;

/** Fixed render order for text fields — users pick the SET via checkboxes,
 * not the order (no drag-reorder, out of scope). */
export const ID_CARD_TEXT_FIELD_PRIORITY: IdCardTextFieldId[] = [
  "name",
  "class_section",
  "roll_no",
  "admission_no",
  "designation",
  "emp_code",
  "department",
  "blood_group",
  "dob",
  "father_name",
  "mother_name",
  "validity",
];

export const ID_CARD_SECONDARY_PHOTO_IDS: IdCardPhotoFieldId[] = [
  "father_photo",
  "mother_photo",
  "guardian_photo",
];

export const ID_CARD_FIELD_CATALOG: Record<
  IdCardFieldId,
  { label: string; kind: "photo" | "text" | "qr"; appliesTo: IdCardKind[] }
> = {
  student_photo: { label: "Student photo", kind: "photo", appliesTo: ["student", "staff"] },
  father_photo: { label: "Father's photo", kind: "photo", appliesTo: ["student"] },
  mother_photo: { label: "Mother's photo", kind: "photo", appliesTo: ["student"] },
  guardian_photo: { label: "Guardian's photo", kind: "photo", appliesTo: ["student"] },
  qr: { label: "QR code", kind: "qr", appliesTo: ["student", "staff"] },
  name: { label: "Name", kind: "text", appliesTo: ["student", "staff"] },
  class_section: { label: "Class & section", kind: "text", appliesTo: ["student"] },
  roll_no: { label: "Roll no.", kind: "text", appliesTo: ["student"] },
  admission_no: { label: "Admission no.", kind: "text", appliesTo: ["student"] },
  designation: { label: "Designation", kind: "text", appliesTo: ["staff"] },
  emp_code: { label: "Employee code", kind: "text", appliesTo: ["staff"] },
  department: { label: "Department", kind: "text", appliesTo: ["staff"] },
  blood_group: { label: "Blood group", kind: "text", appliesTo: ["student", "staff"] },
  dob: { label: "Date of birth", kind: "text", appliesTo: ["student", "staff"] },
  father_name: { label: "Father's name", kind: "text", appliesTo: ["student"] },
  mother_name: { label: "Mother's name", kind: "text", appliesTo: ["student"] },
  validity: { label: "Validity (AY)", kind: "text", appliesTo: ["student", "staff"] },
};

export type IdCardTemplate = {
  orientation: IdCardOrientation;
  sides: IdCardSides;
  frontFields: IdCardFieldId[];
  /** Ignored when sides === "front_only". */
  backFields: IdCardFieldId[];
};

export type IdCardTemplateState = {
  version: 1;
  student: IdCardTemplate;
  staff: IdCardTemplate;
};

const STORAGE_KEY = "bhb_id_card_template_v1";

function isFieldValidFor(field: IdCardFieldId, kind: IdCardKind): boolean {
  return ID_CARD_FIELD_CATALOG[field]?.appliesTo.includes(kind) ?? false;
}

function defaultStudentTemplate(): IdCardTemplate {
  return {
    orientation: "landscape",
    sides: "front_only",
    frontFields: [
      "student_photo",
      "qr",
      "name",
      "class_section",
      "roll_no",
      "admission_no",
      "blood_group",
      "validity",
    ],
    backFields: [],
  };
}

function defaultStaffTemplate(): IdCardTemplate {
  return {
    orientation: "landscape",
    sides: "front_only",
    frontFields: ["student_photo", "qr", "name", "designation", "emp_code", "department", "validity"],
    backFields: [],
  };
}

export function emptyIdCardTemplateState(): IdCardTemplateState {
  return { version: 1, student: defaultStudentTemplate(), staff: defaultStaffTemplate() };
}

/** Preset builders — applied on click (not a persisted "mode"); afterward
 * the fields behave exactly like full custom checkbox edits. */
export const ID_CARD_PRESETS: {
  id: string;
  label: string;
  build: (kind: IdCardKind) => IdCardTemplate;
}[] = [
  {
    id: "standard",
    label: "Standard (front only)",
    build: (kind) => (kind === "student" ? defaultStudentTemplate() : defaultStaffTemplate()),
  },
  {
    id: "with_parents",
    label: "With parent photos (front + back)",
    build: (kind) =>
      kind === "student"
        ? {
            orientation: "landscape",
            sides: "front_back",
            frontFields: ["student_photo", "qr", "name", "class_section", "roll_no", "admission_no", "validity"],
            backFields: [
              "father_photo",
              "mother_photo",
              "guardian_photo",
              "father_name",
              "mother_name",
              "blood_group",
              "dob",
            ],
          }
        : {
            orientation: "landscape",
            sides: "front_back",
            frontFields: ["student_photo", "qr", "name", "designation", "emp_code", "department", "validity"],
            backFields: ["blood_group", "dob"],
          },
  },
];

function normalizeTemplate(
  raw: Partial<IdCardTemplate> | null | undefined,
  kind: IdCardKind,
): IdCardTemplate {
  const fallback = kind === "student" ? defaultStudentTemplate() : defaultStaffTemplate();
  if (!raw) return fallback;
  const orientation: IdCardOrientation = raw.orientation === "portrait" ? "portrait" : "landscape";
  const sides: IdCardSides = raw.sides === "front_back" ? "front_back" : "front_only";
  const clean = (list: unknown): IdCardFieldId[] =>
    Array.isArray(list)
      ? list.filter(
          (f): f is IdCardFieldId =>
            typeof f === "string" && f in ID_CARD_FIELD_CATALOG && isFieldValidFor(f as IdCardFieldId, kind),
        )
      : [];
  const frontFields = clean(raw.frontFields);
  const backFields = clean(raw.backFields);
  return {
    orientation,
    sides,
    frontFields: frontFields.length ? frontFields : fallback.frontFields,
    backFields,
  };
}

export function normalizeIdCardTemplateState(raw: unknown): IdCardTemplateState {
  if (!raw || typeof raw !== "object") return emptyIdCardTemplateState();
  const r = raw as Partial<IdCardTemplateState>;
  return {
    version: 1,
    student: normalizeTemplate(r.student, "student"),
    staff: normalizeTemplate(r.staff, "staff"),
  };
}

export function loadIdCardTemplateState(): IdCardTemplateState {
  if (typeof window === "undefined") return emptyIdCardTemplateState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyIdCardTemplateState();
    return normalizeIdCardTemplateState(JSON.parse(raw));
  } catch {
    return emptyIdCardTemplateState();
  }
}

/** The real permission guard — see file header for why this differs from
 * lib/dutyRoster.ts's saveDutyRoster, which has no such check. */
export function saveIdCardTemplateState(state: IdCardTemplateState): IdCardTemplateState {
  if (!assertModulePermission("id_cards", "edit", "saveIdCardTemplate")) {
    return state;
  }
  const next = normalizeIdCardTemplateState(state);
  if (typeof window !== "undefined") {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
    void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("id_card_template", next));
    window.dispatchEvent(new CustomEvent("bhb-id-card-template"));
  }
  return next;
}

/** Hydrate path (module_local_state) — cache write only, no RBAC, no push. */
export function writeIdCardTemplateStateLocalRaw(state: IdCardTemplateState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — the server copy is the truth anyway */
  }
  window.dispatchEvent(new CustomEvent("bhb-id-card-template"));
}
