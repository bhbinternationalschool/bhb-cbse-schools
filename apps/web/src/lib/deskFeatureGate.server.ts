/**
 * The server side of function grants for a school-data desk route.
 *
 * A desk route used to ask one question — does this person hold the
 * module? — and answer 403 otherwise. With function grants
 * (lib/rbacFeatures.ts) a person may hold PART of the module: Transport →
 * Fuel log, Fees → Collect at the counter, Exams → Marks entry. The routes
 * call these gates instead:
 *
 *   const gate = await deskWriteGate(req, "transport");
 *   if (gate.mode === "deny") return gate.response;
 *   …read the stored desk…
 *   if (gate.mode === "feature") {
 *     const merged = featurePushOutcome(gate, "transport", stored, incoming);
 *     if (!merged.ok) return merged.response;
 *     if (!merged.changed) return featureSavedResponse(false);
 *     incoming = merged.state;            // push THIS, never the body
 *   }
 *
 * "full" is the old behaviour, unchanged. "feature" means: merge onto the
 * stored desk, lifting in only the slices of the functions held, row by row
 * (lib/deskFeatureAuth.ts). A function-only writer skips a desk's revision
 * guard — the per-row merge is what protects other people's work — and gets
 * no revision back, so their partial copy never becomes a base.
 */
import "server-only";
import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  requireStaffApi,
} from "@/lib/apiRouteAuth.server";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { authorizeFeatureChange, type FeatureAccessFn } from "@/lib/deskFeatureAuth";
import { featureAccess, type RbacAction, type RbacModule } from "@/lib/rbac";
import { featuresForModule } from "@/lib/rbacFeatures";

export type FeatureGate = {
  mode: "feature";
  ctx: ApiAuthContext;
  access: FeatureAccessFn;
  /** Classes the person teaches; null = every class (leadership/office). */
  ownClassIds: Set<string> | null;
};

export type DeskGate =
  | { mode: "full" }
  | FeatureGate
  | { mode: "deny"; response: NextResponse };

const WRITES: RbacAction[] = ["create", "edit", "delete"];

async function featureGate(
  req: Request,
  module: RbacModule,
  actions: RbacAction[],
): Promise<FeatureGate | null> {
  const staff = await requireStaffApi(req);
  if (!staff.ok || staff.viaMirrorSecret) return null;
  const ctx = staff.ctx;
  const access: FeatureAccessFn = (featureId, action) =>
    featureAccess(ctx.session, ctx.masters, featureId, action, ctx.rbac);
  const held = featuresForModule(module).filter((f) =>
    actions.some((a) => access(f.id, a).allowed),
  );
  if (held.length === 0) return null;

  let ownClassIds: Set<string> | null = null;
  if (held.some((f) => f.classScoped)) {
    try {
      const scope = await staffSectionScope(ctx);
      if (!scope.unrestricted) {
        ownClassIds = new Set([...scope.sections].map((k) => k.split("|")[0]!));
      }
    } catch {
      // Scope unreadable → no classes, not every class.
      ownClassIds = new Set();
    }
  }
  return { mode: "feature", ctx, access, ownClassIds };
}

/** POST: the whole module (unchanged), some of its functions, or 403. */
export async function deskWriteGate(req: Request, module: RbacModule): Promise<DeskGate> {
  const auth = await authorizeSchoolDataDesk(req, module, "POST");
  if (auth.ok) return { mode: "full" };
  if (auth.response.status !== 403) return { mode: "deny", response: auth.response };
  const gate = await featureGate(req, module, WRITES);
  return gate ?? { mode: "deny", response: auth.response };
}

/** GET: the whole module, or — holding a function — that function's slices. */
export async function deskReadGate(req: Request, module: RbacModule): Promise<DeskGate> {
  const auth = await authorizeSchoolDataDesk(req, module, "GET");
  if (auth.ok) return { mode: "full" };
  if (auth.response.status !== 403) return { mode: "deny", response: auth.response };
  const gate = await featureGate(req, module, ["view", ...WRITES]);
  return gate ?? { mode: "deny", response: auth.response };
}

export function featurePushOutcome(
  gate: FeatureGate,
  module: RbacModule,
  stored: object,
  incoming: object,
  classLabel?: (classId: string) => string,
):
  | { ok: true; changed: boolean; state: Record<string, unknown> }
  | { ok: false; response: NextResponse } {
  const verdict = authorizeFeatureChange(
    module,
    stored as Record<string, unknown>,
    incoming as Record<string, unknown>,
    gate.access,
    gate.ownClassIds,
    classLabel,
  );
  const who = gate.ctx.session.staffId || "?";
  if (!verdict.ok) {
    console.warn(`[${module}-desk] refused function-only push from ${who}: ${verdict.reason}`);
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: verdict.reason, reason: "feature_forbidden" },
        { status: 403 },
      ),
    };
  }
  if (verdict.changedSlices.length > 0) {
    console.info(`[${module}-desk] function-only push by ${who}: ${verdict.changedSlices.join(", ")}`);
  }
  return { ok: true, changed: verdict.changedSlices.length > 0, state: verdict.merged };
}

/** The reply to a function-only save: no revision, on purpose. */
export function featureSavedResponse(changed: boolean): NextResponse {
  return NextResponse.json({ ok: true, functionOnly: true, changed, unchanged: !changed });
}

/**
 * A desk bundle cut down to what a function holder may see: the slices of
 * the functions they hold. Any other list comes back empty, and a settings
 * object owned by a function they do not hold is left out (the client's
 * normaliser fills its default). Unowned settings stay — they are the
 * module's shared configuration, not someone's records.
 */
export function stripDeskForFeatures<T extends object>(
  module: RbacModule,
  bundle: T,
  gate: FeatureGate,
): T & { functionOnly: true } {
  const visible = new Set<string>();
  const owned = new Set<string>();
  for (const f of featuresForModule(module)) {
    for (const k of f.slices ?? []) {
      owned.add(k);
      if (["view", ...WRITES].some((a) => gate.access(f.id, a as RbacAction).allowed)) visible.add(k);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bundle as Record<string, unknown>)) {
    if (visible.has(k)) out[k] = v;
    else if (Array.isArray(v)) out[k] = [];
    else if (owned.has(k)) continue;
    else out[k] = v;
  }
  return { ...(out as T), functionOnly: true };
}
