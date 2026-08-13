import { createHash, timingSafeEqual } from "crypto";
import { getDemoSession, type DemoSession } from "@/lib/auth";
import { defaultMasters, type MastersState } from "@/lib/masters";
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

export type ApiAuthContext = {
  session: DemoSession;
  masters: MastersState;
  rbac: RbacState;
  authKind: "session" | "api_key";
  apiKeyId?: string;
};

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function loadServerRbac(): Promise<RbacState> {
  const ctx = await getServerTenantContext();
  if (!ctx) return defaultRbacState();
  const { data } = await ctx.sb
    .from("rbac_state")
    .select("state")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  const state = data?.state as RbacState | undefined;
  // normalizeRbacState merges any built-in module grant missing from a
  // persisted role (e.g. a module added after this tenant's rbac_state row
  // was last saved) onto that role — the same merge loadRbac() already does
  // client-side. Skipping it here silently denies every module added after
  // go-live until someone happens to re-save Settings → Roles.
  if (state?.roles?.length) return normalizeRbacState(state);
  return defaultRbacState();
}

/**
 * Server-side Masters for RBAC resolution. Without the real staff roster,
 * resolveSessionRoles can never match a per-staff role assignment and every
 * request silently falls back to inferRoleCodes() regex matching — i.e. the
 * assignments made in Masters → Roles were only ever enforced in the browser.
 * Masters desk slices carry everything except staff/departments/designations,
 * which live in the sis_* roster tables; merge both. Cached briefly because
 * this runs on every authenticated API request (single-tenant per deploy —
 * serverTenant resolves one TENANT.slug).
 */
const MASTERS_CACHE_TTL_MS = 30_000;
let mastersCache: { state: MastersState; at: number } | null = null;

export async function loadServerMasters(): Promise<MastersState> {
  const now = Date.now();
  if (mastersCache && now - mastersCache.at < MASTERS_CACHE_TTL_MS) {
    return mastersCache.state;
  }
  try {
    const [{ bundle }, staffBundle] = await Promise.all([
      fetchMastersDeskFromDb(),
      fetchStaffRemoteServer(),
    ]);
    const state = deskBundleToMastersState(bundle);
    if (staffBundle) {
      if (staffBundle.staff.length > 0) state.staff = staffBundle.staff;
      if (staffBundle.departments.length > 0) {
        state.departments = staffBundle.departments;
      }
      if (staffBundle.designations.length > 0) {
        state.designations = staffBundle.designations;
      }
    }
    mastersCache = { state, at: now };
    return state;
  } catch (e) {
    console.warn("[apiAuth] server masters load failed", e);
    return defaultMasters();
  }
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

  void ctx.sb
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id);

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
    rbac: await loadServerRbac(),
    authKind: "api_key",
    apiKeyId: row.id as string,
  };
}

export async function resolveApiAuth(request: Request): Promise<ApiAuthContext> {
  const fromKey = await authFromApiKey(request);
  if (fromKey) return fromKey;

  const session = await getDemoSession();
  if (!session) {
    throw new ApiError("unauthorized", "Sign in or provide a valid API key", 401);
  }

  return {
    session,
    masters: await loadServerMasters(),
    rbac: await loadServerRbac(),
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
