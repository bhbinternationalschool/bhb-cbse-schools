import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { loadSis, writeSisLocalRaw } from "@/lib/sis";
import { FIELD_TARGET, LOCAL_KEY, type PortalStudentCopy, type SyncField } from "@/lib/udisePortalStudentSync";

/**
 * The ERP's copy of each child's UDISE+ record, as the robot last read it
 * (lib/udisePortalStudentSync), and the PEN finder's search results. Two
 * module_local_state rows written only by the robot routes — server truth,
 * no browser copy. null from a read = the read failed: unknown, never empty.
 */

const STUDENTS_KEY = "udise_portal_students";
const PEN_KEY = "udise_pen_candidates";

type StudentsState = { years: Record<string, { fetchedAt: string; byPen: Record<string, PortalStudentCopy> }> };

export type PenHit = {
  pen: string;
  name: string;
  dob: string;
  father: string;
  mother: string;
  schoolName: string;
  udiseCode: string;
  classDesc: string;
  yearDesc: string;
  statusDesc: string;
};
export type PenSearchResult = {
  erpId: string;
  checkedAt: string;
  /** false = the portal search could not run: "could not check", never "not found". */
  searched: boolean;
  error?: string;
  hits: PenHit[];
};
type PenState = { byErpId: Record<string, PenSearchResult> };

async function readKey<T>(key: string): Promise<{ state: T | null } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", key)
    .maybeSingle();
  if (error) {
    console.warn(`[udise-portal] ${key} read failed`, error.message);
    return null;
  }
  return { state: (data?.state as T | null) ?? null };
}

async function writeKey(key: string, state: object): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const { error } = await ctx.sb
    .from("module_local_state")
    .upsert({ tenant_id: ctx.tenantId, module_key: key, state, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,module_key" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function readPortalStudents(ay: string): Promise<{ fetchedAt: string; byPen: Record<string, PortalStudentCopy> } | null> {
  const got = await readKey<StudentsState>(STUDENTS_KEY);
  if (!got) return null;
  return got.state?.years?.[ay] ?? { fetchedAt: "", byPen: {} };
}

/** Merge a batch of fetched children into the year's copy (by PEN). */
export async function mergePortalStudents(ay: string, copies: PortalStudentCopy[]): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  const got = await readKey<StudentsState>(STUDENTS_KEY);
  if (!got) return { ok: false, error: "Could not read the ERP's portal copy — nothing saved. Try again." };
  const state: StudentsState = got.state && got.state.years ? got.state : { years: {} };
  const year = state.years[ay] ?? { fetchedAt: "", byPen: {} };
  for (const c of copies) {
    const prev = year.byPen[c.pen];
    // A list sweep does not carry the Enrolment Profile; keep the one read
    // off the child's form earlier.
    year.byPen[c.pen] = { ...c, ep: c.ep ?? prev?.ep, epAt: c.epAt ?? prev?.epAt };
  }
  year.fetchedAt = new Date().toISOString();
  state.years[ay] = year;
  const w = await writeKey(STUDENTS_KEY, state);
  return w.ok ? { ok: true, total: Object.keys(year.byPen).length } : w;
}

/** The Enrolment Profile read off one child's open form. */
export async function setPortalEnrolment(ay: string, pen: string, studentId: string, ep: Record<string, unknown>) {
  const got = await readKey<StudentsState>(STUDENTS_KEY);
  if (!got) return { ok: false as const, error: "Could not read the ERP's portal copy." };
  const state: StudentsState = got.state && got.state.years ? got.state : { years: {} };
  const year = state.years[ay] ?? { fetchedAt: "", byPen: {} };
  const now = new Date().toISOString();
  year.byPen[pen] = year.byPen[pen]
    ? { ...year.byPen[pen]!, ep, epAt: now }
    : { studentId, pen, gp: { studentCodeNat: pen, studentId }, fp: {}, ep, epAt: now, fetchedAt: "" };
  state.years[ay] = year;
  return writeKey(STUDENTS_KEY, state);
}

export async function readPenCandidates(): Promise<Record<string, PenSearchResult> | null> {
  const got = await readKey<PenState>(PEN_KEY);
  if (!got) return null;
  return got.state?.byErpId ?? {};
}

