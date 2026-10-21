"use client";

/**
 * The staff screens' save (data-layer 2.2d): what the screen showed and what
 * the action made of it → stated row writes of sis.departments /
 * sis.designations / sis.staff (planned by staffBookPlan.ts on the rows AS
 * STORED NOW), then the protected fields through the sensitive route.
 *
 * "Saved" is only ever said from here after the server confirmed every write
 * of the action; every refusal comes back with the server's reason. Never
 * the old whole-book save (saveMasters), never the old staff-roster route.
 *
 * The caller (useStaffBookWrites) then refetches the staff queries and re-reads
 * the roster into the page copy (the staff bridge) — after a failure too: the
 * screen must show what the server holds.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Revision, WriteFail, WriteResult } from "../types";
import { invalidateDesks } from "./hooks";
import { writeRecords, writeStaffSensitiveFields } from "./mutate";
import { readAll, readRevisions } from "./query";
import { bridgeStaffAfterWrite } from "./staffBridge";
import { planStaffBookCommit, type StaffBook, type StoredStaffBook } from "./staffBookPlan";

type Row = Record<string, unknown>;

export const STAFF_DESKS = ["sis_staff", "sis_departments", "sis_designations"] as const;

export type StaffBookOutcome =
  | { ok: true; /** Nothing differed: nothing was sent. */ unchanged: boolean; versions: Readonly<Record<string, Revision>> }
  | {
      ok: false;
      kind: WriteFail<Row>["kind"] | "invalid";
      message: string;
      /** For a conflict: the records and fields someone else changed first. */
      conflicts?: { id: string; fields: string[] }[];
      /** Something of the action landed before the refusal (said in `message`). */
      partial: boolean;
    };

const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => a === b;

async function readList(collection: string): Promise<{ ok: true; rows: Row[] } | { ok: false; error: string }> {
  const r = await readAll<Row>(collection, { limit: 500, maxPages: 4 });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.complete) return { ok: false, error: `${collection} has more records than one read covers` };
  return { ok: true, rows: r.rows };
}

function describe(r: WriteFail<Row>, what: string): string {
  if (r.kind === "conflict") {
    return `Not saved — someone changed ${what} on another device a moment ago. The screen now shows their version; make your change again.`;
  }
  if (r.kind === "network") return `Not saved — the network failed (${r.message}). Nothing on screen was saved; try again.`;
  return `Not saved — ${r.message}`;
}

const WHAT: Record<string, string> = {
  "sis.departments": "a department",
  "sis.designations": "a designation",
  "sis.staff": "this staff record",
};

/**
 * Save the difference between `shown` and `next`. Never throws. Only the lists
 * the action changed are read and written.
 */
