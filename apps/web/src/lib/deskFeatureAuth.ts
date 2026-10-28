/**
 * A desk save from someone who holds FUNCTIONS of a module, not the whole
 * module (lib/rbacFeatures.ts). Director, 6 Oct 2026: "make user role assign
 * like every module and their functionality" — first Masters (a teacher
 * adds, changes and removes the subjects of the classes they teach), then
 * every module.
 *
 * Such a person's push is never taken as a whole: their browser may hold a
 * partial or stale copy (a desk GET serves them only their functions'
 * slices). The server starts from the STORED desk and lifts in only the
 * slices the person holds a function for; every row added, changed or
 * removed in those slices must be an action they hold, and — for
 * class-scoped functions — in a class they teach. One row out of bounds
 * refuses the whole save, with the reason.
 *
 * Pure: no I/O, so the rules are tested directly (mastersChangeAuth.selftest).
 */
import type { RbacAction, RbacModule } from "@/lib/rbac";
import {
  DESK_UNCHECKED_KEYS,
  RBAC_FEATURES,
  type RbacFeatureDef,
} from "@/lib/rbacFeatures";

export type FeatureAccessFn = (
  featureId: string,
  action: RbacAction,
) => { allowed: boolean; ownClassesOnly: boolean };

export type DeskChangeVerdict =
  | { ok: true; merged: Record<string, unknown>; changedSlices: string[] }
  | { ok: false; reason: string };

type Row = { id?: unknown } & Record<string, unknown>;

/**
 * Is this server message one of this check's refusals? The browser toasts
 * these — a person told what their role may not do — but not every other
 * 403, many of which are background pushes refused by design (a teacher's
 * browser pushing exam setup on every marks save).
 */
export function isFeatureRefusalMessage(msg: string | null | undefined): boolean {
  return (
    !!msg &&
    // The last two: staff records' protected fields (lib/staffProtectedFields, 2.2b).
    /(ask the office to give your role this\.|only for the classes you teach\.|could not be read — nothing was saved\.|or with the bank & pay details function\.|only the owner changes a sign-in link\.)$/.test(
      msg.trim(),
    )
  );
}

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

/** Key order does not make a row different: the database and the browser
 * build the same row with keys in different orders. Nor does `_rev`: since
 * data-layer 2.2a the server owns every Masters element's `_rev` (the
 * masters_desk_slices_carry_revs trigger keeps the stored one whatever a
 * writer sends), so a copy holding an older `_rev` — or none — of a row it
 * did not change has not changed it. Compared with `_rev`, a function
 * holder's re-push after anyone else's save was refused "You may not …". */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      if (k === "_rev") continue;
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = stable(x);
    }
    return out;
  }
  return v;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));
}

const ACTION_WORD: Partial<Record<RbacAction, string>> = {
  view: "see",
  create: "add",
  edit: "change",
  delete: "remove",
};

/**
 * @param module   the desk's module
 * @param stored   the saved desk (server read)
 * @param incoming the pushed desk
 * @param access   what this person may do per function (rbac.featureAccess)
 * @param ownClassIds the classes a teacher teaches; null = every class
 * @param classLabel  names a class in a refusal (id → "Class 6")
 */
