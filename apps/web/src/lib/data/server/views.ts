/**
 * The reference views (data-layer 1.4, rules R2/R5/R6): the only whole-desk
 * reads a browser makes, each a static route under app/api/data/views/<name>
 * (Next prefers a static segment over /api/data/[collection]). Handlers live
 * here, with their dependencies injectable, so a self-test can drive them
 * (a route file may export only handlers and route config).
 *
 *   GET /api/data/views/masters          full Masters, or the teaching subset —
 *                                        the masters-desk rule (lib/mastersReadScope.server)
 *   GET /api/data/views/staff-list       the roster as a directory: who, what,
 *                                        which classes — nothing personal
 *   GET /api/data/views/rbac             every role; your own assignments and
 *                                        grants unless you hold Settings view
 *   GET /api/data/views/module-registry  which modules the school switched on
 *
 * Every answer: `200 {ok:true, data, versions, stale}` with
 * `Cache-Control: private, no-store`. `versions` is what the copy was built
 * from (the erp_versions values of its desks — referenceCache `builtFrom`),
 * so the browser's versions poll can tell when it is behind; null when that
 * is not proven (a stale copy). Failures: 401 no session, 403 a parent, an
 * inactive family, or the mirror sync secret (these are for signed-in staff;
 * the service callers' exports are step 3.0), 503 `{ok:false}` when the
 * server has no copy it can stand behind — never an empty list (R6).
 *
 * Data comes only from the per-process reference caches (lib/data/server/
 * referenceCache via lib/api/v1/auth): no school mirror, no defaultMasters,
 * no per-request desk read.
 */
// Server code, but no `import "server-only"` (same reason as ./versions.ts):
// the self-test imports this under plain tsx.
import { NextResponse } from "next/server";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import type { RouteAuthResult } from "@/lib/apiRouteAuth.server";
import type { MastersReadScope } from "@/lib/mastersReadScope.server";
import { teachingMastersSubset } from "@/lib/mastersTeachingSubset";
import type { MastersState } from "@/lib/masters";
import type { StaffRecord } from "@/lib/foundationMasters";
import type { RbacState } from "@/lib/rbac";
import type { ModuleRegistryState } from "@/lib/moduleRegistry";
import type { MastersBook, MastersView, RbacView, StaffListEntry, StaffListView } from "../viewTypes";
import type { BuiltFrom, CacheRead } from "./referenceCache";
import { MASTERS_OBJECT_SLICE_KEYS } from "../viewTypes";

export type { MastersBook, MastersView, ModuleRegistryView, RbacView, StaffListEntry, StaffListView } from "../viewTypes";

export type RbacCopy = { state: RbacState; known: boolean };

export type ViewDeps = {
  /** Masters access: full / teaching / refused (resolveMastersReadScope). */
  mastersScope: (req: Request) => Promise<MastersReadScope>;
  /** Any member of staff (requireStaffApi). */
  requireStaff: (req: Request) => Promise<RouteAuthResult>;
  /** Settings view, the rbac desk's own read grant (requireStaffPermission(req, "settings", "view")). */
  requireSettingsView: (req: Request) => Promise<RouteAuthResult>;
  /** A valid mirror sync secret on the request (hasMirrorSyncSecret). */
  mirrorSecret: (req: Request) => boolean;
  readMasters: () => Promise<CacheRead<MastersState>>;
  /** The slice stamps a Masters copy was read with (object slices are written against them). */
  mastersStamps?: (state: MastersState) => Record<string, string> | null;
  readRbac: () => Promise<CacheRead<RbacCopy>>;
  readModuleRegistry: () => Promise<CacheRead<ModuleRegistryState>>;
};

// ── Shared answers ────────────────────────────────────────────────────────

const NO_STORE = { "Cache-Control": "private, no-store" };

function viewOk<T>(data: T, read: { stale: boolean; builtFrom: BuiltFrom | null }): Response {
  return NextResponse.json(
    { ok: true, data, versions: read.stale ? null : read.builtFrom, stale: read.stale },
    { headers: NO_STORE },
  );
}

