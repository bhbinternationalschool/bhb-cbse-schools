"use client";

/**
 * The write hooks of data-layer 2.2b, on top of the query kernel (hooks.tsx):
 *
 *   useMastersMutation(sliceKey)   commit(next) — the edited list (or object)
 *                                  compared with what the masters view served,
 *                                  sent as element writes (mastersCommit.ts);
 *                                  then the masters view refetches.
 *   useStaffMutation(collection)   sis.staff / sis.departments / sis.designations
 *                                  through the kernel; then the staff list
 *                                  refetches and the staff bridge re-reads the
 *                                  roster into the page copy (staffBridge.ts).
 *
 * Nothing on a screen uses them yet: 2.2c (Masters panels) and 2.2d (staff
 * editor) do.
 */

import { useCallback, useMemo } from "react";
import { TEACHING_MASTERS_KEYS } from "@/lib/mastersTeachingSubset";
import { COLLECTIONS, collectionKind } from "../registry";
import type { WriteFail, WriteResult } from "../types";
import { useErpMutation, useMasters } from "./hooks";
import { mastersListCommitOps, mastersObjectCommitOp } from "./mastersCommit";
import { bridgeStaffAfterWrite } from "./staffBridge";
import type { UseSaveMutation } from "./useSaveMutation";

type Row = Record<string, unknown>;

/** The Masters collection that writes this slice key (registry), or null. */
export function mastersCollectionFor(sliceKey: string): { id: string; kind: "slice" | "object"; keyField: string } | null {
  const def = COLLECTIONS.find((c) => c.module === "masters" && c.slice?.table === "masters_desk_slices" && c.slice.key === sliceKey);
  if (!def) return null;
  const kind = collectionKind(def);
  if (kind === "rows") return null;
  return { id: def.id, kind, keyField: def.slice?.keyField ?? "id" };
}

const refused = (message: string, kind: WriteFail<Row>["kind"] = "invalid"): WriteResult<Row> => ({
  ok: false,
  kind,
  message,
  conflicts: [],
});

export type UseMastersMutation = UseSaveMutation<Row> & {
  /** The masters view has answered: commit has a base to compare with. */
  readonly ready: boolean;
  /**
   * Save the list (or object) as edited. Compared with the served value —
   * only the differences are sent; more than one removal, an emptied list,
   * or a list this answer withholds (the teaching subset) is refused here,
   * with nothing sent.
   */
  commit: (next: unknown) => Promise<WriteResult<Row>>;
};

export function useMastersMutation(sliceKey: string): UseMastersMutation {
  const masters = useMasters();
  const target = useMemo(() => mastersCollectionFor(sliceKey), [sliceKey]);
  const mutation = useErpMutation<Row>(target?.id ?? `masters.unknown-${sliceKey}`, { desk: ["masters"] });
  const view = masters.data;
  const { save } = mutation;

  const commit = useCallback(
    async (next: unknown): Promise<WriteResult<Row>> => {
      if (!target) return refused(`${sliceKey} is not a Masters list the kernel writes.`, "not_found");
      if (!view) return refused("Masters has not loaded yet — nothing was saved.", "unavailable");
      if (view.scope === "teaching" && !(TEACHING_MASTERS_KEYS as readonly string[]).includes(sliceKey)) {
        return refused(`${sliceKey} is not shown to your role, so it cannot be saved from here.`, "auth");
      }
      const book = view.masters as unknown as Record<string, unknown>;
      const plan =
        target.kind === "object"
          ? mastersObjectCommitOp(sliceKey, book[sliceKey], next, (view.stamps as Record<string, string> | undefined)?.[sliceKey])
          : mastersListCommitOps(sliceKey, book[sliceKey] as unknown[] | undefined, next as unknown[], {
              keyField: target.keyField,
            });
      if (!plan.ok) return refused(plan.reason);
      if (plan.ops.length === 0) return { ok: true, results: [], versions: {} };
      return save(plan.ops);
    },
    [target, view, sliceKey, save],
  );

  return { ...mutation, ready: !!view, commit };
}

const STAFF_DESKS = ["sis_staff", "sis_departments", "sis_designations"] as const;

export function useStaffMutation(
  collection: "sis.staff" | "sis.departments" | "sis.designations",
): UseSaveMutation<Row> {
  return useErpMutation<Row>(collection, {
    desk: STAFF_DESKS,
    onSaved: () => void bridgeStaffAfterWrite(),
    onFailed: (r) => {
      if (r.kind === "conflict") void bridgeStaffAfterWrite();
    },
  });
}
