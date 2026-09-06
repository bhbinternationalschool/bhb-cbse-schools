/**
 * Student roster filter state — persistence, URL sharing and saved views.
 *
 * The workspace exposes 14 filters but none of them survived navigation:
 * a clerk working through Class IX-B re-selected every filter after each
 * student. State now round-trips through localStorage (so it survives a
 * visit to a student and back) and through the URL (so a filtered roster
 * can be sent to a colleague).
 *
 * Also adds "missing field" filters. The roster has real completeness
 * gaps — 699 of 711 students without an APAAR ID, 205 without a PEN —
 * and none of the existing filters could express "show me the ones that
 * are blank", which is exactly the work list.
 */

import { isRealPortalId, type SisStudent } from "@/lib/sis";

/**
 * The completeness selector. Historically "which field is BLANK", which is
 * why the type is still called MissingField and the state key is still
 * `missingFilter`; it now also carries the positive states, because the
 * office needs to list the children who DO have an Aadhaar as often as the
 * ones who do not — "who is ready to register on UDISE+" is the first
 * question asked of the 43 children with neither id (2026-09-06).
 */
export type MissingField =
  | ""
  | "pen"
  | "apaar"
  | "aadhaar"
  | "dob"
  | "photo"
  | "household"
  | "guardianMobile"
  | "section"
  /** Positive states — the child HAS this. */
  | "has_pen"
  | "has_apaar"
  | "has_aadhaar"
  /** Portal states, matching the badge in front of the student. */
  | "udise_ok"
  | "udise_none";

export type StudentFilterState = {
  query: string;
  sessionFilter: string;
  classFilter: string;
  sectionFilter: string;
  statusFilter: string;
  typeFilter: string;
  genderFilter: string;
  categoryFilter: string;
  feeGroupFilter: string;
  campusFilter: string;
  penStatusFilter: string;
  bloodFilter: string;
  joinedFrom: string;
  joinedTo: string;
  missingFilter: MissingField;
  matchMode: "all" | "any";
  sortBy: string;
  sortOrder: "asc" | "desc";
};

export const EMPTY_FILTERS: StudentFilterState = {
  query: "",
  sessionFilter: "",
  classFilter: "",
  sectionFilter: "",
  statusFilter: "active",
  typeFilter: "",
  genderFilter: "",
  categoryFilter: "",
  feeGroupFilter: "",
  campusFilter: "",
  penStatusFilter: "",
  bloodFilter: "",
  joinedFrom: "",
  joinedTo: "",
  missingFilter: "",
  matchMode: "all",
  sortBy: "rollNo",
  sortOrder: "asc",
};

/**
 * Values that mean "not filtering". statusFilter defaults to "active"
 * rather than "all", so the default is not the empty string — counting
 * active filters has to know that.
 */
const DEFAULTS: Record<string, string> = {
  statusFilter: "active",
  matchMode: "all",
  sortBy: "rollNo",
  sortOrder: "asc",
};

/** Filters the user has actually set — drives the "N active" badge. */
export function countActiveFilters(f: StudentFilterState): number {
  let n = 0;
  for (const [key, value] of Object.entries(f)) {
    if (key === "sortBy" || key === "sortOrder" || key === "matchMode") continue;
    const dflt = DEFAULTS[key] ?? "";
    if (String(value ?? "") !== dflt) n += 1;
  }
  return n;
}

export const MISSING_FIELD_LABELS: Record<Exclude<MissingField, "">, string> = {
  udise_ok: "UDISE OK (PEN + APAAR)",
  udise_none: "No PEN and no APAAR",
  pen: "PEN missing",
  has_pen: "PEN on file",
  apaar: "APAAR ID missing",
  has_apaar: "APAAR on file",
  aadhaar: "Aadhaar missing",
  has_aadhaar: "Aadhaar on file",
  dob: "Date of birth missing",
  photo: "Photo missing",
  household: "Not linked to a household",
  guardianMobile: "No guardian mobile",
  section: "No section assigned",
};

const blank = (v: unknown) => !String(v ?? "").trim();

/** True when the student has an Aadhaar on file, in full or as last four. */
export function hasAadhaarOnFile(s: SisStudent): boolean {
  return !(blank(s.aadhaarLast4) && blank(s.aadhaarNumber));
}

/**
 * True when the student is missing the requested field.
 *
 * PEN and APAAR go through `isRealPortalId` rather than a blank check, so
 * this agrees with the UDISE+ worklist and with the badge in front of the
 * student. It did not: ten children carrying a PEN of "0" or "NA" counted as
 * having one here while the worklist counted them as unregistered.
 */
export function isMissing(s: SisStudent, field: MissingField): boolean {
  switch (field) {
    case "pen":
      return !isRealPortalId(s.pen);
    case "apaar":
      return !isRealPortalId(s.apaarId);
    case "aadhaar":
      return !hasAadhaarOnFile(s);
    case "dob":
      return blank(s.dob);
    case "photo":
      return blank(s.photoUrl);
    case "household":
      return blank(s.householdId);
    case "guardianMobile":
      return blank(s.fatherMobile) && blank(s.motherMobile);
    case "section":
      return blank(s.sectionId);
    default:
      return true;
  }
}

/**
 * Does the student match the selected completeness option?
 *
 * The register filters through this rather than through `isMissing` alone,
 * so the positive states ("Aadhaar on file", "UDISE OK") select the students
 * the badge in front of them names. Every option here is expressible as a
 * badge and every badge is expressible as an option — that is the point.
 */
