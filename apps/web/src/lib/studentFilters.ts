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

import type { SisStudent } from "@/lib/sis";

export type MissingField =
  | ""
  | "pen"
  | "apaar"
  | "aadhaar"
  | "dob"
  | "photo"
  | "household"
  | "guardianMobile"
  | "section";

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
  pen: "PEN missing",
  apaar: "APAAR ID missing",
  aadhaar: "Aadhaar missing",
  dob: "Date of birth missing",
  photo: "Photo missing",
  household: "Not linked to a household",
  guardianMobile: "No guardian mobile",
  section: "No section assigned",
};

const blank = (v: unknown) => !String(v ?? "").trim();

/** True when the student is missing the requested field. */
export function isMissing(s: SisStudent, field: MissingField): boolean {
  switch (field) {
    case "pen":
      return blank(s.pen);
    case "apaar":
      return blank(s.apaarId);
    case "aadhaar":
      return blank(s.aadhaarLast4) && blank(s.aadhaarNumber);
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
