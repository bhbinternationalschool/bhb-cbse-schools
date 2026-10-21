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
 *   useMastersElementWrites()      data-layer 2.2c: the Masters editor's commit,
 *                                  planned by mastersElementPlan.ts, sent request
 *                                  by request (each ≤ one removal); staff link
 *                                  changes laid on each record AS STORED.
 *
 * Users: the Masters editor (2.2c), Timetable → Subject rules (2.2c); the
 * staff editor moves in 2.2d.
 */

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TEACHING_MASTERS_KEYS } from "@/lib/mastersTeachingSubset";
import { COLLECTIONS, collectionKind } from "../registry";
import { asRevision, type Revision, type WriteFail, type WriteResult } from "../types";
import { invalidateDesks, useErpMutation, useMasters } from "./hooks";
import { applyStaffLinkChange, type ElementRequest, type StaffLinkChange } from "./mastersElementPlan";
import { writeRecords } from "./mutate";
import { readAll } from "./query";
import { mastersListCommitOps, mastersObjectCommitOp } from "./mastersCommit";
import { bridgeMastersDeskAfterWrite } from "./mastersDeskBridge";
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
  const mutation = useErpMutation<Row>(target?.id ?? `masters.unknown-${sliceKey}`, {
    desk: ["masters"],
    // The old whole-book save's base follows the server (mastersDeskBridge).
    onSaved: () => void bridgeMastersDeskAfterWrite(),
    onFailed: (r) => {
      if (r.kind === "conflict") void bridgeMastersDeskAfterWrite();
    },
  });
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

export type ElementWritesOutcome =
  | {
      ok: true;
      /** Per request (same order as sent): the revision each element now has. */
      versions: Readonly<Record<string, Revision>>[];
    }
  | {
      ok: false;
      kind: WriteFail<Row>["kind"];
      message: string;
      /** Requests that landed before the failure (same order as sent). */
      versions: Readonly<Record<string, Revision>>[];
      /** The failed request's index (requests.length = the staff links). */
      failedAt: number;
    };

/**
 * The Masters editor's element writes (data-layer 2.2c). Requests go one after
 * another and stop at the first refusal — each is all-or-none on the server,
 * and none removes more than one element. Then the staff link changes, each
 * laid on the member's record as stored NOW (read just before, its revision
 * the base): a link someone else added to the same member meanwhile is kept.
 * The masters view (and the staff list) refetch afterwards, also after a
 * failure — the screen must show what the server holds.
 */
export function useMastersElementWrites(): (requests: readonly ElementRequest[], staff: readonly StaffLinkChange[]) => Promise<ElementWritesOutcome> {
  const client = useQueryClient();
  return useCallback(
    async (requests, staff) => {
      const versions: Readonly<Record<string, Revision>>[] = [];
      try {
        for (let i = 0; i < requests.length; i++) {
          const r = await writeRecords<Row>(requests[i].collection, requests[i].ops);
          if (!r.ok) return { ok: false, kind: r.kind, message: describeElementFailure(r), versions, failedAt: i };
          versions.push(r.versions);
        }
        if (staff.length) {
          const failed = await writeStaffLinks(staff);
          if (failed) return { ok: false, kind: failed.kind, message: failed.message, versions, failedAt: requests.length };
        }
        return { ok: true, versions };
      } finally {
        if (requests.length) {
          invalidateDesks(client, ["masters"]);
          // Not awaited: the old save waits for it (mastersDeskBridgeSettled).
          void bridgeMastersDeskAfterWrite();
        }
        if (staff.length) {
          invalidateDesks(client, STAFF_DESKS);
          await bridgeStaffAfterWrite();
        }
      }
    },
    [client],
  );
}

function describeElementFailure(r: WriteFail<Row>): string {
  if (r.kind === "conflict") {
    return "Someone changed this on another device a moment ago — nothing was saved. The screen now shows their version; make your change again.";
  }
  return r.message || "Not saved.";
}

async function writeStaffLinks(changes: readonly StaffLinkChange[]): Promise<{ kind: WriteFail<Row>["kind"]; message: string } | null> {
  const read = await readAll<Row>("sis.staff", { limit: 500, maxPages: 2 });
  if (!read.ok) return { kind: "unavailable", message: `Could not read the staff records to save the teachers — nothing was saved (${read.error}).` };
  const byId = new Map(read.rows.map((r) => [String(r.id), r]));
  const ids = [...new Set(changes.map((c) => c.staffId))];
  const ops = [];
  for (const id of ids) {
    const row = byId.get(id);
    const profile = row?.profile;
    if (!row || !profile || typeof profile !== "object") {
      return {
        kind: row ? "auth" : "not_found",
        message: row
          ? "Teacher assignments are saved on staff records — that needs the Staff · edit permission."
          : "A member of staff in this change is no longer on the roster — nothing was saved.",
      };
    }
    const patch: Row = {};
    for (const c of changes.filter((x) => x.staffId === id)) {
      patch[c.field] = applyStaffLinkChange((patch[c.field] as unknown) ?? (profile as Row)[c.field], c);
    }
    ops.push({ op: "upsert" as const, id, base: row.updated_at ? asRevision(String(row.updated_at)) : null, row: { profile: patch } });
  }
  const r = await writeRecords<Row>("sis.staff", ops);
  if (r.ok) return null;
  return { kind: r.kind, message: describeElementFailure(r) };
}
