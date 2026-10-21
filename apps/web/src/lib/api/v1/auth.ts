import { createHash, timingSafeEqual } from "crypto";
import { getDemoSession, type DemoSession } from "@/lib/auth";
import { type MastersState } from "@/lib/masters";
import {
  deskBundleToMastersState,
  fetchMastersDeskFromDb,
} from "@/lib/mastersNormalized.server";
import { fetchStaffRemoteServer } from "@/lib/staffPersistence";
import {
  defaultRbacState,
  hasPermission,
  normalizeRbacState,
  type RbacAction,
  type RbacModule,
  type RbacState,
} from "@/lib/rbac";
import { getServerTenantContext } from "@/lib/serverTenant";
import { ApiError } from "@/lib/api/v1/errors";
import { staffRoleCodeFor } from "@/lib/staffSessionRole";
import { trackServerWork } from "@/lib/serverWork";
import { rbacReadOutcome } from "@/lib/rbacReadOutcome";
import { referenceCache, type BuildResult, type CacheRead } from "@/lib/data/server/referenceCache";

export type ApiAuthContext = {
  session: DemoSession;
  masters: MastersState;
  rbac: RbacState;
  /** false = the saved roles/grants could not be read; `rbac` is defaults. */
  rbacKnown?: boolean;
  authKind: "session" | "api_key";
  apiKeyId?: string;
};

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Server-side RBAC. Reads the same place Settings → Roles writes —
 * rbac_desk_slices — falling back to the legacy rbac_state blob only when
 * the desk is empty. Until 2026-08-18 this read the blob alone, which the UI
 * had stopped writing once the desk became the source of truth, and which
 * bootstrap-go-live reset to defaults on every deploy: server-side
 * enforcement and the browser were looking at two different role sets.
 * This runs on every authenticated request (31 089 blob reads in six days),
 * so it is a reference cache (data-layer 1.3, lib/data/server/referenceCache):
 * rebuilt when erp_versions says the rbac desk ("rbac" — rbac_desk_sync_meta,
 * which every desk-slice push bumps) or the legacy blob (rbac_state) moved,
 * and not otherwise. Until 13 Oct 2026 it was a 30 s TTL re-validated against
 * rbac_desk_sync_meta every 5 s.
 *
 * Personal denies (12 Oct 2026) make a stale or unknown copy matter: a deny
 * the office just set must bite within seconds on every instance (now: the
 * next versions window, 2 s), and a failed read must not answer with
 * defaults that carry no denies at all. So a failed read keeps the last copy
 * this instance read; with no copy ever read, `known` is false (rbacReadOutcome)
 * — function-only access is refused (lib/apiRouteAuth.server).
 */
type RbacCopy = { state: RbacState; known: boolean };

async function buildServerRbac(): Promise<BuildResult<RbacCopy>> {
  const ctx = await getServerTenantContext();
  // No database configured (a local demo): nothing failed, nothing is saved.
  if (!ctx) {
    if (!serverDatabaseConfigured()) return { ok: true, value: { state: defaultRbacState(), known: false } };
    return { ok: false, error: "tenant unavailable" };
  }

  let state: RbacState | undefined;
  let deskOk = false;
  try {
    const { fetchDeskSliceFromDb } = await import(
      "@/lib/deskSliceNormalized.server"
    );
    const { bundle, ok } = await fetchDeskSliceFromDb("rbac");
    deskOk = ok;
    const roles = Array.isArray(bundle.roles) ? bundle.roles : [];
    if (ok && roles.length > 0) {
      state = normalizeRbacState({
        version: 1,
        roles,
        assignments: Array.isArray(bundle.assignments) ? bundle.assignments : [],
        audit: Array.isArray(bundle.audit) ? bundle.audit : [],
        userGrants: Array.isArray(bundle.userGrants) ? bundle.userGrants : [],
        mobile: bundle.mobile,
      } as Partial<RbacState>);
    }
  } catch (e) {
    console.warn("[apiAuth] rbac desk read failed", e);
  }

  // Unknown is not empty: the cache keeps the last copy (its denies
  // included) rather than answer with defaults that deny nothing.
  if (!deskOk) return { ok: false, error: "rbac desk read failed" };

  if (!state) {
    const { data } = await ctx.sb
      .from("rbac_state")
      .select("state")
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    state = data?.state as RbacState | undefined;
  }

  // normalizeRbacState merges any built-in module grant missing from a
  // persisted role (e.g. a module added after this tenant's rbac row was
  // last saved) onto that role — the same merge loadRbac() already does
  // client-side. Skipping it here silently denies every module added after
  // go-live until someone happens to re-save Settings → Roles.
  const resolved = state?.roles?.length
    ? normalizeRbacState(state)
    : defaultRbacState();
  // Known = a real saved role set (#574): defaults stand in for nothing.
  return { ok: true, value: { state: resolved, known: !!state?.roles?.length } };
}

