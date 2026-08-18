/**
 * Shared API route authorization — staff session, RBAC, mirror sync secret, cron guards.
 */

import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import type { DemoSession } from "@/lib/auth";
import {
  assertPermission,
  resolveApiAuth,
  type ApiAuthContext,
} from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import type { DeskModuleId } from "@/lib/deskCutover";
import { defaultMasters, DEFAULT_AY } from "@/lib/masters";
import {
  defaultRbacState,
  hasPermission,
  type RbacAction,
  type RbacModule,
} from "@/lib/rbac";
import { TENANT } from "@/lib/types";

export type RouteAuthFailure = {
  ok: false;
  response: NextResponse;
};

export type RouteAuthSuccess = {
  ok: true;
  ctx: ApiAuthContext;
  viaMirrorSecret: boolean;
};

export type RouteAuthResult = RouteAuthFailure | RouteAuthSuccess;

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Constant-time string comparison — use for all secret/token checks. */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  try {
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function hasMirrorSyncSecret(req: Request): boolean {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  return !!(secret && header && timingSafeStringEqual(header, secret));
}

function authFailure(status: number, error: string): RouteAuthFailure {
  return {
    ok: false,
    response: NextResponse.json({ error }, { status }),
  };
}

async function buildMirrorServiceContext(): Promise<ApiAuthContext> {
  const { ensureSchoolMirrorHydrated } = await import(
    "@/lib/schoolDataMirror.server"
  );
  await ensureSchoolMirrorHydrated();
  const { getSchoolMirrorSync } = await import("@/lib/schoolDataMirror");
  const mirrored = getSchoolMirrorSync().masters;
  const masters =
    mirrored && typeof mirrored === "object" && "classes" in (mirrored as object)
      ? (mirrored as ApiAuthContext["masters"])
      : defaultMasters();
  return {
    session: {
      persona: "staff",
      fullName: "Mirror sync",
      roleCode: "admin",
      tenantSlug: TENANT.slug,
      academicYearCode: DEFAULT_AY,
    },
    masters,
    rbac: defaultRbacState(),
    authKind: "session",
  };
}

function authSuccess(
  ctx: ApiAuthContext,
  viaMirrorSecret = false,
): RouteAuthSuccess {
  return { ok: true, ctx, viaMirrorSecret };
}

export function jsonApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Cron / dispatch — open in dev when unset; fail closed in production. */
export function requireJobSecret(
  req: Request,
  envKeys: string[],
  headerNames: string[] = [],
): boolean {
  const secrets = envKeys
    .map((k) => process.env[k]?.trim())
    .filter((s): s is string => !!s);
  if (secrets.length === 0) {
    return !isProductionEnv();
  }
  const hdr =
    headerNames.map((h) => req.headers.get(h)?.trim()).find(Boolean) || "";
  const bearer = (req.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  return secrets.some(
    (s) =>
      (hdr && timingSafeStringEqual(hdr, s)) ||
      (bearer && timingSafeStringEqual(bearer, s)),
  );
}

export async function requireStaffApi(
  request: Request,
): Promise<RouteAuthResult> {
  if (hasMirrorSyncSecret(request)) {
    return authSuccess(await buildMirrorServiceContext(), true);
  }
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      return authFailure(403, "Staff session required");
    }
    return authSuccess(ctx, false);
  } catch (e) {
    return authFailure(401, e instanceof ApiError ? e.message : "Unauthorized");
  }
}

export async function requireStaffPermission(
  request: Request,
  module: RbacModule,
  action: RbacAction,
): Promise<RouteAuthResult> {
  const base = await requireStaffApi(request);
  if (!base.ok) return base;
  if (base.viaMirrorSecret) return base;
  try {
    assertPermission(base.ctx, module, action);
    return base;
  } catch (e) {
    return authFailure(403, e instanceof ApiError ? e.message : "Forbidden");
  }
}

