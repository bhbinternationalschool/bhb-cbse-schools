import { NextResponse } from "next/server";
import {
  DESK_SLICE_RBAC,
  requireStaffApi,
  requireStaffPermission,
} from "@/lib/apiRouteAuth.server";
import type { DeskModuleId } from "@/lib/deskCutover";
import { hasPermission } from "@/lib/rbac";
import {
  deskFeatureGateFor,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
  visibleSlices,
  type FeatureGate,
} from "@/lib/deskFeatureGate.server";
import { deskSliceDef, deskSliceEnvDualWrite } from "@/lib/deskSliceRegistry";
import {
  fetchDeskSliceFromDb,
  pushDeskSliceToDb,
} from "@/lib/deskSliceNormalized.server";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ module: string }> };

function parseModuleId(raw: string): DeskModuleId | null {
  const def = deskSliceDef(raw as DeskModuleId);
  return def ? (raw as DeskModuleId) : null;
}

/**
 * Roles & permissions as ONE member of staff needs them: every role's
 * definition, but only their own assignments and grants, and no audit log.
 *
 * Reading the rbac desk needs Settings, so until 2026-09-29 a teacher's
 * browser never learned what the school had configured — it fell back to
 * the built-in defaults, ignored any class-scoped assignment, and the page
 * gate sat on "Checking access…" waiting for a desk it would never get.
 */
async function ownRbacResponse(req: Request): Promise<NextResponse | null> {
  const staff = await requireStaffApi(req);
  if (!staff.ok || staff.viaMirrorSecret) return null;
  const session = staff.ctx.session;
  if (session.persona !== "staff") return null;
  const { bundle, meta, ok } = await fetchDeskSliceFromDb("rbac");
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Desk read failed" }, { status: 503 });
  }
  const me = session.staffId || "";
  const mine = (rows: unknown) =>
    Array.isArray(rows)
      ? rows.filter((r) => !!me && (r as { staffId?: string }).staffId === me)
      : [];
  const b = bundle as Record<string, unknown>;
  return NextResponse.json({
    ok: true,
    ...b,
    assignments: mine(b.assignments),
    userGrants: mine(b.userGrants),
    audit: [],
    ownOnly: true,
    rowCount: meta?.rowCount ?? 0,
    updatedAt: meta?.updatedAt || "",
  });
}

