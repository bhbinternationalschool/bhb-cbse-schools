/* ratchet-allow: raw_table — matches <table> while PARSING imported HTML; this module renders nothing */
/**
 * RTE / EWS / scholarship seats (§21c).
 * Demo store: localStorage `bhb_rte_ews_v1`.
 * Module visibility gated by `moduleRegistry` (`rte_ews`, default OFF).
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import {
  DEFAULT_AY,
  loadMasters,
  normalizeConcessionGrant,
  normalizeConcessionRule,
  resolveFeeGroupId,
  saveMasters,
  suggestFeeStudentType,
  type MastersState,
} from "@/lib/masters";
import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import {
  loadSis,
  normalizeHousehold,
  normalizeStudent,
  newSisId,
  saveSis,
  suggestAdmissionNo,
  suggestSrn,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import { ensureRteEwsTagIds } from "@/lib/studentTags";
import { TENANT } from "@/lib/types";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

const STORAGE_KEY = "bhb_rte_ews_v1";

export type QuotaApplicationStatus =
  | "draft"
  /** Legacy — treat as govt_assigned */
  | "submitted"
  /** Imported from govt list assigned to this school (NOT confirmed admission) */
  | "govt_assigned"
  | "waitlist"
  /** Legacy alias for admitted */
  | "allotted"
  /** School took admission (confirmed) */
  | "admitted"
  | "rejected"
  | "enrolled"
  | "withdrawn";

/** Registration fee decision at the moment school takes admission */
export type RteRegFeeChoice = "pending" | "collect" | "waive" | "none";

export type QuotaType = "RTE" | "EWS" | "SCHOLARSHIP";

export type QuotaSeat = {
  id: string;
  classId: string;
  academicYearCode: string;
  type: QuotaType;
  total: number;
  note: string;
};

export type QuotaApplication = {
  id: string;
  academicYearCode: string;
  classId: string;
  type: QuotaType;
  childName: string;
  parentName: string;
  mobile: string;
  category: string;
  annualIncome: string;
  /** Govt RTE / portal Registration ID (official allotted list) */
  govtApplicationNo: string;
  studentId?: string;
  admissionLeadId?: string;
  docsIncome: boolean;
  docsCategory: boolean;
  docsResidence: boolean;
  lotteryNo: string;
  meritRank: number;
  /** From govt export: MALE / FEMALE */
  gender: string;
  /** ISO date from govt DOB column when available */
  dateOfBirth: string;
  /** Portal S.No. from AllottedSeat export */
  portalSerialNo: string;
  /** Block/Town from portal */
  blockTown: string;
  /** Grampanchayat/Ward from portal */
  gramPanchayatWard: string;
  /**
   * Portal status text (e.g. "Admission Pending by School").
   * Not the same as school confirmed admission in this ERP.
   */
  portalAdmissionStatus: string;
  status: QuotaApplicationStatus;
  /** Set when school takes admission */
  registrationFeeChoice: RteRegFeeChoice;
  registrationFeeAmountPaise: number;
  registrationFeeNote: string;
  registrationFeePaid: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
  decidedBy?: string;
  decidedAt?: string;
};

export type RteSettings = {
  mandatedPct: number;
  autoApplyFeeWaiver: boolean;
  note: string;
};

export type RteState = {
  version: 1;
  seats: QuotaSeat[];
  applications: QuotaApplication[];
  settings: RteSettings;
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
function nowIso() {
  return new Date().toISOString();
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function emptyRteState(): RteState {
  return {
    version: 1,
    seats: [],
    applications: [],
    settings: {
      mandatedPct: 25,
      autoApplyFeeWaiver: true,
      note: "",
    },
  };
}

function normalizeSeat(s: Partial<QuotaSeat>): QuotaSeat {
  return {
    id: s.id ?? nid("qseat"),
    classId: s.classId ?? "",
    academicYearCode: s.academicYearCode ?? DEFAULT_AY,
    type: (s.type as QuotaType) || "RTE",
    total: Math.max(0, Number(s.total) || 0),
    note: s.note ?? "",
  };
}

function normalizeApp(a: Partial<QuotaApplication>): QuotaApplication {
  let status = (a.status as QuotaApplicationStatus) || "govt_assigned";
  if (status === "submitted") status = "govt_assigned";
  if (status === "allotted") status = "admitted";
  return {
    id: a.id ?? nid("qapp"),
    academicYearCode: a.academicYearCode ?? DEFAULT_AY,
    classId: a.classId ?? "",
    type: (a.type as QuotaType) || "RTE",
    childName: a.childName ?? "",
    parentName: a.parentName ?? "",
    mobile: a.mobile ?? "",
    category: a.category ?? "",
    annualIncome: a.annualIncome ?? "",
    govtApplicationNo: (a.govtApplicationNo ?? "").trim(),
    studentId: a.studentId || undefined,
    admissionLeadId: a.admissionLeadId || undefined,
    docsIncome: !!a.docsIncome,
    docsCategory: !!a.docsCategory,
    docsResidence: !!a.docsResidence,
    lotteryNo: a.lotteryNo ?? "",
    meritRank: Math.max(0, Number(a.meritRank) || 0),
    gender: a.gender ?? "",
    dateOfBirth: a.dateOfBirth ?? "",
    portalSerialNo: a.portalSerialNo ?? "",
    blockTown: a.blockTown ?? "",
    gramPanchayatWard: a.gramPanchayatWard ?? "",
    portalAdmissionStatus: a.portalAdmissionStatus ?? "",
    status,
    registrationFeeChoice:
      (a.registrationFeeChoice as RteRegFeeChoice) || "pending",
    registrationFeeAmountPaise: Math.max(
      0,
      Math.round(Number(a.registrationFeeAmountPaise) || 0),
    ),
    registrationFeeNote: a.registrationFeeNote ?? "",
    registrationFeePaid: !!a.registrationFeePaid,
    note: a.note ?? "",
    createdAt: a.createdAt ?? nowIso(),
    updatedAt: a.updatedAt ?? nowIso(),
    decidedBy: a.decidedBy,
    decidedAt: a.decidedAt,
  };
}

function normalizeState(raw: Partial<RteState> | null): RteState {
  const base = emptyRteState();
  if (!raw) return base;
  return {
    version: 1,
    seats: Array.isArray(raw.seats) ? raw.seats.map(normalizeSeat) : [],
    applications: Array.isArray(raw.applications)
      ? raw.applications.map(normalizeApp)
      : [],
    settings: {
      mandatedPct:
        typeof raw.settings?.mandatedPct === "number"
          ? raw.settings.mandatedPct
          : base.settings.mandatedPct,
      autoApplyFeeWaiver:
        typeof raw.settings?.autoApplyFeeWaiver === "boolean"
          ? raw.settings.autoApplyFeeWaiver
          : base.settings.autoApplyFeeWaiver,
      note: raw.settings?.note ?? "",
    },
  };
}

export function loadRte(): RteState {
  if (typeof window === "undefined") return emptyRteState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyRteState();
    return normalizeState(JSON.parse(raw) as Partial<RteState>);
  } catch {
    return emptyRteState();
  }
}

export function saveRte(state: RteState): void {
  if (!assertModulePermission("rte", "edit", "saveRte")) return;

  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/rtePersistence").then(({ scheduleRteSync }) => {
    scheduleRteSync(state);
  });

}

