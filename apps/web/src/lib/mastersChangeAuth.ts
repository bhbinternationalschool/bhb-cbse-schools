/**
 * A Masters save from someone who holds FUNCTIONS of Masters, not the whole
 * module (lib/rbacFeatures.ts). Director, 6 Oct 2026: a teacher adds,
 * changes and removes the subjects of the classes they teach — and nothing
 * else in Masters.
 *
 * Such a person's browser does not even hold the whole desk (GET serves
 * staff the teaching subset, with fee heads etc. empty), so their push is
 * never taken as a whole. The server starts from the STORED state and lifts
 * in only the slices the person holds a function for; every row added,
 * changed or removed in those slices must be an action they hold, and — for
 * class-scoped functions held by a teacher — in a class they teach. One row
 * out of bounds refuses the whole save, with the reason.
 *
 * Pure: no I/O, so the rules are tested directly (mastersChangeAuth.selftest).
 */
import type { RbacAction } from "@/lib/rbac";
import {
  MASTERS_UNCHECKED_KEYS,
  RBAC_FEATURES,
  type RbacFeatureDef,
} from "@/lib/rbacFeatures";

export type FeatureAccessFn = (
  featureId: string,
  action: RbacAction,
) => { allowed: boolean; ownClassesOnly: boolean };

export type MastersChangeVerdict =
  | { ok: true; merged: Record<string, unknown>; changedSlices: string[] }
  | { ok: false; reason: string };

type Row = { id?: unknown; classId?: unknown } & Record<string, unknown>;

function rowsById(v: unknown): Map<string, Row> | null {
  if (!Array.isArray(v)) return null;
  const m = new Map<string, Row>();
  for (const r of v) {
    if (!r || typeof r !== "object") return null;
    const id = (r as Row).id;
    if (typeof id !== "string" || !id) return null;
    m.set(id, r as Row);
  }
  return m;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const ACTION_WORD: Partial<Record<RbacAction, string>> = {
  view: "see",
  create: "add",
  edit: "change",
  delete: "remove",
};

/**
 * @param stored   the saved Masters (server read)
 * @param incoming the pushed Masters
 * @param access   what this person may do per function (rbac.featureAccess)
 * @param ownClassIds the classes a teacher teaches; null = every class
 * @param classLabel  names a class in a refusal (id → "Class 6")
 */
export function authorizeMastersFeatureChange(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  access: FeatureAccessFn,
  ownClassIds: Set<string> | null,
  classLabel: (classId: string) => string = (id) => id,
): MastersChangeVerdict {
  const merged: Record<string, unknown> = { ...stored };
  const changedSlices: string[] = [];

  const writable = (f: RbacFeatureDef) =>
    (["create", "edit", "delete"] as RbacAction[]).some((a) => access(f.id, a).allowed);

  for (const f of RBAC_FEATURES) {
    if (f.module !== "masters" || !f.mastersSlices?.length || !writable(f)) continue;
    for (const key of f.mastersSlices) {
      if (MASTERS_UNCHECKED_KEYS.has(key)) continue;
      if (!(key in incoming)) continue;
      const before = stored[key];
      const after = incoming[key];
      if (same(before, after)) continue;

      const deny = (action: RbacAction, classId?: string): string | null => {
        const a = access(f.id, action);
        if (!a.allowed) {
          return `You may not ${ACTION_WORD[action] ?? action} ${f.label.toLowerCase()} — ask the office to give your role this.`;
        }
        if (f.classScoped && a.ownClassesOnly && ownClassIds) {
          if (!classId || !ownClassIds.has(classId)) {
            return `${classLabel(classId || "")} is not one of your classes — you may change ${f.label.toLowerCase()} only for the classes you teach.`;
          }
        }
        return null;
      };

      const oldRows = rowsById(before ?? []);
      let newRows = rowsById(after ?? []);
      let effective: unknown = after;
      const ownOnly =
        !!f.classScoped &&
        !!ownClassIds &&
        (["create", "edit", "delete"] as RbacAction[]).some((a) => access(f.id, a).ownClassesOnly);
      if (oldRows && newRows && ownOnly) {
        // A teacher's push speaks for their own classes only. Their browser
        // holds no desk revision (it is served the teaching subset), so its
        // copy of OTHER classes may be stale — another teacher's change
        // since. Those rows are taken from the stored desk, never from the
        // push. A brand-new row for another class is a real attempt and
        // is refused below.
        const mine = (r: Row) => ownClassIds!.has(String(r.classId ?? ""));
        const rows: Row[] = [];
        // Stored order is kept: own-class rows take the pushed version (or
        // go, if the push removed them); other classes stay as stored.
        for (const r of (before as Row[] | undefined) ?? []) {
          if (!mine(r)) {
            const moved = newRows.get(String(r.id));
            if (moved && mine(moved)) {
              return {
                ok: false,
                reason: `${classLabel(String(r.classId ?? ""))} is not one of your classes — you may change ${f.label.toLowerCase()} only for the classes you teach.`,
              };
            }
            rows.push(r);
            continue;
          }
          const pushed = newRows.get(String(r.id));
          if (pushed) rows.push(pushed);
        }
        // New rows, in push order. One for another class is refused below.
        for (const r of after as Row[]) if (!oldRows.has(String(r.id))) rows.push(r);
        newRows = rowsById(rows)!;
        effective = rows;
        if (same(before, effective)) continue;
      }
      if (oldRows && newRows) {
        for (const [id, row] of newRows) {
          const prev = oldRows.get(id);
          if (!prev) {
            const why = deny("create", String(row.classId ?? ""));
            if (why) return { ok: false, reason: why };
          } else if (!same(prev, row)) {
            // A row that moves class must be allowed in both.
            const why =
              deny("edit", String(prev.classId ?? "")) ??
              (f.classScoped && prev.classId !== row.classId
                ? deny("edit", String(row.classId ?? ""))
                : null);
            if (why) return { ok: false, reason: why };
          }
        }
        for (const [id, prev] of oldRows) {
          if (newRows.has(id)) continue;
          const why = deny("delete", String(prev.classId ?? ""));
          if (why) return { ok: false, reason: why };
        }
      } else {
        // A settings object (school timing, profile, …): one edit. A
        // class-scoped function is always an id'd list, so a shape it
        // cannot read is refused rather than waved through.
        if (f.classScoped) {
          return { ok: false, reason: `The ${f.label.toLowerCase()} list could not be read — nothing was saved.` };
        }
        const why = deny("edit");
        if (why) return { ok: false, reason: why };
      }
      merged[key] = effective;
      changedSlices.push(key);
    }
  }

  return { ok: true, merged, changedSlices };
}
