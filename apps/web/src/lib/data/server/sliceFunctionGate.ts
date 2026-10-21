/**
 * Who may write a Masters list element through POST /api/data/<collection>
 * (data-layer 2.2b), op by op — the generic route's version of what the old
 * masters-desk POST decided for a whole pushed book (lib/deskFeatureAuth):
 *
 *  - mode "module" (the person holds the collection's module · edit): yes,
 *    unless the office turned the FUNCTION that owns this list off for them
 *    for the action (Masters → Roles → Assign to user — a personal deny).
 *  - mode "function" (they do not hold the module): only if one of their
 *    roles holds the function that owns this list for the action (create /
 *    edit / delete, decided from the STORED element: absent = create), and —
 *    for a class-scoped function (masters.class_subjects) — only in a class
 *    they teach: the stored element's class AND the written one's.
 *
 * The decision is pure (`decideSliceOps`, self-tested); `sliceFunctionGate`
 * reads the stored elements and the person's classes for it.
 */
import "server-only";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { deskFeatureGateFor } from "@/lib/deskFeatureGate.server";
import { featureAccess, isFeaturePersonallyDenied, type RbacAction, type RbacModule } from "@/lib/rbac";
import { RBAC_FEATURES } from "@/lib/rbacFeatures";
import { collectionKind, type CollectionDef } from "../registry";
import type { WriteOp } from "../types";
import { decideSliceOps, type SliceGateVerdict } from "./sliceFunctionRules";
import { readSliceElements } from "./repo";

type Row = Record<string, unknown>;

export async function sliceFunctionGate(
  req: Request,
  def: CollectionDef,
  ops: readonly WriteOp<Row>[],
  mode: "module" | "function",
  ctx: ApiAuthContext,
): Promise<SliceGateVerdict> {
  const src = def.slice;
  if (!src) return { ok: false, status: 404, kind: "not_found", message: "Unknown slice collection" };
  const module = def.module as RbacModule;
  const feature = RBAC_FEATURES.find((f) => f.module === module && f.slices?.includes(src.key)) ?? null;
  if (!feature) {
    return mode === "module" ? { ok: true } : { ok: false, status: 403, kind: "auth", message: "Forbidden" };
  }

  let access: (featureId: string, action: RbacAction) => { allowed: boolean; ownClassesOnly: boolean };
  let ownClassIds: Set<string> | null = null;
  if (mode === "module") {
    access = (featureId, action) => ({
      allowed: !isFeaturePersonallyDenied(ctx.session, ctx.masters, featureId, action, ctx.rbac),
      ownClassesOnly: false,
    });
  } else {
    // Roles unreadable, or no function of this module held: refused.
    const gate = await deskFeatureGateFor(req, module, "write");
    if (!gate) return { ok: false, status: 403, kind: "auth", message: "Forbidden" };
    access = (featureId, action) => featureAccess(ctx.session, ctx.masters, featureId, action, ctx.rbac);
    ownClassIds = gate.ownClassIds;
  }

  let stored: Map<string, Row>;
  if (collectionKind(def) === "object") {
    stored = new Map([[src.key, {}]]); // an object slice is only ever edited
  } else {
    try {
      stored = await readSliceElements(src, ops.map((o) => o.id));
    } catch (e) {
      return {
        ok: false,
        status: 503,
        kind: "unavailable",
        message: `Could not read the stored list to check this change — nothing was saved (${e instanceof Error ? e.message : String(e)}).`,
      };
    }
  }
  const classes = new Map((ctx.masters.classes ?? []).map((c) => [c.id, c.name]));
  return decideSliceOps({
    feature,
    ops,
    stored,
    access,
    ownClassIds,
    mode,
    classLabel: (id) => classes.get(id) || id || "That class",
  });
}