export function writeRteLocalRaw(state: RteState) {
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
}

export function rteStateIsEmpty(state: RteState): boolean {
  return (state.seats?.length ?? 0) === 0 && (state.applications?.length ?? 0) === 0;
}


export function saveRteSettings(patch: Partial<RteSettings>): RteState {
  const state = loadRte();
  const next = {
    ...state,
    settings: { ...state.settings, ...patch },
  };
  saveRte(next);
  return next;
}

/** Count active SIS students who count toward quota fill (RTE type or EWS category). */
export function countEnrolledQuota(
  classId: string,
  ay: string,
  type: QuotaType,
  sis?: SisState,
): number {
  const state = sis ?? loadSis();
  return state.students.filter((s) => {
    if (s.status !== "active") return false;
    if (s.classId !== classId) return false;
    if (type === "RTE") return s.studentType === "RTE";
    if (type === "EWS") return s.category === "EWS" || s.studentType === "RTE";
    return s.studentType === "RTE" || /scholarship/i.test(s.notes || "");
  }).length;
}

export function allottedCount(
  state: RteState,
  classId: string,
  ay: string,
  type: QuotaType,
): number {
  return state.applications.filter(
    (a) =>
      a.classId === classId &&
      a.academicYearCode === ay &&
      a.type === type &&
      (a.status === "admitted" ||
        a.status === "allotted" ||
        a.status === "enrolled"),
  ).length;
}

export type QuotaSeatRow = QuotaSeat & {
  enrolled: number;
  allotted: number;
  filled: number;
  remaining: number;
  className: string;
};

export function listQuotaSeatRows(
  state?: RteState,
  ay?: string,
  masters?: MastersState,
  sis?: SisState,
): QuotaSeatRow[] {
  const rte = state ?? loadRte();
  const year = ay || DEFAULT_AY;
  const m = masters ?? loadMasters();
  const s = sis ?? loadSis();
  return rte.seats
    .filter((seat) => seat.academicYearCode === year)
    .map((seat) => {
      const enrolled = countEnrolledQuota(seat.classId, year, seat.type, s);
      const allotted = allottedCount(rte, seat.classId, year, seat.type);
      const filled = Math.max(enrolled, allotted);
      const cls = m.classes.find((c) => c.id === seat.classId);
      return {
        ...seat,
        enrolled,
        allotted,
        filled,
        remaining: Math.max(0, seat.total - filled),
        className: cls?.name || seat.classId || "—",
      };
    })
    .sort((a, b) => a.className.localeCompare(b.className) || a.type.localeCompare(b.type));
}

export function suggestSeatTotal(
  classId: string,
  mandatedPct: number,
  sis?: SisState,
): number {
  const state = sis ?? loadSis();
  const strength = state.students.filter(
    (s) => s.status === "active" && s.classId === classId,
  ).length;
  if (strength <= 0) return 0;
  return Math.max(1, Math.ceil((strength * mandatedPct) / 100));
}

export function upsertQuotaSeat(
  input: Partial<QuotaSeat> & {
    classId: string;
    academicYearCode: string;
    type: QuotaType;
  },
): { ok: true; seat: QuotaSeat } | { ok: false; error: string } {
  if (!input.classId) return { ok: false, error: "Class required" };
  const state = loadRte();
  const total = Math.max(0, Number(input.total) || 0);
  if (input.id) {
    const i = state.seats.findIndex((x) => x.id === input.id);
    if (i < 0) return { ok: false, error: "Seat row not found" };
    const seat = normalizeSeat({ ...state.seats[i], ...input, total });
    const seats = [...state.seats];
    seats[i] = seat;
    saveRte({ ...state, seats });
    return { ok: true, seat };
  }
  const dup = state.seats.find(
    (x) =>
      x.classId === input.classId &&
      x.academicYearCode === input.academicYearCode &&
      x.type === input.type,
  );
  if (dup) {
    return upsertQuotaSeat({ ...input, id: dup.id, total });
  }
  const seat = normalizeSeat({
    classId: input.classId,
    academicYearCode: input.academicYearCode,
    type: input.type,
    total,
    note: input.note,
  });
  saveRte({ ...state, seats: [seat, ...state.seats] });
  return { ok: true, seat };
}

export function deleteQuotaSeat(
  id: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadRte();
  if (!state.seats.some((s) => s.id === id)) {
    return { ok: false, error: "Seat row not found" };
  }
  saveRte({ ...state, seats: state.seats.filter((s) => s.id !== id) });
  return { ok: true };
}

/** Seed seats for active classes using mandated % of current strength. */
export function seedQuotaSeatsFromStrength(input: {
  academicYearCode: string;
  type?: QuotaType;
}): RteState {
  const state = loadRte();
  const masters = loadMasters();
  const sis = loadSis();
  const type = input.type || "RTE";
  const pct = state.settings.mandatedPct || 25;
  let seats = [...state.seats];
  for (const cls of masters.classes.filter((c) => c.isActive !== false)) {
    const total = suggestSeatTotal(cls.id, pct, sis);
    if (total <= 0) continue;
    const existing = seats.find(
      (s) =>
        s.classId === cls.id &&
        s.academicYearCode === input.academicYearCode &&
        s.type === type,
    );
    if (existing) {
      seats = seats.map((s) =>
        s.id === existing.id ? { ...s, total: Math.max(s.total, total) } : s,
      );
    } else {
      seats.unshift(
        normalizeSeat({
          classId: cls.id,
          academicYearCode: input.academicYearCode,
          type,
          total,
          note: `Auto ${pct}% of strength`,
        }),
      );
    }
  }
  const next = { ...state, seats };
  saveRte(next);
  return next;
}

export function upsertQuotaApplication(
  input: Partial<QuotaApplication> & {
    childName: string;
    classId: string;
    academicYearCode: string;
    type: QuotaType;
  },
): { ok: true; application: QuotaApplication } | { ok: false; error: string } {
  if (!input.childName.trim()) return { ok: false, error: "Child name required" };
  if (!input.classId) return { ok: false, error: "Class required" };
  const state = loadRte();
  const now = nowIso();
  if (input.id) {
    const i = state.applications.findIndex((a) => a.id === input.id);
    if (i < 0) return { ok: false, error: "Application not found" };
    const application = normalizeApp({
      ...state.applications[i],
      ...input,
      childName: input.childName.trim(),
      updatedAt: now,
    });
    const applications = [...state.applications];
    applications[i] = application;
    saveRte({ ...state, applications });
    return { ok: true, application };
  }
  const dupIdx = findDuplicateGovtAppIndex(
    state.applications,
    {
      govtApplicationNo: input.govtApplicationNo || "",
      childName: input.childName,
      dateOfBirth: input.dateOfBirth || "",
      parentName: input.parentName,
    },
    input.academicYearCode,
    input.classId,
  );
  if (dupIdx >= 0) {
    const dup = state.applications[dupIdx];
    return {
      ok: false,
      error: `Duplicate student — already on list (Reg. ID ${dup.govtApplicationNo || "—"}${dup.childName ? `, ${dup.childName}` : ""})`,
    };
  }
  const application = normalizeApp({
    ...input,
    childName: input.childName.trim(),
    status: input.status || "govt_assigned",
    createdAt: now,
    updatedAt: now,
  });
  saveRte({ ...state, applications: [application, ...state.applications] });
  return { ok: true, application };
}

