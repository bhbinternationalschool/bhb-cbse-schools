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
import { applyStaffLinkChange, MASTERS_BATCH_PATH, type ElementRequest, type StaffLinkChange } from "./mastersElementPlan";
import { writeRecords } from "./mutate";
import { readAll } from "./query";
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
  const mutation = useErpMutation<Row>(target?.id ?? `masters.unknown-${sliceKey}`, {
    desk: ["masters"],
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
      /** The revision each written element now has, keyed `${sliceKey}|${id}`. */
      versions: Readonly<Record<string, Revision>>;
    }
  | {
      ok: false;
      kind: WriteFail<Row>["kind"];
      message: string;
      /** What landed before the failure, keyed `${sliceKey}|${id}`. */
      versions: Readonly<Record<string, Revision>>;
      /** The failed request's index; -1 = the staff links (sent first; nothing else was sent). */
      failedAt: number;
    };

/**
 * The Masters editor's element writes (data-layer 2.2c). Staff link changes
 * go FIRST (children before parents: a refusal later leaves a class or a
 * subject with no teacher link, never a link to a removed one), each laid on
 * the member's record as stored NOW (read just before, its revision the
 * base) — a link someone else added to the same member meanwhile is kept.
 * Then the Masters requests, one after another, stopping at the first
 * refusal; each is all-or-none on the server, and a cascade across lists is
 * ONE batch (POST /api/data/masters/batch). The masters view (and the staff
 * list) refetch afterwards, also after a failure — the screen must show what
 * the server holds.
 */
export function useMastersElementWrites(): (requests: readonly ElementRequest[], staff: readonly StaffLinkChange[]) => Promise<ElementWritesOutcome> {
  const client = useQueryClient();
  return useCallback(
    async (requests, staff) => {
      const versions: Record<string, Revision> = {};
      try {
        if (staff.length) {
          const failed = await writeStaffLinks(staff);
          if (failed) return { ok: false, kind: failed.kind, message: failed.message, versions, failedAt: -1 };
        }
        for (let i = 0; i < requests.length; i++) {
          const req = requests[i];
          const r = req.kind === "batch" ? await writeBatch(req) : await writeRecords<Row>(req.collection, req.ops);
          if (!r.ok) return { ok: false, kind: r.kind, message: describeElementFailure(r), versions, failedAt: i };
          if (req.kind === "batch") Object.assign(versions, r.versions);
          else for (const [id, rev] of Object.entries(r.versions)) versions[`${req.sliceKey}|${id}`] = rev;
        }
        return { ok: true, versions };
      } finally {
        if (requests.length) {
          invalidateDesks(client, ["masters"]);
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

/** One all-or-none batch across lists; versions keyed `${sliceKey}|${id}`. Never throws. */
async function writeBatch(
  req: ElementRequest,
): Promise<{ ok: true; versions: Record<string, Revision> } | WriteFail<Row>> {
  const parts = req.parts ?? [];
  let res: Response;
  try {
    res = await fetch(`/api/data/${MASTERS_BATCH_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops: req.ops.map((op, i) => ({ collection: parts[i]?.collection, ...op })), ...(req.guard ? { guard: req.guard } : {}) }),
    });
  } catch (e) {
    return { ok: false, kind: "network", message: e instanceof Error ? e.message : "Network request failed", conflicts: [] };
  }
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    kind?: WriteFail<Row>["kind"];
    message?: string;
    error?: string;
    results?: { collection?: string; id?: string; status?: string; revision?: string }[];
  } | null;
  if (!res.ok || !body?.ok || !Array.isArray(body.results)) {
    const kind: WriteFail<Row>["kind"] =
      body?.kind ?? (res.status === 409 ? "conflict" : res.status === 403 ? "auth" : res.status === 400 ? "invalid" : "unavailable");
    return { ok: false, kind, message: body?.message ?? body?.error ?? `Request failed (${res.status})`, conflicts: [] };
  }
  const versions: Record<string, Revision> = {};
  body.results.forEach((r, i) => {
    const part = parts[i];
    if (!part || r.status === "deleted" || r.revision == null) return;
    versions[`${part.sliceKey}|${String(r.id ?? "")}`] = asRevision(String(r.revision));
  });
  return { ok: true, versions };
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