function viewFail(status: number, error: string): Response {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

const UNREADABLE = "Could not read the school setup — please try again.";

/** The guard's refusal, passed through with no-store (its status and message). */
async function refusal(r: { response: Response }): Promise<Response> {
  const status = r.response.status;
  const body = (await r.response.json().catch(() => null)) as { error?: unknown } | null;
  const error = typeof body?.error === "string" ? body.error : status === 401 ? "Unauthorized" : "Forbidden";
  return viewFail(status, error);
}

const MIRROR_REFUSED = "The reference views are for signed-in staff, not the mirror sync secret.";

/** Staff session (or API key) for this request, else the refusal to send. */
async function staffOnly(req: Request, deps: ViewDeps): Promise<{ ok: true; ctx: ApiAuthContext } | { ok: false; res: Response }> {
  if (deps.mirrorSecret(req)) return { ok: false, res: viewFail(403, MIRROR_REFUSED) };
  const staff = await deps.requireStaff(req);
  if (!staff.ok) return { ok: false, res: await refusal(staff) };
  return { ok: true, ctx: staff.ctx };
}

// ── masters ───────────────────────────────────────────────────────────────

function mastersBook(state: MastersState): MastersBook {
  const book: Partial<MastersState> = { ...state };
  delete book.staff;
  delete book.departments;
  delete book.designations;
  return book as MastersBook;
}

export async function mastersViewGet(req: Request, deps: ViewDeps): Promise<Response> {
  if (deps.mirrorSecret(req)) return viewFail(403, MIRROR_REFUSED);
  const access = await deps.mastersScope(req);
  if (!access.ok) return refusal(access);
  const read = await deps.readMasters();
  if (!read.ok) return viewFail(503, UNREADABLE);
  // A "fallback" copy is Masters without the staff roster: this view carries
  // no roster, so it is still a true answer (marked stale, no versions).
  const book = mastersBook(read.value);
  const masters =
    access.scope === "full"
      ? book
      : ({ version: book.version, ...teachingMastersSubset(book as unknown as Record<string, unknown>) } as unknown as MastersBook);
  // Every list element is passed through as stored — with its `_rev`, the
  // base of its next write (data-layer 2.2b; no normalisation here drops
  // it). Object slices carry no `_rev`: their base is the slice's stamp,
  // given in `stamps` for each object slice this answer carries.
  const stamps: Record<string, string> = {};
  const all = deps.mastersStamps?.(read.value) ?? null;
  if (all) {
    for (const k of MASTERS_OBJECT_SLICE_KEYS) {
      if (all[k] && (masters as unknown as Record<string, unknown>)[k] !== undefined) stamps[k] = all[k]!;
    }
  }
  const view: MastersView = { scope: access.scope, masters, stamps };
  return viewOk(view, read);
}

// ── staff-list ────────────────────────────────────────────────────────────

/**
 * One roster row as a directory entry. Built field by field from an allow
 * list: whatever else a record carries — mobile, Aadhaar, PAN, bank, salary,
 * a login password, anything a profile blob adds later — is never copied.
 */
export function staffListEntry(
  s: StaffRecord,
  deptName: (id: string | null) => string,
  desigName: (id: string | null) => string,
): StaffListEntry {
  const arr = <T,>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);
  return {
    id: String(s.id),
    empCode: String(s.empCode ?? ""),
    fullName: String(s.fullName ?? ""),
    stream: s.stream,
    status: s.status,
    departmentId: s.departmentId ?? null,
    departmentName: deptName(s.departmentId ?? null),
    designationId: s.designationId ?? null,
    designationName: desigName(s.designationId ?? null),
    classTeacherLinks: arr(s.classTeacherLinks).map((l) => ({
      id: l.id,
      classId: l.classId,
      sectionId: l.sectionId,
      academicYearCode: l.academicYearCode,
      isPrimary: l.isPrimary,
    })),
    subjectTeachingLinks: arr(s.subjectTeachingLinks).map((l) => ({
      id: l.id,
      classId: l.classId,
      sectionId: l.sectionId,
      subjectId: l.subjectId,
      academicYearCode: l.academicYearCode,
      periodsPerWeek: l.periodsPerWeek,
    })),
    dutyLinks: arr(s.dutyLinks).map((l) => ({ id: l.id, role: l.role, label: l.label, academicYearCode: l.academicYearCode })),
    vehicleLinks: arr(s.vehicleLinks).map((l) => ({
      id: l.id,
      routeId: l.routeId,
      role: l.role,
      academicYearCode: l.academicYearCode,
      effectiveFrom: l.effectiveFrom,
      effectiveTo: l.effectiveTo,
    })),
  };
}