export function setApplicationStatus(input: {
  id: string;
  status: QuotaApplicationStatus;
  by: string;
  lotteryNo?: string;
}): { ok: true; application: QuotaApplication } | { ok: false; error: string } {
  const state = loadRte();
  const i = state.applications.findIndex((a) => a.id === input.id);
  if (i < 0) return { ok: false, error: "Application not found" };
  const cur = state.applications[i];
  const nextStatus: QuotaApplicationStatus =
    input.status === "allotted"
      ? "admitted"
      : input.status === "submitted"
        ? "govt_assigned"
        : input.status;
  if (nextStatus === "admitted" || nextStatus === "enrolled") {
    const rows = listQuotaSeatRows(state, cur.academicYearCode);
    const seat = rows.find(
      (r) => r.classId === cur.classId && r.type === cur.type,
    );
    if (
      seat &&
      seat.remaining <= 0 &&
      cur.status !== "admitted" &&
      cur.status !== "allotted" &&
      cur.status !== "enrolled"
    ) {
      return { ok: false, error: "No remaining seats for this class / type" };
    }
  }
  const application = normalizeApp({
    ...cur,
    status: nextStatus,
    lotteryNo: input.lotteryNo ?? cur.lotteryNo,
    decidedBy: input.by,
    decidedAt: nowIso(),
    updatedAt: nowIso(),
  });
  const applications = [...state.applications];
  applications[i] = application;
  saveRte({ ...state, applications });
  return { ok: true, application };
}

export function assignLotteryNumbers(
  academicYearCode: string,
  type: QuotaType = "RTE",
): { ok: true; count: number } | { ok: false; error: string } {
  const state = loadRte();
  const pool = state.applications.filter(
    (a) =>
      a.academicYearCode === academicYearCode &&
      a.type === type &&
      (a.status === "govt_assigned" ||
        a.status === "submitted" ||
        a.status === "waitlist"),
  );
  if (!pool.length) return { ok: false, error: "No govt-assigned applications" };
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const byId = new Map(shuffled.map((a, idx) => [a.id, String(idx + 1)]));
  const applications = state.applications.map((a) => {
    const no = byId.get(a.id);
    if (!no) return a;
    return normalizeApp({
      ...a,
      lotteryNo: no,
      meritRank: Number(no),
      status:
        a.status === "govt_assigned" || a.status === "submitted"
          ? "waitlist"
          : a.status,
      updatedAt: nowIso(),
    });
  });
  saveRte({ ...state, applications });
  return { ok: true, count: shuffled.length };
}

export function deleteQuotaApplication(
  id: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadRte();
  if (!state.applications.some((a) => a.id === id)) {
    return { ok: false, error: "Application not found" };
  }
  saveRte({
    ...state,
    applications: state.applications.filter((a) => a.id !== id),
  });
  return { ok: true };
}

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    // Registration / lottery IDs often come as 96227.0
    if (Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-6) {
      return String(Math.round(v));
    }
    return String(v);
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  return String(v).replace(/\u00a0/g, " ").trim();
}

function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Decode common HTML entities from portal exports. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

/**
 * UP RTE sometimes exports “AllottedSeat.xls” as HTML (ASP.NET GridView),
 * not a real BIFF workbook. Prefer table text so DOB stays DD/MM/YYYY.
 */
export function htmlTableToMatrix(html: string): string[][] {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  let best: string[][] = [];
  for (const table of tables) {
    const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const matrix: string[][] = [];
    for (const tr of trs) {
      const cells = tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || [];
      if (!cells.length) continue;
      const row = cells.map((cell) => {
        const inner = cell.replace(/^<t[hd][^>]*>/i, "").replace(/<\/t[hd]>$/i, "");
        const text = decodeHtmlEntities(
          inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        );
        return text;
      });
      if (row.some((c) => c)) matrix.push(row);
    }
    if (matrix.length > best.length) best = matrix;
  }
  return best;
}

/** True when portal saved HTML under a .xls extension. */
export function bufferLooksLikeHtml(buf: ArrayBuffer): boolean {
  const head = new TextDecoder()
    .decode(buf.slice(0, 256))
    .trimStart()
    .toLowerCase();
  return (
    head.startsWith("<") ||
    head.includes("<!doctype") ||
    head.includes("<html") ||
    head.includes("<style") ||
    head.includes("<table")
  );
}

/**
 * Build a row matrix from a govt AllottedSeat download (.xls real Excel,
 * HTML-as-xls, or .xlsx/.csv). HTML path preferred when content is HTML so
 * DD/MM/YYYY DOBs are not mangled by spreadsheet parsers.
 */
export async function matrixFromGovtAllottedSeatFile(
  buf: ArrayBuffer,
): Promise<{ matrix: unknown[][]; source: "html" | "xlsx" | "csv-text" }> {
  if (bufferLooksLikeHtml(buf)) {
    const text = new TextDecoder().decode(buf);
    const matrix = htmlTableToMatrix(text);
    if (matrix.length >= 2 && findUpRteAllottedHeaderIndex(matrix)) {
      return { matrix, source: "html" };
    }
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheet =
    wb.Sheets[wb.SheetNames[0] || ""] || Object.values(wb.Sheets)[0];
  if (!sheet) return { matrix: [], source: "xlsx" };
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
  return { matrix, source: "xlsx" };
}

/** Excel serial date (Windows 1900 system) → ISO yyyy-mm-dd */
export function excelSerialToIsoDate(serial: number): string {
  if (!Number.isFinite(serial) || serial < 1) return "";
  // Excel epoch 1899-12-30 (accounts for Excel's leap-year bug offset)
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(utc).toISOString().slice(0, 10);
}

function parseDobCell(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Local calendar date (portal schools are IST) — avoid UTC day-shift
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return excelSerialToIsoDate(v);
  }
  const s = cellStr(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // ISO with time from SheetJS cellDates stringify
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (iso) {
    // If Zulu evening, treat as next calendar day in IST (+5:30)
    if (/T18:3\d:/.test(s) && /Z$/i.test(s)) {
      const base = new Date(`${iso[1]}T00:00:00Z`);
      base.setUTCDate(base.getUTCDate() + 1);
      return base.toISOString().slice(0, 10);
    }
    return iso[1];
  }
  // Indian portal DOB: DD/MM/YYYY (or D/M/YYYY)
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 20000 && asNum < 80000) {
    return excelSerialToIsoDate(asNum);
  }
  return "";
}

export function resolveRteClassId(
  classHint: string,
  masters: MastersState,
  defaultClassId: string,
): string {
  const raw = classHint.trim();
  if (!raw) return defaultClassId;
  const h = raw.toLowerCase().replace(/\s+/g, "");
  const aliases: Record<string, string[]> = {
    nursery: ["nursery", "nur", "prekg", "pre-kg", "prek"],
    lkg: ["lkg", "kg1", "kgi", "kg-i", "juniorkg"],
    ukg: ["ukg", "kg2", "kgii", "kg-ii", "seniorkg"],
  };
  for (const c of masters.classes) {
    const cn = c.name.toLowerCase().replace(/\s+/g, "");
    if (c.id === raw || cn === h) return c.id;
    for (const [canon, keys] of Object.entries(aliases)) {
      if (keys.includes(h) && (cn === canon || keys.includes(cn))) return c.id;
    }
  }
  // fuzzy contains
  const found = masters.classes.find((c) =>
    c.name.toLowerCase().includes(h) || h.includes(c.name.toLowerCase()),
  );
  return found?.id || defaultClassId;
}