export function authorizeFeatureChange(
  module: RbacModule,
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  access: FeatureAccessFn,
  ownClassIds: Set<string> | null,
  classLabel: (classId: string) => string = (id) => id,
): DeskChangeVerdict {
  const merged: Record<string, unknown> = { ...stored };
  const changedSlices: string[] = [];

  const writable = (f: RbacFeatureDef) =>
    (["create", "edit", "delete"] as RbacAction[]).some((a) => access(f.id, a).allowed);

  for (const f of RBAC_FEATURES) {
    if (f.module !== module || !f.slices?.length || !writable(f)) continue;
    const ck = f.classKey || "classId";
    const unchecked = DESK_UNCHECKED_KEYS[module];
    for (const key of f.slices) {
      if (key === "version" || unchecked?.has(key)) continue;
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
        const mine = (r: Row) => ownClassIds!.has(String(r[ck] ?? ""));
        const rows: Row[] = [];
        // Stored order is kept: own-class rows take the pushed version (or
        // go, if the push removed them); other classes stay as stored.
        for (const r of (before as Row[] | undefined) ?? []) {
          if (!mine(r)) {
            const moved = newRows.get(String(r.id));
            if (moved && mine(moved)) {
              return {
                ok: false,
                reason: `${classLabel(String(r[ck] ?? ""))} is not one of your classes — you may change ${f.label.toLowerCase()} only for the classes you teach.`,
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
            const why = deny("create", String(row[ck] ?? ""));
            if (why) return { ok: false, reason: why };
          } else if (!same(prev, row)) {
            // A row that moves class must be allowed in both.
            const why =
              deny("edit", String(prev[ck] ?? "")) ??
              (f.classScoped && prev[ck] !== row[ck]
                ? deny("edit", String(row[ck] ?? ""))
                : null);
            if (why) return { ok: false, reason: why };
          }
        }
        if (f.unionRows) {
          // The server merges this store by id: a row missing from the push
          // is a stale copy, not a deletion. Keep the stored row.
          const kept = [...((before as Row[] | undefined) ?? [])].filter(
            (r) => !newRows!.has(String(r.id)),
          );
          if (kept.length > 0) {
            effective = [...(effective as Row[]), ...kept];
            if (same(before, effective)) continue;
          }
        } else {
          for (const [id, prev] of oldRows) {
            if (newRows.has(id)) continue;
            const why = deny("delete", String(prev[ck] ?? ""));
            if (why) return { ok: false, reason: why };
          }
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

/**
 * A save from someone who DOES hold the whole module, but whom the office
 * has personally denied some action on one of its functions (Masters →
 * Roles → Assign to user, 12 Oct 2026). Their push is taken as it is — the
 * module grant stands — except that a slice owned by a denied function may
 * not change in a way that needs the denied action. One such change refuses
 * the whole save, with the reason; nothing is silently dropped.
 *
 * Rows are compared by id: a new id needs `create`, a changed row `edit`,
 * and a row the save NAMES as deleted needs `delete` (saves never delete by
 * absence). A slice that is not an id'd list needs `edit` to change at all.
 * A row someone else changed since this browser loaded reads as a change
 * too — the refusal is visible, never a silent overwrite of the deny.
 *
 * @param denied true when this person is personally denied `action` on the function
 * @param deletes ids the save names as deleted, per slice key (when known)
 */
export function deniedSliceChange(
  module: RbacModule,
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  denied: (featureId: string, action: RbacAction) => boolean,
  deletes: Record<string, readonly string[]> = {},
): string | null {
  const unchecked = DESK_UNCHECKED_KEYS[module];
  const refuse = (f: RbacFeatureDef, action: RbacAction) =>
    `You may not ${ACTION_WORD[action] ?? action} ${f.label.toLowerCase()} — it is turned off for you; ask the office to give your role this.`;
  for (const f of RBAC_FEATURES) {
    if (f.module !== module || !f.slices?.length) continue;
    const writesDenied = (["create", "edit", "delete"] as RbacAction[]).filter((a) => denied(f.id, a));
    if (writesDenied.length === 0) continue;
    for (const key of f.slices) {
      if (key === "version" || unchecked?.has(key)) continue;
      const named = deletes[key] ?? [];
      if (named.length) {
        const before = rowsById(stored[key] ?? []);
        if (named.some((id) => !before || before.has(id)) && denied(f.id, "delete")) return refuse(f, "delete");
      }
      if (!(key in incoming)) continue;
      const before = stored[key];
      const after = incoming[key];
      if (same(before, after)) continue;
      const oldRows = rowsById(before ?? []);
      const newRows = rowsById(after ?? []);
      if (!oldRows || !newRows) {
        if (denied(f.id, "edit")) return refuse(f, "edit");
        continue;
      }
      for (const [id, row] of newRows) {
        const prev = oldRows.get(id);
        if (!prev) {
          if (denied(f.id, "create")) return refuse(f, "create");
        } else if (!same(prev, row)) {
          if (denied(f.id, "edit")) return refuse(f, "edit");
        }
      }
    }
  }
  return null;
}

/** Does any function of this module that owns desk slices carry a denied write? */
export function moduleHasDeniedSliceWrites(
  module: RbacModule,
  denied: (featureId: string, action: RbacAction) => boolean,
): boolean {
  return RBAC_FEATURES.some(
    (f) =>
      f.module === module &&
      !!f.slices?.length &&
      (["create", "edit", "delete"] as RbacAction[]).some((a) => denied(f.id, a)),
  );
}
