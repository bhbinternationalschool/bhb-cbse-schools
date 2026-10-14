/**
 * The 2.1 bridge (data-layer step 2.1a; deleted in 2.3b).
 *
 * Screens converted to useMasters() read the server's answer directly. But
 * ~107 lib/ readers (fees maths, exams, payroll, counter concessions, the
 * SIS alignment…) still call loadMasters(), which reads this tab's page-
 * memory copy. Without a bridge those readers would keep the copy the tab
 * booted with while the screen around them shows the new answer.
 *
 * So every answer of the masters view REPLACES the page copy's Masters book:
 *
 *   - one synchronous load → write, with no await between them (the
 *     snapshot-before-await race that erased the staff roster three times,
 *     S1, cannot happen here: nothing else runs between the two lines);
 *   - server wins: every key the answer carries is taken as it is — no merge
 *     by id, no "newer local edit" check, no snapshot;
 *   - written with writeMastersLocalRaw: the page copy and the server-side
 *     mirror slice in memory only. It pushes nothing, schedules no sync and
 *     raises no 'bhb-masters-updated' (so no listener can turn it into a
 *     write — and React Query, not that event, refreshes the converted
 *     screens).
 *
 * What it does NOT touch (PAGE_OWNED_MASTERS_KEYS):
 *   staff, departments, designations — not in the masters view at all (they
 *     are the staff-list view's, and the staff hydrate writes them into this
 *     copy); replacing them would wipe the roster every permission check
 *     resolves against;
 *   students — a client-side projection of the SIS roster
 *     (syncSisIntoMasters); the server's slice of that name is not what this
 *     tab's pickers were built from, and re-writing it on every answer would
 *     re-trigger the projection write the 13 Oct React #185 loop came from.
 *
 * The TEACHING answer (scope "teaching": a teacher, or anyone without the
 * Masters grant) carries only TEACHING_MASTERS_KEYS; every other list in it
 * is empty because it is WITHHELD, not because the school has none. The
 * bridge writes the teaching keys and nothing else — the fee lists, numbering
 * and statutory setup in the page copy are left exactly as they are (for a
 * teacher that is what the masters hydrate gave them: the same teaching
 * subset), so a teaching answer can never empty a fee list. This is the
 * 13 Oct lesson (ensureFeeSetupInner, mastersTeacherNoFees.selftest): an
 * absent list is not an empty one.
 *
 * A malformed answer never reaches the bridge: parseMastersView throws first
 * and the query is in error (R6 — unknown is never empty).
 */
import type { MastersState } from "@/lib/masters";
import { TEACHING_MASTERS_KEYS } from "@/lib/mastersTeachingSubset";
import type { MastersView } from "../viewTypes";
import { ErpQueryError } from "./queryKernel";

/** Keys of the page copy the masters view does not own. Never written by the bridge. */
export const PAGE_OWNED_MASTERS_KEYS = ["staff", "departments", "designations", "students"] as const;

const PAGE_OWNED = new Set<string>(PAGE_OWNED_MASTERS_KEYS);

/** The keys an answer of this scope is the truth for. */
export function bridgedKeys(view: MastersView): string[] {
  const keys =
    view.scope === "full"
      ? Object.keys(view.masters as unknown as Record<string, unknown>)
      : [...TEACHING_MASTERS_KEYS];
  return keys.filter((k) => k !== "version" && !PAGE_OWNED.has(k));
}

/**
 * The page copy after the answer: `current` with every key the answer is the
 * truth for replaced by the answer's value. Pure.
 */
export function bridgedMastersCopy(current: MastersState, view: MastersView): MastersState {
  const answer = view.masters as unknown as Record<string, unknown>;
  const next = { ...current } as unknown as Record<string, unknown>;
  for (const k of bridgedKeys(view)) {
    // A key the server did not send stays what it was (absent ≠ empty).
    if (answer[k] === undefined) continue;
    next[k] = answer[k];
  }
  next.version = 2;
  return next as unknown as MastersState;
}

export type MastersBridgeDeps = {
  load: () => MastersState;
  write: (state: MastersState) => void;
};

/**
 * Replace the page copy with the answer. Synchronous on purpose: the load
 * and the write happen in one turn, so no other writer (the staff hydrate,
 * the old masters hydrate) can land between them and be overwritten.
 */
export function bridgeMastersToPageMemory(view: MastersView, deps: MastersBridgeDeps): void {
  deps.write(bridgedMastersCopy(deps.load(), view));
}

/**
 * The masters view's `data`, checked. Anything that is not
 * `{scope: "full"|"teaching", masters: {classes: [], sections: [], subjects: []}}`
 * is a failed read — thrown before the bridge can write it.
 */
export function parseMastersView(data: unknown): MastersView {
  const v = data as Partial<MastersView> | null;
  const m = v?.masters as Partial<MastersState> | undefined;
  if (
    !v ||
    (v.scope !== "full" && v.scope !== "teaching") ||
    !m ||
    typeof m !== "object" ||
    !Array.isArray(m.classes) ||
    !Array.isArray(m.sections) ||
    !Array.isArray(m.subjects)
  ) {
    throw new ErpQueryError(null, "The school's Masters arrived in a shape this page cannot read.");
  }
  return v as MastersView;
}

/**
 * The screen's Masters: the server's book, plus the staff side (roster,
 * departments, designations) from the access copy every permission check
 * already uses (useAccessData — the staff hydrate's roster) until the staff
 * screens move to useStaffList() (2.1c / 2.3a).
 *
 * The staff side is required, not decoration: rbac resolves the signed-in
 * person's roles through masters.staff + designations, and a person missing
 * from the roster falls back to designation guessing (lib/rbac
 * inferRoleCodes). Handing a permission check the book alone would change
 * who may do what. So: no access copy → null (still loading).
 *
 * For a teacher (scope "teaching") the fee lists in the result are empty
 * because they are withheld; the screens converted in 2.1a (attendance,
 * timetable, homework, teaching) read no fee data.
 */
export function screenMastersOf(view: MastersView | undefined, access: MastersState | null): MastersState | null {
  if (!view || !access) return null;
  return {
    ...(view.masters as unknown as MastersState),
    version: 2,
    staff: access.staff ?? [],
    departments: access.departments ?? [],
    designations: access.designations ?? [],
    // The SIS projection lives in the page copy only (see PAGE_OWNED_MASTERS_KEYS).
    students: access.students ?? [],
  };
}