const rbacCache = referenceCache<RbacCopy>("rbac", ["rbac", "rbac_state"], buildServerRbac);

/** Force the next RBAC read to rebuild — call after a server-side write to the rbac desk. */
export function invalidateServerRbacCache(): void {
  rbacCache.invalidate();
}

/**
 * The roles copy and whether it is a real saved role set. A failed rebuild
 * is served the previous copy by the cache (its `known` with it); with no
 * copy at all, rbacReadOutcome's rule: built-in defaults, marked unknown.
 */
async function readServerRbac(): Promise<RbacCopy> {
  const r = await rbacCache.read();
  if (r.ok) return r.value;
  const out = rbacReadOutcome({ readOk: false, read: null, lastKnown: null, defaults: defaultRbacState });
  return { state: out.state, known: out.known };
}

/**
 * The rbac cache's own answer, for the reference view (GET
 * /api/data/views/rbac, data-layer 1.4): `ok:false` = no copy could be read
 * (the view answers 503 — never the built-in defaults dressed as the
 * school's roles); `known:false` on a copy = the database holds no saved
 * role set, so these ARE the built-in roles.
 */
export function readServerRbacCopy(): Promise<CacheRead<{ state: RbacState; known: boolean }>> {
  return rbacCache.read();
}

export async function loadServerRbac(): Promise<RbacState> {
  return (await readServerRbac()).state;
}

async function rbacWithKnown(): Promise<{ rbac: RbacState; rbacKnown: boolean }> {
  const { state, known } = await readServerRbac();
  return { rbac: state, rbacKnown: known };
}

/**
 * The school's roles, assignments and personal grants, or null when they
 * could not be read and this instance never read a good copy (a failed read
 * after a good one returns that last copy, its denies included — see
 * loadServerRbac). loadServerRbac then answers with the built-in defaults,
 * which carry no assignments and no personal denies. A session's role code must not be decided from that
 * stand-in: "no assignment" read off a failed load would strip the office
 * role from everyone who holds it by assignment.
 */
export async function loadServerRbacIfKnown(): Promise<RbacState | null> {
  const { state, known } = await readServerRbac();
  return known ? state : null;
}

/** A database is configured for this server (else there is nothing to fail). */
function serverDatabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Server-side Masters for RBAC resolution. Without the real staff roster,
 * resolveSessionRoles can never match a per-staff role assignment and every
 * request silently falls back to inferRoleCodes() regex matching — i.e. the
 * assignments made in Masters → Roles were only ever enforced in the browser.
 * Masters desk slices carry everything except staff/departments/designations,
 * which live in the sis_* roster tables; merge both. This runs on every
 * authenticated API request (single-tenant per deploy — serverTenant
 * resolves one TENANT.slug), so it is a reference cache (data-layer 1.3):
 * rebuilt when erp_versions says Masters ("masters" — masters_desk_sync_meta,
 * bumped by masters_write_slices and pushMastersDeskToDb) or the roster
 * (sis_staff, sis_departments, sis_designations: max(updated_at) + count)
 * moved, and not otherwise. Until 13 Oct 2026 it was a 30 s TTL.
 */