type ParsedGovtRow = {
  portalSerialNo: string;
  govtApplicationNo: string;
  childName: string;
  parentName: string;
  mobile: string;
  classHint: string;
  category: string;
  lotteryNo: string;
  gender: string;
  dateOfBirth: string;
  blockTown: string;
  gramPanchayatWard: string;
  portalAdmissionStatus: string;
};

/**
 * Detect UP RTE portal "AllottedSeat.xls" header:
 * S.No. | Lottery No | Registration ID | Student Name | Father Name |
 * Class | Gender | DOB | Block/Town | Grampanchayat/Ward | Admission Status | …
 */
export function findUpRteAllottedHeaderIndex(
  matrix: unknown[][],
): { headerRow: number; col: Record<string, number> } | null {
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const norms = row.map((c) => normHeader(cellStr(c)));
    const idx = (predicates: ((n: string) => boolean)[]) => {
      for (let i = 0; i < norms.length; i++) {
        if (predicates.every((p) => p(norms[i]))) return i;
      }
      return -1;
    };
    const regId = idx([
      (n) => n.includes("registration") && n.includes("id"),
    ]);
    const student = idx([(n) => n === "student name" || n === "child name"]);
    if (regId < 0 || student < 0) continue;
    return {
      headerRow: r,
      col: {
        sNo: idx([(n) => n === "s no" || n === "sno" || n.startsWith("s no")]),
        lottery: idx([(n) => n.includes("lottery")]),
        registrationId: regId,
        studentName: student,
        fatherName: idx([
          (n) => n.includes("father") || n === "parent name",
        ]),
        className: idx([(n) => n === "class" || n.startsWith("class ")]),
        gender: idx([(n) => n === "gender" || n === "sex"]),
        dob: idx([(n) => n === "dob" || n.includes("date of birth")]),
        block: idx([(n) => n.includes("block") || n.includes("town")]),
        ward: idx([
          (n) => n.includes("grampanchayat") || n.includes("ward"),
        ]),
        admissionStatus: idx([
          (n) => n.includes("admission status") || n === "status",
        ]),
      },
    };
  }
  return null;
}

function parseMatrixToGovtRows(matrix: unknown[][]): ParsedGovtRow[] {
  const detected = findUpRteAllottedHeaderIndex(matrix);
  const out: ParsedGovtRow[] = [];

  if (detected) {
    const { headerRow, col } = detected;
    for (let r = headerRow + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const get = (key: string) => {
        const i = col[key];
        return i != null && i >= 0 ? row[i] : "";
      };
      const regRaw = get("registrationId");
      const govtApplicationNo = cellStr(regRaw).replace(/\s+/g, "");
      const childName = cellStr(get("studentName"));
      if (!govtApplicationNo || !childName) continue;
      // skip footer / junk
      if (/designed|disclaimer|udi?se/i.test(childName)) continue;
      if (!/^\d+$/.test(govtApplicationNo) && govtApplicationNo.length < 3) {
        continue;
      }
      const block = cellStr(get("block"));
      const ward = cellStr(get("ward"));
      const portalAdmissionStatus = cellStr(get("admissionStatus"));
      out.push({
        portalSerialNo: cellStr(get("sNo")),
        govtApplicationNo,
        childName,
        parentName: cellStr(get("fatherName")),
        mobile: "",
        classHint: cellStr(get("className")),
        category: "",
        lotteryNo: cellStr(get("lottery")),
        gender: cellStr(get("gender")).toUpperCase(),
        dateOfBirth: parseDobCell(get("dob")),
        blockTown: block,
        gramPanchayatWard: ward,
        portalAdmissionStatus,
      });
    }
    return out;
  }

  // Fallback: simple CSV columns
  // govtAppNo, childName, parentName?, mobile?, class?, category?
  for (const row of matrix) {
    const parts = (row || []).map((c) => cellStr(c));
    if (!parts.length) continue;
    const joined = parts.join(" ").toLowerCase();
    if (
      joined.includes("registration id") ||
      joined.includes("student name") ||
      joined.startsWith("govt") ||
      joined.startsWith("app")
    ) {
      continue;
    }
    const govtApplicationNo = (parts[0] || "").replace(/\s+/g, "");
    const childName = parts[1] || "";
    if (!govtApplicationNo || !childName) continue;
    out.push({
      portalSerialNo: "",
      govtApplicationNo,
      childName,
      parentName: parts[2] || "",
      mobile: (parts[3] || "").replace(/\D/g, "").slice(-10),
      classHint: parts[4] || "",
      category: parts[5] || "",
      lotteryNo: "",
      gender: "",
      dateOfBirth: "",
      blockTown: "",
      gramPanchayatWard: "",
      portalAdmissionStatus: "",
    });
  }
  return out;
}

export function textToMatrix(raw: string): string[][] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => line.split(/[\t,|]/).map((p) => p.trim()));
}

/**
 * Import govt portal allotted-seat matrix (AllottedSeat.xls / CSV paste).
 * Status becomes `govt_assigned` only — NOT school admission.
 * Re-import is safe: duplicates by Registration ID (same AY) are skipped or
 * only portal columns refreshed if still not school-admitted.
 */