export async function commitStaffBook(shown: StaffBook, next: StaffBook): Promise<StaffBookOutcome> {
  const need = {
    staff: !same(shown.staff, next.staff),
    departments: !same(shown.departments, next.departments),
    designations: !same(shown.designations, next.designations),
  };
  if (!need.staff && !need.departments && !need.designations) return { ok: true, unchanged: true, versions: {} };

  const [staff, departments, designations] = await Promise.all([
    need.staff ? readList("sis.staff") : Promise.resolve({ ok: true as const, rows: [] as Row[] }),
    need.departments ? readList("sis.departments") : Promise.resolve({ ok: true as const, rows: [] as Row[] }),
    need.designations ? readList("sis.designations") : Promise.resolve({ ok: true as const, rows: [] as Row[] }),
  ]);
  for (const r of [staff, departments, designations]) {
    if (!r.ok) {
      return {
        ok: false,
        kind: "unavailable",
        message: `Not saved — the saved staff records could not be read to check this change (${r.error}). Try again.`,
        partial: false,
      };
    }
  }
  const stored: StoredStaffBook = {
    staff: (staff as { rows: Row[] }).rows,
    departments: (departments as { rows: Row[] }).rows,
    designations: (designations as { rows: Row[] }).rows,
  };
  const plan = planStaffBookCommit({
    shown: {
      staff: need.staff ? shown.staff : [],
      departments: need.departments ? shown.departments : [],
      designations: need.designations ? shown.designations : [],
    },
    next: {
      staff: need.staff ? next.staff : [],
      departments: need.departments ? next.departments : [],
      designations: need.designations ? next.designations : [],
    },
    stored,
  });
  if (!plan.ok) {
    return { ok: false, kind: plan.kind, message: plan.reason, conflicts: plan.conflicts, partial: false };
  }
  if (plan.empty) return { ok: true, unchanged: true, versions: {} };

  const versions: Record<string, Revision> = {};
  let sent = 0;
  for (const req of plan.requests) {
    const r: WriteResult<Row> = await writeRecords<Row>(req.collection, req.ops);
    if (!r.ok) {
      const partial = sent > 0;
      return {
        ok: false,
        kind: r.kind,
        message: describe(r, WHAT[req.collection] ?? "this") + (partial ? " (The earlier part of this change was saved.)" : ""),
        partial,
      };
    }
    sent += 1;
    for (const [id, v] of Object.entries(r.versions)) versions[id] = v;
  }

  if (plan.sensitive.length) {
    // On the revision the row write just answered, else the stored one, else
    // (a record created without a row op — never) a fresh read.
    const missing = plan.sensitive.filter((s) => !versions[s.id] && !s.base).map((s) => s.id);
    const fresh = missing.length ? await readRevisions("sis.staff", missing) : null;
    const ops = plan.sensitive.map((s) => ({
      id: s.id,
      base: versions[s.id] ?? s.base ?? (fresh?.ok ? fresh.revisions.get(s.id)?.revision ?? null : null),
      fields: s.fields,
    }));
    const r = await writeStaffSensitiveFields<Row>(ops);
    if (!r.ok) {
      const partial = sent > 0;
      return {
        ok: false,
        kind: r.kind,
        message:
          (partial ? "Saved, except the bank, ID, pay or login details — " : "Not saved — ") +
          (r.kind === "conflict" ? "someone changed this record on another device a moment ago; make your change again." : r.message),
        partial,
      };
    }
    for (const [id, v] of Object.entries(r.versions)) versions[id] = v;
  }
  return { ok: true, unchanged: false, versions };
}

/** Bring back a removed (soft-deleted) member: clear deleted_at at the removed row's revision. */
export async function restoreStaffMember(id: string): Promise<StaffBookOutcome> {
  const rev = await readRevisions("sis.staff", [id]);
  if (!rev.ok) return { ok: false, kind: "unavailable", message: `Not restored — ${rev.error}`, partial: false };
  const cur = rev.revisions.get(id);
  if (!cur) return { ok: false, kind: "not_found", message: "Not restored — this record is not in the school's staff records.", partial: false };
  if (!cur.deleted) return { ok: true, unchanged: true, versions: {} };
  const r = await writeRecords<Row>("sis.staff", [{ op: "upsert", id, base: cur.revision, row: { deleted_at: null } }]);
  if (!r.ok) return { ok: false, kind: r.kind, message: describe(r, WHAT["sis.staff"]!).replace(/^Not saved/, "Not restored"), partial: false };
  return { ok: true, unchanged: false, versions: r.versions };
}

/** The removed members (staff · edit holders only — the route says so otherwise). */
export async function readRemovedStaff(): Promise<{ ok: true; rows: Row[] } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch("/api/data/sis.staff?removed=1&limit=500", { cache: "no-store" });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network request failed" };
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; rows?: Row[]; error?: string } | null;
  if (!res.ok || !body?.ok || !Array.isArray(body.rows)) return { ok: false, error: body?.error ?? `Request failed (${res.status})` };
  return { ok: true, rows: body.rows };
}

/**
 * The hook the staff screens save through. After every attempt (saved or
 * not) the staff queries refetch and the page copy's roster is re-read from
 * the server, so the screen shows what the server holds.
 */
export function useStaffBookWrites(): {
  commit: (shown: StaffBook, next: StaffBook) => Promise<StaffBookOutcome>;
  restore: (id: string) => Promise<StaffBookOutcome>;
} {
  const client = useQueryClient();
  const after = useCallback(async () => {
    invalidateDesks(client, STAFF_DESKS);
    await bridgeStaffAfterWrite();
  }, [client]);
  const commit = useCallback(
    async (shown: StaffBook, next: StaffBook) => {
      const r = await commitStaffBook(shown, next);
      if (!(r.ok && r.unchanged)) await after();
      return r;
    },
    [after],
  );
  const restore = useCallback(
    async (id: string) => {
      const r = await restoreStaffMember(id);
      await after();
      return r;
    },
    [after],
  );
  return { commit, restore };
}

