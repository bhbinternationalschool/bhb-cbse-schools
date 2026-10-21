/**
 * The pure decision behind lib/data/server/sliceFunctionGate.ts (data-layer
 * 2.2b): may these element ops of one Masters list be written by this
 * person? No I/O — the gate hands in the stored elements and the access
 * function; self-tested in sliceFunctionRules.selftest.ts. The refusal words
 * are deskFeatureAuth's, so the browser toasts them the same way.
 */
import type { RbacAction } from "@/lib/rbac";
import type { RbacFeatureDef } from "@/lib/rbacFeatureCatalog/types";
import type { WriteOp } from "../types";

type Row = Record<string, unknown>;

export type SliceGateVerdict =
  | { ok: true }
  | { ok: false; status: 403 | 404 | 503; kind: "auth" | "not_found" | "unavailable"; message: string };

const WORD: Partial<Record<RbacAction, string>> = { create: "add", edit: "change", delete: "remove" };

export function decideSliceOps(input: {
  feature: RbacFeatureDef;
  ops: readonly WriteOp<Row>[];
  /** Stored elements by id (absent = a new element). */
  stored: ReadonlyMap<string, Row>;
  access: (featureId: string, action: RbacAction) => { allowed: boolean; ownClassesOnly: boolean };
  /** The person's classes; null = every class. */
  ownClassIds: ReadonlySet<string> | null;
  mode: "module" | "function";
  classLabel?: (classId: string) => string;
}): SliceGateVerdict {
  const { feature: f, ops, stored, access, ownClassIds, mode } = input;
  const label = input.classLabel ?? ((id: string) => id || "That class");
  const what = f.label.toLowerCase();
  const ck = f.classKey || "classId";
  for (const op of ops) {
    const before = stored.get(op.id) ?? null;
    const action: RbacAction = op.op === "delete" ? "delete" : before ? "edit" : "create";
    // A delete of an element that is not there changes nothing: let the kernel say "deleted".
    if (op.op === "delete" && !before) continue;
    const a = access(f.id, action);
    if (!a.allowed) {
      return {
        ok: false,
        status: 403,
        kind: "auth",
        message:
          mode === "module"
            ? `You may not ${WORD[action] ?? action} ${what} — it is turned off for you; ask the office to give your role this.`
            : `You may not ${WORD[action] ?? action} ${what} — ask the office to give your role this.`,
      };
    }
    if (f.classScoped && a.ownClassesOnly && ownClassIds) {
      const row = op.op === "upsert" ? ((op as { row?: Row }).row ?? {}) : {};
      const classesTouched = new Set<string>();
      if (before) classesTouched.add(String(before[ck] ?? ""));
      if (op.op === "upsert") classesTouched.add(String(row[ck] ?? before?.[ck] ?? ""));
      for (const c of classesTouched) {
        if (!c || !ownClassIds.has(c)) {
          return {
            ok: false,
            status: 403,
            kind: "auth",
            message: `${label(c)} is not one of your classes — you may change ${what} only for the classes you teach.`,
          };
        }
      }
    }
  }
  return { ok: true };
}