export async function mergePenCandidates(results: PenSearchResult[]) {
  const got = await readKey<PenState>(PEN_KEY);
  if (!got) return { ok: false as const, error: "Could not read the PEN finder results." };
  const byErpId = { ...(got.state?.byErpId ?? {}) };
  for (const r of results) byErpId[r.erpId] = r;
  return writeKey(PEN_KEY, { byErpId });
}

type WriteResult = { ok: true; updatedAt: string } | { ok: false; conflict?: boolean; error: string };

/**
 * Write the office's ticked portal values to ONE child (and its household for
 * address / pincode). Only the target columns change; profile keys are merged
 * into the row's own profile; each write is conditional on the revision just
 * read, so a save landing in between is refused, not overwritten.
 */
export async function applyPortalValues(
  studentId: string,
  revisionAt: string | undefined,
  changes: { field: SyncField; value: string | boolean }[],
): Promise<WriteResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const cur = await ctx.sb
    .from("sis_students")
    .select("profile, updated_at, household_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", studentId)
    .maybeSingle();
  if (cur.error) return { ok: false, error: cur.error.message };
  if (!cur.data) return { ok: false, error: "Record not found" };
  const readAt = String(cur.data.updated_at || "");
  if (revisionAt && readAt !== revisionAt) {
    return { ok: false, conflict: true, error: "Someone changed this child's record just now — reload and try again" };
  }

  const cols: Record<string, unknown> = {};
  const prof: Record<string, unknown> = {};
  const hhCols: Record<string, unknown> = {};
  const localStudent: Record<string, unknown> = {};
  const localHh: Record<string, unknown> = {};
  for (const c of changes) {
    const t = FIELD_TARGET[c.field];
    const lk = LOCAL_KEY[c.field];
    if (!t || !lk) continue;
    if (t.kind === "household") {
      hhCols[t.key] = c.value;
      localHh[lk] = c.value;
    } else {
      (t.kind === "column" ? cols : prof)[t.key] = c.value;
      localStudent[lk] = c.value;
    }
  }
  if (Object.keys(prof).length) {
    const p = (cur.data.profile && typeof cur.data.profile === "object" && !Array.isArray(cur.data.profile) ? cur.data.profile : {}) as Record<string, unknown>;
    cols.profile = { ...p, ...prof };
  }
  const now = new Date().toISOString();
  if (Object.keys(cols).length) {
    const r = await ctx.sb
      .from("sis_students")
      .update({ ...cols, updated_at: now })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", studentId)
      .eq("updated_at", readAt)
      .select("id");
    if (r.error) return { ok: false, error: r.error.message };
    if (!r.data?.length) return { ok: false, conflict: true, error: "Someone changed this child's record just now — reload and try again" };
  }
  const hhId = String(cur.data.household_id || "");
  if (Object.keys(hhCols).length) {
    if (!hhId) return { ok: false, error: "This child has no family record for the address" };
    const h = await ctx.sb.from("sis_households").select("updated_at").eq("tenant_id", ctx.tenantId).eq("id", hhId).maybeSingle();
    if (h.error || !h.data) return { ok: false, error: h.error?.message || "Family record not found" };
    const r = await ctx.sb
      .from("sis_households")
      .update({ ...hhCols, updated_at: now })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", hhId)
      .eq("updated_at", String(h.data.updated_at || ""))
      .select("id");
    if (r.error) return { ok: false, error: r.error.message };
    if (!r.data?.length) return { ok: false, conflict: true, error: "Someone changed this family's record just now — reload and try again" };
  }

  // Keep this process's SIS copy in step, as the other targeted writes do.
  const sis = loadSis();
  const students = sis.students.map((x) => (x.id === studentId ? ({ ...x, ...localStudent, revisionAt: now } as typeof x) : x));
  const households = hhId && Object.keys(localHh).length
    ? sis.households.map((x) => (x.id === hhId ? ({ ...x, ...localHh, revisionAt: now } as typeof x) : x))
    : sis.households;
  writeSisLocalRaw({ ...sis, students, households });
  return { ok: true, updatedAt: now };
}
