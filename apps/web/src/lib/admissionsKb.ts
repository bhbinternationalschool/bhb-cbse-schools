/**
 * Admissions knowledge base — the approved facts a prospective parent may
 * be told: fees by class, admission process, documents, dates, transport,
 * scholarships, USPs, faculty, FAQs. Entered and approved by the office;
 * indexed into school_kb_chunks (audience "prospects") by "Sync to AI" and
 * the ONLY thing the admissions bot / chat widget may answer from.
 *
 * Rules:
 *  - Nothing here is generated. "Import from fee masters" copies the
 *    published NEW-admission fee lines verbatim; everything else is typed.
 *  - `publicSafe` off = kept for staff reference, never indexed.
 *  - `validTill` past = not indexed (dates and fees go stale).
 * Persisted through module_local_state ("admissions_kb").
 */

import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { assertModulePermission } from "@/lib/rbacGuard";
import type { MastersState } from "@/lib/masters";
import { feeSummaryForClass } from "@/lib/admissionDocumentLinks";

export type AdmissionsKbKind =
  | "fee"
  | "process"
  | "documents"
  | "dates"
  | "transport"
  | "scholarship"
  | "usp"
  | "faculty"
  | "faq"
  | "policy"
  | "other";

export const ADMISSIONS_KB_KINDS: { id: AdmissionsKbKind; label: string; hint: string }[] = [
  { id: "fee", label: "Fees", hint: "Fee by class — import from fee masters or type the published schedule" },
  { id: "process", label: "Admission process", hint: "Steps from enquiry to admission, who to meet, how long it takes" },
  { id: "documents", label: "Documents required", hint: "By class / for RTE — birth certificate, TC, Aadhaar, photos…" },
  { id: "dates", label: "Dates & deadlines", hint: "Form dates, test/interaction dates, last date, session start" },
  { id: "transport", label: "Transport", hint: "Routes, stops, timings, how to apply; fees if published" },
  { id: "scholarship", label: "Scholarships & concessions", hint: "Criteria and how to apply — only published schemes" },
  { id: "usp", label: "Why this school", hint: "Facts the office stands behind: ratio, labs, sports, results" },
  { id: "faculty", label: "Faculty", hint: "Public-safe profiles only — no personal contact details" },
  { id: "faq", label: "FAQ", hint: "A question parents ask and the approved answer" },
  { id: "policy", label: "Policies", hint: "Uniform, timings, medium, boards offered, age criteria" },
  { id: "other", label: "Other", hint: "" },
];

export type AdmissionsKbEntry = {
  id: string;
  kind: AdmissionsKbKind;
  /** Short heading — also the chunk title the model sees */
  title: string;
  /** The approved text */
  body: string;
  /** Free text like "Nursery–Class 5" or "Class 9, 11"; "" = all */
  classScope: string;
  /** YYYY-MM-DD; "" = no expiry */
  validTill: string;
  publicSafe: boolean;
  /** "manual" | "fee_masters" */
  source: string;
  updatedAt: string;
  updatedBy: string;
};

export type AdmissionsKbState = {
  version: 1;
  entries: AdmissionsKbEntry[];
  /** Set by the last successful "Sync to AI" (client-side stamp) */
  lastSyncedAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "bhb_admissions_kb_v1";
export const ADMISSIONS_KB_MAX_BODY = 2000;

function nid() {
  return `kb_${Math.random().toString(36).slice(2, 10)}`;
}
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");

export function normalizeKbKind(v: unknown): AdmissionsKbKind {
  const s = String(v ?? "");
  return ADMISSIONS_KB_KINDS.some((k) => k.id === s) ? (s as AdmissionsKbKind) : "other";
}

export function kbKindLabel(k: AdmissionsKbKind): string {
  return ADMISSIONS_KB_KINDS.find((x) => x.id === k)?.label ?? k;
}

export function emptyAdmissionsKb(): AdmissionsKbState {
  return { version: 1, entries: [], lastSyncedAt: "", updatedAt: "" };
}

export function normalizeAdmissionsKbEntry(raw: unknown): AdmissionsKbEntry | null {
  const x = (raw ?? {}) as Partial<AdmissionsKbEntry>;
  const title = str(x.title, 160);
  const body = str(x.body, ADMISSIONS_KB_MAX_BODY);
  if (!title && !body) return null;
  return {
    id: str(x.id, 40) || nid(),
    kind: normalizeKbKind(x.kind),
    title,
    body,
    classScope: str(x.classScope, 80),
    validTill: date(x.validTill),
    publicSafe: x.publicSafe !== false,
    source: str(x.source, 30) || "manual",
    updatedAt: str(x.updatedAt, 40),
    updatedBy: str(x.updatedBy, 120),
  };
}

export function normalizeAdmissionsKb(raw: unknown): AdmissionsKbState {
  const d = emptyAdmissionsKb();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<AdmissionsKbState>;
  const seen = new Set<string>();
  const entries: AdmissionsKbEntry[] = [];
  for (const e of Array.isArray(r.entries) ? r.entries : []) {
    const n = normalizeAdmissionsKbEntry(e);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    entries.push(n);
  }
  return {
    version: 1,
    entries,
    lastSyncedAt: str(r.lastSyncedAt, 40),
    updatedAt: str(r.updatedAt, 40),
  };
}

export function loadAdmissionsKb(): AdmissionsKbState {
  if (typeof window === "undefined") return emptyAdmissionsKb();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeAdmissionsKb(JSON.parse(raw)) : emptyAdmissionsKb();
  } catch {
    return emptyAdmissionsKb();
  }
}

