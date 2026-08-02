import { createHash, timingSafeEqual } from "crypto";
import { getDemoSession, type DemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { defaultMasters, type MastersState } from "@/lib/masters";
import {
  defaultRbacState,
  hasPermission,
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
  if (state?.roles?.length) return state;
  return defaultRbacState();
}

async function loadServerMasters(): Promise<MastersState> {
  await ensureSchoolMirrorHydrated();
  const { getSchoolMirrorSync } = await import("@/lib/schoolDataMirror");
  const m = getSchoolMirrorSync().masters as MastersState | null;
  return m && m.classes ? m : defaultMasters();
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