export function matchesCompleteness(s: SisStudent, field: MissingField): boolean {
  switch (field) {
    case "":
      return true;
    case "has_pen":
      return isRealPortalId(s.pen);
    case "has_apaar":
      return isRealPortalId(s.apaarId);
    case "has_aadhaar":
      return hasAadhaarOnFile(s);
    case "udise_ok":
      return isRealPortalId(s.pen) && isRealPortalId(s.apaarId);
    case "udise_none":
      return !isRealPortalId(s.pen) && !isRealPortalId(s.apaarId);
    default:
      return isMissing(s, field);
  }
}

export type SavedView = {
  id: string;
  name: string;
  filters: StudentFilterState;
  builtIn?: boolean;
};

/**
 * Shipped views for work the roster actually needs doing. These exist so
 * the compliance backlog is one click away instead of a filter the UI
 * could not previously express.
 */
export const BUILT_IN_VIEWS: SavedView[] = [
  {
    // The 43 children the UDISE+ backlog is actually about: the portal holds
    // nothing for them, so the badge shows "No PEN · No APAAR" and, next to
    // it, whether their Aadhaar is on file — which is what decides whether
    // they can be registered today (director, 2026-09-06).
    id: "builtin_udise_none",
    name: "Not on UDISE+ (no PEN, no APAAR)",
    builtIn: true,
    filters: { ...EMPTY_FILTERS, missingFilter: "udise_none", sortBy: "name" },
  },
  {
    id: "builtin_udise_ok",
    name: "UDISE OK (PEN + APAAR)",
    builtIn: true,
    filters: { ...EMPTY_FILTERS, missingFilter: "udise_ok", sortBy: "name" },
  },
  {
    id: "builtin_missing_apaar",
    name: "Missing APAAR ID",
    builtIn: true,
    filters: { ...EMPTY_FILTERS, missingFilter: "apaar", sortBy: "name" },
  },
  {
    id: "builtin_missing_pen",
    name: "Missing PEN",
    builtIn: true,
    filters: { ...EMPTY_FILTERS, missingFilter: "pen", sortBy: "name" },
  },
  {
    id: "builtin_missing_aadhaar",
    name: "Missing Aadhaar",
    builtIn: true,
    filters: { ...EMPTY_FILTERS, missingFilter: "aadhaar", sortBy: "name" },
  },
  {
    id: "builtin_missing_dob",
    name: "Missing date of birth",
    builtIn: true,
    filters: { ...EMPTY_FILTERS, missingFilter: "dob", sortBy: "name" },
  },
  {
    id: "builtin_no_household",
    name: "Not linked to a household",
    builtIn: true,
    filters: { ...EMPTY_FILTERS, missingFilter: "household", sortBy: "name" },
  },
  {
    id: "builtin_new_admissions",
    name: "New admissions",
    builtIn: true,
    filters: { ...EMPTY_FILTERS, typeFilter: "NEW", sortBy: "joinedOn", sortOrder: "desc" },
  },
  {
    id: "builtin_inactive",
    name: "Inactive students",
    builtIn: true,
    filters: { ...EMPTY_FILTERS, statusFilter: "inactive", sortBy: "name" },
  },
];

const FILTER_KEY = "bhb_sis_filters_v1";
const VIEWS_KEY = "bhb_sis_saved_views_v1";

function coerce(raw: unknown): StudentFilterState {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...EMPTY_FILTERS };
  for (const key of Object.keys(EMPTY_FILTERS) as (keyof StudentFilterState)[]) {
    const v = src[key];
    if (typeof v === "string") {
      (out as Record<string, string>)[key] = v;
    }
  }
  if (out.matchMode !== "any") out.matchMode = "all";
  if (out.sortOrder !== "desc") out.sortOrder = "asc";
  return out;
}

export function loadFilters(): StudentFilterState {
  if (typeof window === "undefined") return { ...EMPTY_FILTERS };
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return { ...EMPTY_FILTERS };
    return coerce(JSON.parse(raw));
  } catch {
    return { ...EMPTY_FILTERS };
  }
}

export function saveFilters(f: StudentFilterState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(f));
  } catch {
    /* quota / private mode — filters simply won't persist */
  }
}

/** Only non-default values go into the URL, so shared links stay short. */
export function filtersToSearchParams(f: StudentFilterState): URLSearchParams {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(f)) {
    const dflt = DEFAULTS[key] ?? "";
    const v = String(value ?? "");
    if (v && v !== dflt) p.set(key, v);
  }
  return p;
}

export function filtersFromSearchParams(
  p: URLSearchParams | null,
): Partial<StudentFilterState> {
  if (!p) return {};
  const out: Record<string, string> = {};
  for (const key of Object.keys(EMPTY_FILTERS)) {
    const v = p.get(key);
    if (v !== null) out[key] = v;
  }
  return out as Partial<StudentFilterState>;
}

export function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is SavedView => !!v && typeof v === "object" && "id" in v)
      .map((v) => ({
        id: String(v.id),
        name: String(v.name || "Untitled view"),
        filters: coerce(v.filters),
      }));
  } catch {
    return [];
  }
}

export function saveSavedViews(views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      VIEWS_KEY,
      JSON.stringify(views.filter((v) => !v.builtIn)),
    );
  } catch {
    /* ignore */
  }
}