export function importGovtAllottedSeatRows(input: {
  matrix: unknown[][];
  academicYearCode: string;
  defaultClassId: string;
  type?: QuotaType;
}): {
  ok: true;
  imported: number;
  skipped: number;
  duplicates: number;
  updated: number;
  errors: string[];
  format: string;
} {
  const rows = parseMatrixToGovtRows(input.matrix);
  if (!rows.length) {
    return {
      ok: true,
      imported: 0,
      skipped: 0,
      duplicates: 0,
      updated: 0,
      errors: [
        "No student rows found. Upload UP RTE AllottedSeat.xls (headers: Registration ID, Student Name, …).",
      ],
      format: "unknown",
    };
  }
  const format = (() => {
    const h = findUpRteAllottedHeaderIndex(input.matrix);
    if (!h) return "unknown";
    const hasLottery = (h.col.lottery ?? -1) >= 0;
    const hasPortalStatus = (h.col.admissionStatus ?? -1) >= 0;
    if (hasLottery || hasPortalStatus) return "up_rte_allotted_seat_module";
    return "up_rte_allotted_seat_list";
  })();
  const masters = loadMasters();
  const state = loadRte();
  const type = input.type || "RTE";
  let imported = 0;
  let skipped = 0;
  let duplicates = 0;
  let updated = 0;
  const errors: string[] = [];
  const applications = [...state.applications];
  const seenInFile = new Set<string>();

  for (const row of rows) {
    const regKey = normalizeGovtRegId(row.govtApplicationNo);
    if (!regKey || !row.childName.trim()) {
      skipped += 1;
      continue;
    }

    // Duplicate within the same upload file
    if (seenInFile.has(regKey)) {
      duplicates += 1;
      skipped += 1;
      continue;
    }
    seenInFile.add(regKey);

    const classId = resolveRteClassId(
      row.classHint,
      masters,
      input.defaultClassId,
    );
    const existingIdx = findDuplicateGovtAppIndex(
      applications,
      row,
      input.academicYearCode,
      classId,
    );

    if (existingIdx >= 0) {
      const cur = applications[existingIdx];
      duplicates += 1;
      skipped += 1;
      // School already confirmed / in SIS — never create another record
      if (
        cur.status === "admitted" ||
        cur.status === "allotted" ||
        cur.status === "enrolled" ||
        cur.studentId
      ) {
        continue;
      }
      // Still only govt-assigned: refresh portal columns from latest download
      applications[existingIdx] = normalizeApp({
        ...cur,
        childName: row.childName || cur.childName,
        parentName: row.parentName || cur.parentName,
        classId: classId || cur.classId,
        lotteryNo: row.lotteryNo || cur.lotteryNo,
        gender: row.gender || cur.gender,
        dateOfBirth: row.dateOfBirth || cur.dateOfBirth,
        portalSerialNo: row.portalSerialNo || cur.portalSerialNo,
        blockTown: row.blockTown || cur.blockTown,
        gramPanchayatWard: row.gramPanchayatWard || cur.gramPanchayatWard,
        portalAdmissionStatus:
          row.portalAdmissionStatus || cur.portalAdmissionStatus,
        govtApplicationNo: row.govtApplicationNo || cur.govtApplicationNo,
        updatedAt: nowIso(),
        note: [
          cur.note,
          "Re-import: portal fields refreshed (still not school-admitted)",
        ]
          .filter(Boolean)
          .join(" · "),
      });
      updated += 1;
      continue;
    }

    applications.unshift(
      normalizeApp({
        academicYearCode: input.academicYearCode,
        classId,
        type,
        childName: row.childName,
        parentName: row.parentName,
        mobile: row.mobile,
        category: row.category || (type === "EWS" ? "EWS" : ""),
        govtApplicationNo: row.govtApplicationNo,
        lotteryNo: row.lotteryNo,
        gender: row.gender,
        dateOfBirth: row.dateOfBirth,
        portalSerialNo: row.portalSerialNo,
        blockTown: row.blockTown,
        gramPanchayatWard: row.gramPanchayatWard,
        portalAdmissionStatus: row.portalAdmissionStatus,
        status: "govt_assigned",
        registrationFeeChoice: "pending",
        docsIncome: true,
        docsCategory: true,
        note: [
          "Imported from govt AllottedSeat list — not school-admitted yet",
          row.portalAdmissionStatus
            ? `Portal: ${row.portalAdmissionStatus}`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      }),
    );
    imported += 1;
  }
  saveRte({ ...state, applications });
  return {
    ok: true,
    imported,
    skipped,
    duplicates,
    updated,
    errors: errors.slice(0, 8),
    format,
  };
}

/** Normalize portal Registration ID for duplicate checks (96227 / 96227.0). */
export function normalizeGovtRegId(id: string): string {
  return String(id || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\.0+$/, "")
    .toLowerCase();
}

function normPersonName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\u0900-\u097f ]/gi, "");
}

/**
 * Find existing row for same AY: Registration ID first, then
 * Student Name + DOB + class (covers rare missing/changed IDs).
 */