const MASTERS_DESK_KEYS = ["masters", "sis_staff", "sis_departments", "sis_designations"] as const;

/**
 * Unknown is never empty (data-layer 0.5c). A failed read keeps the copy
 * this process already has (the cache serves it `stale` and tries again on
 * the next read), and with no copy at all it is a 503. Until 13 Oct 2026 a
 * failed read became an empty masters book cached for 30 s, and any
 * exception became defaultMasters(): a demo book with freshly random class
 * ids, which every app request on that instance then used.
 */
async function buildServerMasters(): Promise<BuildResult<MastersState>> {
  let read: Awaited<ReturnType<typeof fetchMastersDeskFromDb>>;
  let staffBundle: Awaited<ReturnType<typeof fetchStaffRemoteServer>>;
  try {
    [read, staffBundle] = await Promise.all([fetchMastersDeskFromDb(), fetchStaffRemoteServer()]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (read.readFailed) {
    // No database at all (a local demo): nothing failed, there is nothing to read.
    if (!serverDatabaseConfigured()) return { ok: true, value: deskBundleToMastersState(read.bundle) };
    return { ok: false, error: "masters_desk_slices" };
  }
  const state = deskBundleToMastersState(read.bundle);
  // Each slice's stamp, read in the same query as its payload: an object
  // slice's (schoolProfile, …) is the base of its next kernel write, and the
  // masters view hands it out (data-layer 2.2b).
  if (read.sliceStamps) mastersSliceStamps.set(state, { ...read.sliceStamps });
  if (!staffBundle) {
    // The roster is unknown, not empty. With a copy, the cache keeps the
    // copy; without one, answer with no roster (revalidateStaffSession then
    // leaves the cookie as it is) and do not store it, so the next request
    // re-reads.
    return { ok: false, error: "staff roster", fallback: state };
  }
  if (staffBundle.staff.length > 0) state.staff = staffBundle.staff;
  if (staffBundle.departments.length > 0) {
    state.departments = staffBundle.departments;
  }
  if (staffBundle.designations.length > 0) {
    state.designations = staffBundle.designations;
  }
  return { ok: true, value: state };
}

/** The slice stamps each cached Masters copy was read with (by object identity; never in the copy itself). */
const mastersSliceStamps = new WeakMap<MastersState, Record<string, string>>();

/** The `updated_at` of each Masters slice as read for this copy; null if unknown. */
export function serverMastersSliceStamps(state: MastersState): Record<string, string> | null {
  return mastersSliceStamps.get(state) ?? null;
}

const mastersCache = referenceCache<MastersState>("masters", MASTERS_DESK_KEYS, buildServerMasters);

/** Force the next read to rebuild — call after a server-side write to sis_staff or Masters. */
export function invalidateServerMastersCache(): void {
  mastersCache.invalidate();
}

/**
 * The masters cache's own answer, for the reference views (data-layer 1.4):
 * `from: "fallback"` = Masters read, the staff roster NOT (unknown — the
 * staff-list view answers 503 for it); `ok:false` = no copy at all.
 */
export function readServerMastersCopy(): Promise<CacheRead<MastersState>> {
  return mastersCache.read();
}

/** Masters + staff roster for this request (see buildServerMasters). */
export async function loadServerMasters(): Promise<MastersState> {
  const r = await mastersCache.read();
  if (r.ok) return r.value;
  console.error(`[apiAuth] server masters read failed (${r.error}) and this process has no copy — 503`);
  throw new ApiError("server_error", "Could not read the school setup — please try again.", 503);
}

async function authFromApiKey(request: Request): Promise<ApiAuthContext | null> {
  const header = request.headers.get("authorization") || "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw.startsWith("bhb_")) return null;

  const ctx = await getServerTenantContext();
  if (!ctx) return null;

  const prefix = raw.slice(0, 12);
  const { data: row } = await ctx.sb
    .from("api_keys")
    .select("id, key_hash, scopes, is_active, expires_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("key_prefix", prefix)
    .maybeSingle();

  if (!row?.is_active) return null;
  if (row.expires_at && new Date(row.expires_at as string) < new Date()) return null;

  const want = Buffer.from(hashKey(raw));
  const have = Buffer.from(String(row.key_hash));
  if (want.length !== have.length || !timingSafeEqual(want, have)) return null;

  void trackServerWork(ctx.sb
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id));

  const session: DemoSession = {
    persona: "staff",
    fullName: `API:${prefix}`,
    roleCode: "admin",
    tenantSlug: "bhb-international",
    academicYearCode: "2025-26",
  };

  return {
    session,
    masters: await loadServerMasters(),
    ...(await rbacWithKnown()),
    authKind: "api_key",
    apiKeyId: row.id as string,
  };
}

/**
 * A signed cookie proves who signed in, not what they may do today. The
 * role it was minted with is re-derived from the roster on every request,
 * the same way login derives it (lib/staffSessionRole.ts), so a teacher
 * holding a pre-2026-08-14 cookie that says "principal" is a teacher again
 * the moment this ships — no sign-out needed. A staff record that has been
 * made inactive ends the session.
 *
 * When the roster could not be read (loadServerMasters falls back to an
 * empty default), nothing is decided: the cookie stands as it is.
 *
 * Explicit Masters → Roles assignments decide first (12 Oct 2026), so a
 * person given the office role gets roleCode "office" on their next page
 * load or API call — no sign-out. `rbac` null = roles could not be read:
 * the cookie's role is kept rather than re-guessed from the designation.
 */
export function revalidateStaffSession(
  session: DemoSession,
  masters: MastersState,
  rbac: RbacState | null,
): DemoSession {
  if (session.persona !== "staff" || !session.staffId) return session;
  const roster = masters.staff ?? [];
  if (roster.length === 0) return session;
  const me = roster.find((s) => s.id === session.staffId);
  if (!me || me.status !== "active") {
    throw new ApiError(
      "unauthorized",
      "Your staff record is not active any more — please sign in again or contact the office.",
      401,
    );
  }
  if (!rbac) return session;
  try {
    const roleCode = staffRoleCodeFor(
      { email: session.email, fullName: session.fullName, staffId: session.staffId },
      masters,
      session.roleCode,
      rbac,
    );
    return roleCode === session.roleCode ? session : { ...session, roleCode };
  } catch {
    return session;
  }
}

export async function resolveApiAuth(request: Request): Promise<ApiAuthContext> {
  const fromKey = await authFromApiKey(request);
  if (fromKey) return fromKey;

  const cookieSession = await getDemoSession();
  if (!cookieSession) {
    throw new ApiError("unauthorized", "Sign in or provide a valid API key", 401);
  }
  const [masters, knownRbac] = await Promise.all([
    loadServerMasters(),
    loadServerRbacIfKnown(),
  ]);
  const session = revalidateStaffSession(cookieSession, masters, knownRbac);

  // A family the school has made inactive (every child) is signed out of
  // the app, with the reason — not left on a screen of errors.
  if (session.persona === "parent" && session.householdId) {
    const { readFamilyRollStatus, FAMILY_INACTIVE_MESSAGE } = await import("@/lib/parentFamilyStatus.server");
    if ((await readFamilyRollStatus(session.householdId, session.academicYearCode || "")) === "inactive") {
      throw new ApiError("family_inactive", FAMILY_INACTIVE_MESSAGE, 403);
    }
  }

  return {
    session,
    masters,
    rbac: knownRbac ?? (await loadServerRbac()),
    rbacKnown: knownRbac !== null,
    authKind: "session",
  };
}

export function assertPermission(
  ctx: ApiAuthContext,
  module: RbacModule,
  action: RbacAction,
) {
  const ok = hasPermission(ctx.session, ctx.masters, module, action, ctx.rbac);
  if (!ok) {
    throw new ApiError("forbidden", `Missing permission ${module}.${action}`, 403);
  }
}

export function requestMeta(request: Request) {
  return {
    ip:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null,
    userAgent: request.headers.get("user-agent"),
  };
}