export function saveAdmissionsKb(state: AdmissionsKbState): AdmissionsKbState {
  const next = normalizeAdmissionsKb({ ...state, updatedAt: new Date().toISOString() });
  if (!assertModulePermission("admissions", "edit", "saveAdmissionsKb")) return next;
  if (typeof window !== "undefined") {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
    void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("admissions_kb", next));
    window.dispatchEvent(new CustomEvent("bhb-admissions-kb"));
  }
  return next;
}

/** Hydrate path (module_local_state) — cache write only, no RBAC, no push. */
export function writeAdmissionsKbLocalRaw(state: AdmissionsKbState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(normalizeAdmissionsKb(state)));
  } catch {
    /* quota */
  }
  window.dispatchEvent(new CustomEvent("bhb-admissions-kb"));
}

export function admissionsKbIsEmpty(s: AdmissionsKbState): boolean {
  return s.entries.length === 0 && !s.updatedAt;
}

/* ─── Pure ops ─────────────────────────────────────────────────────── */

export function upsertKbEntry(
  state: AdmissionsKbState,
  input: Partial<AdmissionsKbEntry> & { by: string },
): { ok: true; state: AdmissionsKbState; entry: AdmissionsKbEntry } | { ok: false; error: string } {
  const n = normalizeAdmissionsKbEntry({ ...input, updatedAt: new Date().toISOString(), updatedBy: input.by });
  if (!n) return { ok: false, error: "Title or text is required" };
  if (!n.title) return { ok: false, error: "Give the entry a short title" };
  if (!n.body) return { ok: false, error: "The text is empty" };
  const exists = state.entries.some((e) => e.id === n.id);
  return {
    ok: true,
    entry: n,
    state: {
      ...state,
      entries: exists ? state.entries.map((e) => (e.id === n.id ? n : e)) : [...state.entries, n],
    },
  };
}

export function removeKbEntry(state: AdmissionsKbState, id: string): AdmissionsKbState {
  return { ...state, entries: state.entries.filter((e) => e.id !== id) };
}

/** An entry the bot may use today: approved for the public and not expired. */
export function kbEntryIsLive(e: AdmissionsKbEntry, today = new Date().toISOString().slice(0, 10)): boolean {
  return e.publicSafe && !!e.body && (!e.validTill || e.validTill >= today);
}

/** What "Sync to AI" indexes — one chunk per live entry. */
export function admissionsKbChunks(
  state: AdmissionsKbState,
  today?: string,
): { id: string; title: string; content: string }[] {
  return state.entries.filter((e) => kbEntryIsLive(e, today)).map((e) => ({
    id: e.id,
    title: `${kbKindLabel(e.kind)}: ${e.title}`,
    content: [
      e.title,
      e.classScope ? `Applies to: ${e.classScope}` : "",
      e.validTill ? `Valid till: ${e.validTill}` : "",
    ]
      .filter(Boolean)
      .concat("", e.body)
      .join("\n")
      .trim(),
  }));
}

/**
 * Fee entries copied verbatim from the published NEW-admission fee lines
 * of the session — one entry per class that has a structure. Replaces the
 * earlier fee_masters entries (never manual ones). Returns [] classes when
 * no structure is published, so nothing is invented.
 */
export function kbEntriesFromFeeMasters(
  masters: MastersState,
  academicYearCode: string,
  by: string,
): AdmissionsKbEntry[] {
  const out: AdmissionsKbEntry[] = [];
  const classes = [...(masters.classes ?? [])]
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const c of classes) {
    const s = feeSummaryForClass(masters, academicYearCode, c.id);
    if (s.lines.length === 0) continue;
    const label = c.name;
    const body = [
      `Fees for new admission to ${label}, session ${academicYearCode}${s.groupName ? ` (${s.groupName})` : ""}:`,
      ...s.lines.map((l) => `- ${l.head}: ${l.amount}${l.installment ? ` (${l.installment})` : ""}`),
      s.total ? `Total: ${s.total}` : "",
      "Amounts as published by the school office; the registration desk confirms the exact payable amount.",
    ]
      .filter(Boolean)
      .join("\n");
    out.push({
      id: `kb_fee_${academicYearCode}_${c.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40),
      kind: "fee",
      title: `Fees — ${label} (${academicYearCode})`,
      body: body.slice(0, ADMISSIONS_KB_MAX_BODY),
      classScope: label,
      validTill: "",
      publicSafe: true,
      source: "fee_masters",
      updatedAt: new Date().toISOString(),
      updatedBy: by,
    });
  }
  return out;
}

export function mergeFeeEntries(state: AdmissionsKbState, fees: AdmissionsKbEntry[]): AdmissionsKbState {
  const keep = state.entries.filter((e) => e.source !== "fee_masters");
  return { ...state, entries: [...keep, ...fees] };
}