export function findDuplicateGovtAppIndex(
  applications: QuotaApplication[],
  row: {
    govtApplicationNo: string;
    childName: string;
    dateOfBirth: string;
    parentName?: string;
  },
  academicYearCode: string,
  classId?: string,
): number {
  const regKey = normalizeGovtRegId(row.govtApplicationNo);
  if (regKey) {
    const byReg = applications.findIndex(
      (a) =>
        a.academicYearCode === academicYearCode &&
        normalizeGovtRegId(a.govtApplicationNo) === regKey,
    );
    if (byReg >= 0) return byReg;
  }

  const nameKey = normPersonName(row.childName);
  const dob = (row.dateOfBirth || "").slice(0, 10);
  if (!nameKey) return -1;

  return applications.findIndex((a) => {
    if (a.academicYearCode !== academicYearCode) return false;
    if (normPersonName(a.childName) !== nameKey) return false;
    if (dob && a.dateOfBirth && a.dateOfBirth.slice(0, 10) === dob) {
      if (classId && a.classId && a.classId !== classId) return false;
      return true;
    }
    // Name + father when DOB missing on one side
    if (
      !dob &&
      row.parentName &&
      normPersonName(a.parentName) === normPersonName(row.parentName) &&
      (!classId || !a.classId || a.classId === classId)
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Bulk-import from pasted text (CSV / TSV) or any delimiter rows.
 * Prefer {@link importGovtAllottedSeatRows} / .xls upload for portal files.
 */
export function importGovtRteList(input: {
  raw: string;
  academicYearCode: string;
  defaultClassId: string;
  type?: QuotaType;
}): {
  ok: true;
  imported: number;
  skipped: number;
  duplicates: number;
  updated: number;
  errors: string[];
} {
  const r = importGovtAllottedSeatRows({
    matrix: textToMatrix(input.raw),
    academicYearCode: input.academicYearCode,
    defaultClassId: input.defaultClassId,
    type: input.type,
  });
  return {
    ok: true,
    imported: r.imported,
    skipped: r.skipped,
    duplicates: r.duplicates,
    updated: r.updated,
    errors: r.errors,
  };
}

/**
 * School takes admission (confirms). Choose whether to collect registration fee.
 * Govt import alone never admits.
 */
export function takeSchoolAdmission(input: {
  applicationId: string;
  by: string;
  registrationFee: "collect" | "waive" | "none";
  amountPaise?: number;
  feeNote?: string;
}): { ok: true; application: QuotaApplication } | { ok: false; error: string } {
  const state = loadRte();
  const i = state.applications.findIndex((a) => a.id === input.applicationId);
  if (i < 0) return { ok: false, error: "Application not found" };
  const cur = state.applications[i];
  if (
    cur.status !== "govt_assigned" &&
    cur.status !== "submitted" &&
    cur.status !== "waitlist"
  ) {
    return {
      ok: false,
      error: "Only govt-assigned (not yet admitted) candidates can be admitted",
    };
  }
  if (!cur.govtApplicationNo.trim()) {
    return { ok: false, error: "Govt application number required" };
  }
  const seatCheck = setApplicationStatus({
    id: cur.id,
    status: "admitted",
    by: input.by,
  });
  if (!seatCheck.ok) return seatCheck;

  const amount =
    input.registrationFee === "collect"
      ? Math.max(0, Math.round(Number(input.amountPaise) || 0))
      : 0;
  const paid =
    input.registrationFee === "waive" || input.registrationFee === "none"
      ? true
      : false;

  const fresh = loadRte();
  const j = fresh.applications.findIndex((a) => a.id === input.applicationId);
  const application = normalizeApp({
    ...fresh.applications[j],
    status: "admitted",
    registrationFeeChoice: input.registrationFee,
    registrationFeeAmountPaise: amount,
    registrationFeeNote:
      input.feeNote?.trim() ||
      (input.registrationFee === "waive"
        ? "Registration fee waived"
        : input.registrationFee === "none"
          ? "No registration fee"
          : ""),
    registrationFeePaid: paid,
    decidedBy: input.by,
    decidedAt: nowIso(),
    updatedAt: nowIso(),
    note: [
      cur.note,
      `School admission by ${input.by}`,
      input.registrationFee === "collect"
        ? `Reg. fee to collect ₹${(amount / 100).toFixed(0)}`
        : input.registrationFee === "waive"
          ? "Reg. fee waived"
          : "No reg. fee",
    ]
      .filter(Boolean)
      .join(" · "),
  });
  const applications = [...fresh.applications];
  applications[j] = application;
  saveRte({ ...fresh, applications });
  return { ok: true, application };
}

export function markRteRegistrationFeePaid(
  applicationId: string,
  note?: string,
): { ok: true; application: QuotaApplication } | { ok: false; error: string } {
  const state = loadRte();
  const i = state.applications.findIndex((a) => a.id === applicationId);
  if (i < 0) return { ok: false, error: "Application not found" };
  const cur = state.applications[i];
  if (cur.status !== "admitted" && cur.status !== "enrolled") {
    return { ok: false, error: "Admit the student first" };
  }
  if (cur.registrationFeeChoice !== "collect") {
    return { ok: false, error: "No registration fee to collect" };
  }
  const application = normalizeApp({
    ...cur,
    registrationFeePaid: true,
    registrationFeeNote: note?.trim() || cur.registrationFeeNote || "Paid",
    updatedAt: nowIso(),
  });
  const applications = [...state.applications];
  applications[i] = application;
  saveRte({ ...state, applications });
  return { ok: true, application };
}

/**
 * Only school-admitted candidates (with govt app no.) go to SIS.
 * Govt import alone never creates students.
 */
export function sendAllottedRteToSis(input: {
  applicationId: string;
  by: string;
  sectionId?: string;
}):
  | { ok: true; student: SisStudent; admissionNo: string }
  | { ok: false; error: string } {
  const state = loadRte();
  const app = state.applications.find((a) => a.id === input.applicationId);
  if (!app) return { ok: false, error: "Application not found" };
  if (app.status !== "admitted" && app.status !== "allotted" && app.status !== "enrolled") {
    return {
      ok: false,
      error: "Take school admission first — govt list alone is not admission",
    };
  }
  if (!app.govtApplicationNo.trim()) {
    return {
      ok: false,
      error: "Govt RTE application number is required before SIS",
    };
  }
  if (
    app.registrationFeeChoice === "collect" &&
    !app.registrationFeePaid
  ) {
    return {
      ok: false,
      error: "Collect or mark registration fee paid before sending to SIS",
    };
  }
  if (app.studentId) {
    return { ok: false, error: "Already linked to SIS student" };
  }

  const masters = loadMasters();
  const classId = app.classId;
  if (!classId) return { ok: false, error: "Class required" };
  let sectionId = input.sectionId || "";
  if (!sectionId) {
    sectionId =
      masters.sections.find((s) => s.classId === classId && s.isActive)?.id ||
      "";
  }
  if (!sectionId) {
    return { ok: false, error: "Assign a section (Masters) before SIS send" };
  }

  const sis = loadSis();
  const admissionDate = todayIso();
  const admissionNo = suggestAdmissionNo(sis.students);
  const srn = suggestSrn(sis.students);
  const studentType = suggestFeeStudentType(
    admissionDate,
    app.academicYearCode || DEFAULT_AY,
    "RTE",
  );
  const feeGroupId =
    resolveFeeGroupId(masters, {
      studentType,
      classId,
      academicYearCode: app.academicYearCode || DEFAULT_AY,
      preferPublished: true,
    }) || null;
  const campusId =
    masters.campuses.find((c) => c.isPrimary)?.id ||
    masters.campuses[0]?.id ||
    "";
  const mobile = (app.mobile || "").replace(/\D/g, "").slice(-10);
  let households = [...sis.households];
  let householdId =
    households.find((h) => h.mobile.replace(/\D/g, "").slice(-10) === mobile)
      ?.id || "";
  if (!householdId) {
    const hh = normalizeHousehold({
      id: newSisId("hh"),
      code: `HH-RTE-${sis.households.length + 1}`,
      guardianName: app.parentName || "Parent",
      mobile: mobile || "0000000000",
      whatsappMobile: mobile,
    });
    households = [...households, hh];
    householdId = hh.id;
  }

  const tagIds = ensureRteEwsTagIds({
    type: app.type,
    category: app.category,
  });
  const category =
    app.type === "EWS" || app.category === "EWS"
      ? "EWS"
      : (["GEN", "OBC", "SC", "ST", "EWS"].includes(app.category)
          ? app.category
          : "") as SisStudent["category"];

  const feeNote =
    app.registrationFeeChoice === "collect"
      ? `Reg fee ₹${(app.registrationFeeAmountPaise / 100).toFixed(0)} ${app.registrationFeePaid ? "paid" : "due"}`
      : app.registrationFeeChoice === "waive"
        ? "Reg fee waived"
        : "No reg fee";

  const genderRaw = (app.gender || "").toUpperCase();
  const gender: SisStudent["gender"] =
    genderRaw.startsWith("F") || genderRaw === "GIRL"
      ? "F"
      : genderRaw.startsWith("M") || genderRaw === "BOY"
        ? "M"
        : "";

  const student = normalizeStudent({
    id: newSisId("stu"),
    admissionNo,
    srn,
    fullName: app.childName,
    status: "active",
    campusId,
    classId,
    sectionId,
    academicYearCode: app.academicYearCode || DEFAULT_AY,
    studentType,
    feeGroupId,
    joinedOn: admissionDate,
    fatherName: app.parentName,
    fatherMobile: mobile,
    householdId,
    category,
    tagIds,
    gender,
    dob: app.dateOfBirth || "",
    notes: `RTE/EWS govt app ${app.govtApplicationNo} · ${feeNote} · by ${input.by}`,
  });

  saveSis({
    ...sis,
    households,
    students: [...sis.students, student],
  });

  const applications = state.applications.map((a) =>
    a.id === app.id
      ? normalizeApp({
          ...a,
          status: "enrolled",
          studentId: student.id,
          decidedBy: input.by,
          decidedAt: nowIso(),
          updatedAt: nowIso(),
          note: [a.note, `SIS ${admissionNo} · ${srn}`].filter(Boolean).join(" · "),
        })
      : a,
  );
  saveRte({ ...state, applications });
  return { ok: true, student, admissionNo };
}

/** School-admitted, fee settled (if collecting), not yet in SIS. */
export function listReadyForSis(state?: RteState): QuotaApplication[] {
  const rte = state ?? loadRte();
  return rte.applications.filter(
    (a) =>
      (a.status === "admitted" || a.status === "allotted") &&
      !!a.govtApplicationNo.trim() &&
      !a.studentId &&
      (a.registrationFeeChoice !== "collect" || a.registrationFeePaid),
  );
}

export function listEnrolledRteStudents(sis?: SisState) {
  const state = sis ?? loadSis();
  return state.students
    .filter(
      (s) =>
        s.status === "active" &&
        (s.studentType === "RTE" || s.category === "EWS"),
    )
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/* ─── Assign / remove RTE directly on SIS students ─── */

/** Mark an existing SIS student as RTE (fee type + tag + RTE fee group). */
export function assignRteToStudent(input: {
  studentId: string;
  by: string;
}): { ok: true; student: SisStudent } | { ok: false; error: string } {
  const before = loadSis();
  const st = before.students.find((s) => s.id === input.studentId);
  if (!st) return { ok: false, error: "Student not found" };
  if (st.studentType === "RTE") {
    return { ok: false, error: "Student is already RTE" };
  }
  // May create the RTE/EWS tags (saves SIS) — reload after.
  const tagIds = ensureRteEwsTagIds({ category: st.category });
  const masters = loadMasters();
  const ayCode = st.academicYearCode || DEFAULT_AY;
  const feeGroupId =
    resolveFeeGroupId(masters, {
      studentType: "RTE",
      classId: st.classId,
      academicYearCode: ayCode,
      preferPublished: true,
    }) || st.feeGroupId;

  const sis = loadSis();
  const students = sis.students.map((s) =>
    s.id === st.id
      ? {
          ...s,
          studentType: "RTE" as const,
          feeGroupId,
          tagIds: Array.from(new Set([...(s.tagIds ?? []), ...tagIds])),
          notes: [s.notes, `RTE assigned by ${input.by} on ${todayIso()}`]
            .filter(Boolean)
            .join(" · "),
        }
      : s,
  );
  saveSis({ ...sis, students });
  return { ok: true, student: students.find((s) => s.id === st.id)! };
}

/** Take RTE/EWS off a student — fee type reverts, tags and waivers drop. */
export function removeRteFromStudent(input: {
  studentId: string;
  by: string;
}): { ok: true } | { ok: false; error: string } {
  const sis = loadSis();
  const st = sis.students.find((s) => s.id === input.studentId);
  if (!st) return { ok: false, error: "Student not found" };
  if (st.studentType !== "RTE" && st.category !== "EWS") {
    return { ok: false, error: "Student is not RTE / EWS" };
  }

  const ayCode = st.academicYearCode || DEFAULT_AY;
  const joinedYear = (st.joinedOn || "").slice(0, 4);
  const revertType =
    st.studentType === "RTE"
      ? joinedYear && joinedYear < ayCode.slice(0, 4)
        ? ("PROMOTE" as const)
        : suggestFeeStudentType(st.joinedOn || "", ayCode)
      : st.studentType;

  const masters = loadMasters();
  const feeGroupId =
    resolveFeeGroupId(masters, {
      studentType: revertType,
      classId: st.classId,
      academicYearCode: ayCode,
      preferPublished: true,
    }) || st.feeGroupId;

  const rteTagIds = new Set(
    (sis.tags ?? [])
      .filter((t) => t.code === "RTE" || t.code === "EWS")
      .map((t) => t.id),
  );
  const students = sis.students.map((s) =>
    s.id === st.id
      ? {
          ...s,
          studentType: revertType,
          category:
            s.category === "EWS" ? ("" as SisStudent["category"]) : s.category,
          feeGroupId,
          tagIds: (s.tagIds ?? []).filter((id) => !rteTagIds.has(id)),
          notes: [s.notes, `RTE removed by ${input.by} on ${todayIso()}`]
            .filter(Boolean)
            .join(" · "),
        }
      : s,
  );
  saveSis({ ...sis, students });

  const existing = masters.concessionGrants ?? [];
  const kept = existing.filter(
    (g) =>
      !(g.studentId === st.id && g.id.startsWith(RTE_WAIVER_GRANT_PREFIX)),
  );
  if (kept.length !== existing.length) {
    void saveMasters({ ...masters, concessionGrants: kept });
  }
  return { ok: true };
}

/* ─── Per-student, per-head RTE fee waivers ───
 * One 100% concession rule per fee head (created lazily), one approved grant
 * per student per waived head. Fee Take's dues engine applies them like any
 * other concession, so "untick a head" simply means "grant its waiver". */

const RTE_WAIVER_GRANT_PREFIX = "cg_rtew_";

function rteWaiverRuleId(feeHeadId: string): string {
  return `cnc_rtew_${feeHeadId}`;
}

function rteWaiverGrantId(studentId: string, feeHeadId: string): string {
  return `${RTE_WAIVER_GRANT_PREFIX}${studentId}_${feeHeadId}`;
}

/** Fee-head ids currently waived for this student via RTE per-head grants. */
export function rteWaivedHeadIds(
  masters: MastersState,
  studentId: string,
): Set<string> {
  const byRule = new Map(masters.concessions.map((c) => [c.id, c]));
  const out = new Set<string>();
  for (const g of masters.concessionGrants ?? []) {
    if (g.studentId !== studentId || g.status !== "approved") continue;
    if (!g.id.startsWith(RTE_WAIVER_GRANT_PREFIX)) continue;
    for (const headId of byRule.get(g.concessionId)?.feeHeadIds ?? []) {
      out.add(headId);
    }
  }
  return out;
}

/** Tick = charge the head (no waiver); untick = waive it 100% for this student. */
export async function setRteHeadWaiver(input: {
  studentId: string;
  feeHeadId: string;
  waived: boolean;
  by: string;
  academicYearCode?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const masters = loadMasters();
  const head = masters.feeHeads.find((h) => h.id === input.feeHeadId);
  if (!head) return { ok: false, error: "Fee head not found" };

  let concessions = masters.concessions;
  let rule = concessions.find((c) => c.id === rteWaiverRuleId(input.feeHeadId));
  if (!rule && input.waived) {
    rule = normalizeConcessionRule({
      id: rteWaiverRuleId(input.feeHeadId),
      code: `RTEW_${(head.code || head.nameEn).replace(/\W+/g, "_").toUpperCase()}`.slice(0, 24),
      name: `RTE waiver — ${head.nameEn}`,
      kind: "rte_ews",
      academicYearCode: input.academicYearCode || DEFAULT_AY,
      mode: "percent",
      value: 100,
      siblingTiers: [],
      feeHeadIds: [input.feeHeadId],
      autoApproveMaxPaise: null,
      documentationRequired: false,
      incompatibleCodes: [],
      notes: "Per-head RTE waiver (RTE module)",
      isActive: true,
    });
    concessions = [...concessions, rule];
  }

  const grantId = rteWaiverGrantId(input.studentId, input.feeHeadId);
  const existing = masters.concessionGrants ?? [];
  let concessionGrants = existing;
  if (input.waived) {
    if (!existing.some((g) => g.id === grantId)) {
      concessionGrants = [
        ...existing,
        normalizeConcessionGrant({
          id: grantId,
          concessionId: rule!.id,
          studentId: input.studentId,
          status: "approved",
          reason: `RTE — head not charged (by ${input.by})`,
          effectiveFrom: todayIso(),
          effectiveTo: null,
          createdAt: nowIso(),
          siblingChildNo: null,
        }),
      ];
    }
  } else {
    concessionGrants = existing.filter((g) => g.id !== grantId);
  }

  if (
    concessions === masters.concessions &&
    concessionGrants === existing
  ) {
    return { ok: true };
  }
  const saved = await saveMasters({ ...masters, concessions, concessionGrants });
  if (!saved.ok) {
    return { ok: false, error: `Masters save blocked (${saved.reason})` };
  }
  return { ok: true };
}

export function quotaTypeLabel(t: QuotaType): string {
  if (t === "EWS") return "EWS";
  if (t === "SCHOLARSHIP") return "Scholarship";
  return "RTE";
}

export function applicationStatusLabel(s: QuotaApplicationStatus): string {
  const map: Record<QuotaApplicationStatus, string> = {
    draft: "Draft",
    submitted: "Govt assigned",
    govt_assigned: "Govt assigned (not admitted)",
    waitlist: "Waitlist",
    allotted: "School admitted",
    admitted: "School admitted",
    rejected: "Rejected",
    enrolled: "In SIS",
    withdrawn: "Withdrawn",
  };
  return map[s] ?? s;
}

export function registrationFeeLabel(app: QuotaApplication): string {
  if (app.registrationFeeChoice === "pending") return "Fee: not decided";
  if (app.registrationFeeChoice === "none") return "No registration fee";
  if (app.registrationFeeChoice === "waive") return "Reg. fee waived";
  if (app.registrationFeeChoice === "collect") {
    const amt = `₹${(app.registrationFeeAmountPaise / 100).toFixed(0)}`;
    return app.registrationFeePaid
      ? `Reg. fee ${amt} paid`
      : `Reg. fee ${amt} to collect`;
  }
  return "";
}

/** Display DOB as portal-style DD/MM/YYYY when ISO. */
export function formatPortalDob(isoOrRaw: string): string {
  const s = (isoOrRaw || "").trim();
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

/** Sort govt list like portal: S.No. then Registration ID. */
export function sortGovtAllottedApps(apps: QuotaApplication[]): QuotaApplication[] {
  return [...apps].sort((a, b) => {
    const sa = Number(a.portalSerialNo) || 0;
    const sb = Number(b.portalSerialNo) || 0;
    if (sa && sb && sa !== sb) return sa - sb;
    return (a.govtApplicationNo || "").localeCompare(
      b.govtApplicationNo || "",
      undefined,
      { numeric: true },
    );
  });
}

export function seedRteIfEmpty(ay?: string): RteState {
  const existing = loadRte();
  if (existing.seats.length > 0 || existing.applications.length > 0) {
    return existing;
  }
  const year = ay || DEFAULT_AY;
  return seedQuotaSeatsFromStrength({ academicYearCode: year, type: "RTE" });
}

/* ─── Reports ───────────────────────────────────────────────── */

export type RteReportId = "quota_dashboard" | "applications" | "enrolled";

export const RTE_REPORTS: {
  id: RteReportId;
  label: string;
  hint?: string;
}[] = [
  {
    id: "quota_dashboard",
    label: "Quota seat dashboard",
    hint: "Mandated vs filled by class",
  },
  {
    id: "applications",
    label: "Applications register",
    hint: "All applications with status",
  },
  {
    id: "enrolled",
    label: "Enrolled RTE / EWS",
    hint: "Active SIS students on quota",
  },
];

function finish(
  title: string,
  filterNote: string,
  columns: ReportColumn[],
  rows: Record<string, string | number>[],
  format: "excel" | "pdf",
  fileBaseName: string,
): { ok: true; message: string } | { ok: false; error: string } {
  const r = exportFilterReport(
    {
      title,
      subtitle: TENANT.shortName,
      filterNote,
      columns,
      rows,
      fileBaseName,
    },
    format,
  );
  return r.ok
    ? { ok: true, message: `${title}: ${rows.length} row(s)` }
    : r;
}

export function runRteReport(
  id: RteReportId,
  filters: {
    format: "excel" | "pdf";
    academicYearCode?: string;
    rte?: RteState;
  },
): { ok: true; message: string } | { ok: false; error: string } {
  const rte = filters.rte ?? loadRte();
  const ay = filters.academicYearCode || DEFAULT_AY;
  const note = describeFilters([TENANT.shortName, ay, todayIso()]);

  if (id === "quota_dashboard") {
    const rows = listQuotaSeatRows(rte, ay).map((r) => ({
      class: r.className,
      type: quotaTypeLabel(r.type),
      total: r.total,
      filled: r.filled,
      remaining: r.remaining,
      enrolled: r.enrolled,
      allotted: r.allotted,
    }));
    return finish(
      "RTE / EWS quota dashboard",
      note,
      [
        { key: "class", header: "Class" },
        { key: "type", header: "Type" },
        { key: "total", header: "Seats", align: "right" },
        { key: "filled", header: "Filled", align: "right" },
        { key: "remaining", header: "Left", align: "right" },
        { key: "enrolled", header: "SIS", align: "right" },
        { key: "allotted", header: "Allotted", align: "right" },
      ],
      rows,
      filters.format,
      "rte_quota_dashboard",
    );
  }

  if (id === "applications") {
    const masters = loadMasters();
    const rows = sortGovtAllottedApps(
      rte.applications.filter((a) => a.academicYearCode === ay),
    ).map((a) => ({
      sno: a.portalSerialNo || "—",
      lottery: a.lotteryNo || "—",
      govt: a.govtApplicationNo || "—",
      child: a.childName,
      father: a.parentName || "—",
      class:
        masters.classes.find((c) => c.id === a.classId)?.name || a.classId,
      gender: a.gender || "—",
      dob: formatPortalDob(a.dateOfBirth),
      block: a.blockTown || "—",
      ward: a.gramPanchayatWard || "—",
      portalStatus: a.portalAdmissionStatus || "—",
      schoolStatus: applicationStatusLabel(a.status),
      fee: registrationFeeLabel(a) || "—",
      type: quotaTypeLabel(a.type),
      sis: a.studentId ? "yes" : "no",
    }));
    return finish(
      "RTE AllottedSeat register",
      note,
      [
        { key: "sno", header: "S.No." },
        { key: "lottery", header: "Lottery No" },
        { key: "govt", header: "Registration ID" },
        { key: "child", header: "Student Name" },
        { key: "father", header: "Father Name" },
        { key: "class", header: "Class" },
        { key: "gender", header: "Gender" },
        { key: "dob", header: "DOB" },
        { key: "block", header: "Block/Town" },
        { key: "ward", header: "Grampanchayat/Ward" },
        { key: "portalStatus", header: "Admission Status (portal)" },
        { key: "schoolStatus", header: "School status" },
        { key: "fee", header: "Reg. fee" },
        { key: "type", header: "Type" },
        { key: "sis", header: "In SIS" },
      ],
      rows,
      filters.format,
      "rte_applications",
    );
  }

  const masters = loadMasters();
  const rows = listEnrolledRteStudents().map((s) => ({
    name: s.fullName,
    class: masters.classes.find((c) => c.id === s.classId)?.name || s.classId,
    type: s.studentType,
    category: s.category || "—",
    srn: s.srn || "—",
  }));
  return finish(
    "Enrolled RTE / EWS students",
    note,
    [
      { key: "name", header: "Student" },
      { key: "class", header: "Class" },
      { key: "type", header: "Fee type" },
      { key: "category", header: "Category" },
      { key: "srn", header: "SRN" },
    ],
    rows,
    filters.format,
    "rte_enrolled",
  );
}