export function staffListOf(state: MastersState): StaffListView {
  const departments = (state.departments ?? []).map((d) => ({ id: d.id, code: d.code, name: d.name, isActive: d.isActive }));
  const designations = (state.designations ?? []).map((d) => ({
    id: d.id,
    code: d.code,
    name: d.name,
    departmentId: d.departmentId ?? null,
    isActive: d.isActive,
  }));
  const dept = new Map(departments.map((d) => [d.id, d.name]));
  const desig = new Map(designations.map((d) => [d.id, d.name]));
  return {
    staff: (state.staff ?? []).map((s) =>
      staffListEntry(
        s,
        (id) => (id ? dept.get(id) ?? "" : ""),
        (id) => (id ? desig.get(id) ?? "" : ""),
      ),
    ),
    departments,
    designations,
  };
}

export async function staffListViewGet(req: Request, deps: ViewDeps): Promise<Response> {
  const who = await staffOnly(req, deps);
  if (!who.ok) return who.res;
  const read = await deps.readMasters();
  if (!read.ok) return viewFail(503, UNREADABLE);
  // Masters without the roster: the roster is unknown, not empty.
  if (read.from === "fallback") return viewFail(503, "Could not read the staff list — please try again.");
  return viewOk(staffListOf(read.value), read);
}

// ── rbac ──────────────────────────────────────────────────────────────────

/** Every role's definition; only `staffId`'s assignments and grants; no audit. */
export function ownRbac(state: RbacState, staffId: string): RbacState {
  const mine = <T extends { staffId?: string }>(rows: T[] | undefined): T[] =>
    Array.isArray(rows) ? rows.filter((r) => !!staffId && r.staffId === staffId) : [];
  return { ...state, assignments: mine(state.assignments), userGrants: mine(state.userGrants), audit: [] };
}

export async function rbacViewGet(req: Request, deps: ViewDeps): Promise<Response> {
  if (deps.mirrorSecret(req)) return viewFail(403, MIRROR_REFUSED);
  // The rbac desk's own rule (desk-slice/[module] GET): Settings view = the
  // whole desk; any other member of staff = the roles and their own rows.
  let ownOnly = false;
  let staffId = "";
  const full = await deps.requireSettingsView(req);
  if (!full.ok) {
    if (full.response.status !== 403) return refusal(full);
    const staff = await deps.requireStaff(req);
    if (!staff.ok) return refusal(staff);
    ownOnly = true;
    staffId = staff.ctx.session.staffId || "";
  }
  const read = await deps.readRbac();
  if (!read.ok) return viewFail(503, "Could not read roles & permissions — please try again.");
  const view: RbacView = {
    rbac: ownOnly ? ownRbac(read.value.state, staffId) : read.value.state,
    ownOnly,
    known: read.value.known,
  };
  return viewOk(view, read);
}

// ── module-registry ───────────────────────────────────────────────────────

export async function moduleRegistryViewGet(req: Request, deps: ViewDeps): Promise<Response> {
  const who = await staffOnly(req, deps);
  if (!who.ok) return who.res;
  const read = await deps.readModuleRegistry();
  if (!read.ok) return viewFail(503, "Could not read which modules are switched on — please try again.");
  return viewOk(read.value, read);
}

/** The module-registry desk's bundle as the state the app uses (booleans only). */
export function moduleRegistryOf(bundle: Record<string, unknown>): ModuleRegistryState {
  const enabled: Record<string, boolean> = {};
  const raw = bundle.enabled;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "boolean") enabled[k] = v;
    }
  }
  return { version: 1, enabled: enabled as ModuleRegistryState["enabled"] };
}