/** School-data desk routes — staff + module RBAC (mirror secret bypasses RBAC). */
export async function authorizeSchoolDataDesk(
  request: Request,
  module: RbacModule,
  method: "GET" | "POST",
): Promise<RouteAuthResult> {
  if (hasMirrorSyncSecret(request)) {
    return authSuccess(await buildMirrorServiceContext(), true);
  }
  const action: RbacAction = method === "GET" ? "view" : "edit";
  return requireStaffPermission(request, module, action);
}

export const SCHOOL_DATA_DESK_RBAC: Record<string, RbacModule> = {
  "accounts-desk": "accounts",
  admissions: "admissions",
  "admissions-desk": "admissions",
  "attendance-registers": "attendance",
  "ensure-desk": "masters",
  "exams-desk": "exams",
  "fees-vouchers": "fees",
  "gallery-desk": "gallery",
  "homework-desk": "homework",
  "library-desk": "store",
  "masters-desk": "masters",
  "news-desk": "news",
  "notifications-desk": "notifications",
  "payment-links": "fees",
  "payroll-desk": "payroll",
  "ptm-desk": "ptm",
  "purchase-desk": "purchase",
  "rte-desk": "rte",
  "school-comms-desk": "notices",
  "sis-roster": "students",
  "staff-attendance-registers": "attendance",
  "statutory-desk": "payroll",
  "store-desk": "store",
  "student-leave-desk": "student_leave",
  "timetable-desk": "timetable",
  "transport-desk": "transport",
  "trust-desk": "trust",
  "vault-desk": "vault",
  "wa-threads-desk": "notices",
};

export const DESK_SLICE_RBAC: Partial<Record<DeskModuleId, RbacModule>> = {
  rbac: "settings",
  certificates: "certificates",
  exam_papers: "exams",
  wa_templates: "wa_templates",
  staff_hr: "staff",
  staff_advances: "staff_advances",
  staff_agreements: "staff",
  module_registry: "settings",
  fee_recovery_tasks: "fees",
  automation: "wa_automation",
  erp_chat: "settings",
  staff_chat: "settings",
};

export async function requireWaStaffApi(
  request: Request,
): Promise<RouteAuthResult> {
  const base = await requireStaffApi(request);
  if (!base.ok) return base;
  if (base.viaMirrorSecret) return base;
  const { session, masters, rbac } = base.ctx;
  const modules: RbacModule[] = [
    "admissions",
    "fees",
    "notices",
    "news",
    "notifications",
  ];
  const allowed = modules.some((m) =>
    hasPermission(session, masters, m, "view", rbac),
  );
  if (!allowed) {
    return authFailure(403, "Missing communications or admissions access");
  }
  return base;
}

export async function requireIntegrationHealthApi(
  request: Request,
): Promise<RouteAuthResult> {
  return requireStaffApi(request);
}

export type PaymentLinkAccess =
  | { ok: true; mode: "staff" | "parent" | "public"; session?: DemoSession }
  | { ok: false; response: NextResponse };

export async function authorizePaymentLinkAccess(
  request: Request,
  link: { id: string; code: string; householdId: string },
  opts?: { requireCode?: boolean; code?: string | null },
): Promise<PaymentLinkAccess> {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona === "staff") {
      if (
        hasPermission(ctx.session, ctx.masters, "fees", "view", ctx.rbac) ||
        hasPermission(ctx.session, ctx.masters, "fees", "edit", ctx.rbac)
      ) {
        return { ok: true, mode: "staff", session: ctx.session };
      }
      return {
        ok: false,
        response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
    if (
      ctx.session.persona === "parent" &&
      ctx.session.householdId &&
      ctx.session.householdId === link.householdId
    ) {
      return { ok: true, mode: "parent", session: ctx.session };
    }
  } catch {
    /* public path below */
  }

  const code = (opts?.code || "").trim().toUpperCase();
  if (code && code === link.code.toUpperCase()) {
    return { ok: true, mode: "public" };
  }
  if (opts?.requireCode !== false) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Valid payment link code required" },
        { status: 401 },
      ),
    };
  }
  return {
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}