/** A function holder's read: their slices of this desk, the rest empty. */
async function featureReadResponse(id: DeskModuleId, gate: FeatureGate): Promise<NextResponse> {
  const { bundle, meta, ok, error } = await fetchDeskSliceFromDb(id);
  if (!ok) {
    return NextResponse.json({ ok: false, error: error || "Desk read failed" }, { status: 503 });
  }
  const rbacModule = DESK_SLICE_RBAC[id] ?? "settings";
  return NextResponse.json(
    {
      ok: true,
      ...stripDeskForFeatures(rbacModule, bundle as Record<string, unknown>, gate, { prefix: `${id}/` }),
      rowCount: meta?.rowCount ?? 0,
      // No revision: this copy is partial and must never be a base.
      updatedAt: "",
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(req: Request, ctx: RouteCtx) {
  const { module } = await ctx.params;
  const id = parseModuleId(module);
  if (!id) {
    return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  }
  const rbacModule = DESK_SLICE_RBAC[id] ?? "settings";
  const auth = await requireStaffPermission(req, rbacModule, "view");
  if (!auth.ok) {
    if (id === "rbac" && auth.response.status === 403) {
      const self = await ownRbacResponse(req);
      if (self) return self;
    }
    // Functions of the module (Masters → Roles): their slices of this desk,
    // named "<desk>/<key>" in lib/rbacFeatureCatalog.
    if (auth.response.status === 403) {
      const gate = await deskFeatureGateFor(req, rbacModule, "read");
      if (gate) return featureReadResponse(id, gate);
    }
    return auth.response;
  }

  const { bundle, meta, ok, error } = await fetchDeskSliceFromDb(id);
  // Staff HR (every colleague's leave, balances and appraisals) is read with
  // staff.view — which teachers, accounts, transport and the auditor hold.
  // Without staff.edit: the school's leave types and settings, and your own
  // rows only.
  if (ok && id === "staff_hr" && !auth.viaMirrorSecret) {
    const canEdit = hasPermission(auth.ctx.session, auth.ctx.masters, "staff", "edit", auth.ctx.rbac);
    if (!canEdit) {
      const me = auth.ctx.session.staffId || "";
      const b = bundle as Record<string, unknown>;
      // A Staff function (e.g. leave approvals) shows its slices whole.
      const fGate = await deskFeatureGateFor(req, "staff", "read");
      const whole = fGate ? visibleSlices("staff", fGate, "staff_hr/") : new Set<string>();
      const ownOf = (key: string) => (rows: unknown) =>
        whole.has(key)
          ? rows
          : Array.isArray(rows)
            ? rows.filter((r) => !!me && (r as { staffId?: string }).staffId === me)
            : [];
      return NextResponse.json(
        {
          ok: true,
          ...b,
          leaveRequests: ownOf("leaveRequests")(b.leaveRequests),
          leaveBalances: ownOf("leaveBalances")(b.leaveBalances),
          leaveEncashments: ownOf("leaveEncashments")(b.leaveEncashments),
          leaveAllotmentLog: ownOf("leaveAllotmentLog")(b.leaveAllotmentLog),
          appraisals: ownOf("appraisals")(b.appraisals),
          ownOnly: true,
          rowCount: meta?.rowCount ?? 0,
          updatedAt: meta?.updatedAt || "",
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
  }
  if (!ok) {
    // Unknown, not empty. Returning ok:true with an empty bundle stamped
    // "now" made every client take the empty desk as newer than its cache.
    return NextResponse.json(
      { ok: false, error: error || "Desk read failed" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    ...bundle,
    rowCount: meta?.rowCount ?? 0,
    // No sync meta yet = never written; report an empty stamp so the client
    // decides on row counts, not on a timestamp we invented.
    updatedAt: meta?.updatedAt || "",
    meta,
  });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const { module } = await ctx.params;
  const id = parseModuleId(module);
  if (!id) {
    return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  }
  const rbacModule = DESK_SLICE_RBAC[id] ?? "settings";
  const auth = await requireStaffPermission(req, rbacModule, "edit");
  // Functions of the module may save their slices of this desk only.
  let featureGate: FeatureGate | null = null;
  if (!auth.ok) {
    if (auth.response.status !== 403 || id === "rbac") return auth.response;
    featureGate = await deskFeatureGateFor(req, rbacModule, "write");
    if (!featureGate) return auth.response;
  }

  const def = deskSliceDef(id)!;
  if (!deskSliceEnvDualWrite(def.envPrefix)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `${def.envPrefix}_DUAL_WRITE_DB disabled`,
    });
  }

  let body: { version: number } & Record<string, unknown>;
  try {
    body = (await req.json()) as { version: number } & Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // A deliberate bulk deletion says so in the request. Nothing sets this
  // today: it exists so that a screen which really does clear a desk has a
  // way through the shrink guard, rather than the guard being loosened for
  // everyone the first time it fires.
  const allowShrink =
    !featureGate && new URL(req.url).searchParams.get("allowShrink") === "1";
  if (featureGate) {
    const stored = await fetchDeskSliceFromDb(id);
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved desk — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const merged = featurePushOutcome(
      featureGate,
      rbacModule,
      stored.bundle as Record<string, unknown>,
      body,
      undefined,
      { prefix: `${id}/` },
    );
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    body = { ...(merged.state as typeof body), version: body.version };
  }
  const result = await pushDeskSliceToDb(id, body, { allowShrink });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }
  if (id === "rbac") {
    const { invalidateServerRbacCache } = await import("@/lib/api/v1/auth");
    invalidateServerRbacCache();
  }

  if (featureGate) return featureSavedResponse(true);
  const { meta } = await fetchDeskSliceFromDb(id);
  return NextResponse.json({
    ok: true,
    rowCount: meta?.rowCount ?? 0,
    // The revision the desk actually recorded, not a fresh client-facing
    // clock reading that would differ from the stored one.
    updatedAt: meta?.updatedAt || new Date().toISOString(),
  });
}
