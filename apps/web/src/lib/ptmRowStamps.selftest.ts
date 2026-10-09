import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyStampedSave,
  buildStampedSave,
  captureRowStamps,
  readStampsParam,
} from "./rowStampClient";
import { stampsOf, writeStampedRows } from "./rowStampWrite.server";

console.log("ptmRowStamps.selftest.ts");

/**
 * Stamped saves on the PTM desk. A tab that loaded a booking before the
 * parent cancelled it must not write "booked" back; an office save must not
 * undo a teacher's slot edit. The browser sends only rows it changed, with
 * the `updated_at` it loaded; the server writes a row only while it is still
 * at that stamp. Driven end to end against a tiny in-memory table.
 */

type Row = { id: string; tenant_id: string; status?: string; note?: string; updated_at: string };
let clock = 0;
const tick = () => `2026-10-09T10:00:00.${String(++clock).padStart(3, "0")}+00:00`;
const table = new Map<string, Row>();

// Just enough of the Supabase builder for writeStampedRows.
const sb = {
  from: () => ({
    upsert: (rows: Row[]) => ({
      select: async () => {
        const data: { id: string; updated_at: string }[] = [];
        for (const r of rows) {
          if (table.has(r.id)) continue; // ignoreDuplicates
          const row = { ...r, updated_at: tick() };
          table.set(r.id, row);
          data.push({ id: row.id, updated_at: row.updated_at });
        }
        return { data, error: null };
      },
    }),
    update: (patch: Partial<Row>) => {
      const where: Record<string, string> = {};
      const q = {
        eq: (k: string, v: string) => {
          where[k] = v;
          return q;
        },
        select: async () => {
          const cur = table.get(where.id);
          if (!cur || cur.tenant_id !== where.tenant_id || cur.updated_at !== where.updated_at) {
            return { data: [], error: null };
          }
          const row = { ...cur, ...patch, updated_at: tick() };
          table.set(row.id, row);
          return { data: [{ id: row.id, updated_at: row.updated_at }], error: null };
        },
      };
      return q;
    },
  }),
} as unknown as SupabaseClient;

const T = "t1";
const slices = ["bookings"] as const;
const strip = (r: Row) => ({ id: r.id, status: r.status, ...(r.note ? { note: r.note } : {}) });
const load = (module: string) => {
  const rows = [...table.values()];
  const local = { bookings: rows.map(strip) };
  captureRowStamps(module, { bookings: stampsOf(rows as unknown as Record<string, unknown>[]) }, local, slices);
  return local.bookings;
};
async function save(module: string, bookings: { id: string; status?: string; note?: string }[]) {
  const state = { bookings };
  const sent = buildStampedSave(module, state, slices);
  const rows = bookings
    .filter((b) => b.id in sent.bookings)
    .map((b) => ({ ...b, tenant_id: T, updated_at: "client-time" }));
  const w = await writeStampedRows(sb, "ptm_desk_bookings", T, rows, sent.bookings);
  assert.ok(w.ok);
  const answer = { stamps: { bookings: w.stamps }, conflicts: w.conflicts.length ? { bookings: w.conflicts } : {} };
  applyStampedSave(module, state, sent, answer, slices);
  return { sent: sent.bookings, conflicts: w.conflicts };
}

void (async () => {
  // Two bookings exist; the office tab loads them.
  table.set("b1", { id: "b1", tenant_id: T, status: "booked", updated_at: tick() });
  table.set("b2", { id: "b2", tenant_id: T, status: "booked", updated_at: tick() });
  const office = load("office");

  // Nothing changed → nothing sent.
  assert.deepEqual((await save("office", office)).sent, {});

  // The parent cancels b1 on the app (a server writer bumps updated_at).
  table.set("b1", { ...table.get("b1")!, status: "cancelled", updated_at: tick() });

  // The office edits b2 only: b1's stale "booked" is not sent, the cancel stands.
  const edited = office.map((b) => (b.id === "b2" ? { ...b, note: "came early" } : b));
  const r1 = await save("office", edited);
  assert.deepEqual(Object.keys(r1.sent), ["b2"]);
  assert.deepEqual(r1.conflicts, []);
  assert.equal(table.get("b1")!.status, "cancelled", "an untouched stale copy can't undo the cancel");
  assert.equal(table.get("b2")!.note, "came early");

  // The stale tab now marks b1 completed itself: refused, the cancel stands.
  const stale = edited.map((b) => (b.id === "b1" ? { ...b, status: "completed" } : b));
  const r2 = await save("office", stale);
  assert.deepEqual(r2.conflicts, ["b1"], "changed elsewhere first → conflict");
  assert.equal(table.get("b1")!.status, "cancelled");

  // b2 again, from the stamp its own save produced: accepted.
  const r3 = await save("office", stale.map((b) => (b.id === "b2" ? { ...b, note: "left at 11" } : b)));
  assert.ok(!r3.conflicts.includes("b2"));
  assert.equal(table.get("b2")!.note, "left at 11");

  // A new row is inserted; a "new" row that already exists is a conflict, not an overwrite.
  const r4 = await save("fresh-browser", [{ id: "b3", status: "booked" }, { id: "b1", status: "booked" }]);
  assert.deepEqual(r4.conflicts, ["b1"], "a browser that never loaded can't overwrite");
  assert.equal(table.get("b1")!.status, "cancelled");
  assert.equal(table.get("b3")!.status, "booked");

  // The stamps parameter keeps only known lists and string stamps.
  assert.deepEqual(readStampsParam({ bookings: { b1: "x", b2: 3 }, other: { z: "y" } }, ["bookings", "slots"]), {
    bookings: { b1: "x" },
    slots: {},
  });
  assert.equal(readStampsParam(undefined, ["bookings"]), undefined);

  // ── Wiring ───────────────────────────────────────────────────────────────
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  const push = read("ptmNormalized.server.ts");
  assert.ok(/writeStampedRows\(sb, table, tenantId, mine, sent\)/.test(push), "a browser's save is written stamped");
  assert.ok(/only \? rows\[slice\]\.filter/.test(push), "a server writer writes only the rows it names");
  assert.ok(/stamps: \{\s*events: stampsOf\(eventRows\)/.test(push), "the load returns each row's stamp");
  assert.ok(/touchPtmMeta\(sb, tenantId, now\)/.test(push), "meta counts come from the tables");
  const route = read("../app/api/school-data/ptm-desk/route.ts");
  assert.ok(/readStampsParam\(body\.stamps, PTM_SLICES\)/.test(route) && /\}, deletes, \{ stamps \}\);/.test(route));
  assert.equal((route.match(/stamps: stampsFor\(/g) ?? []).length, 2, "both GET shapes carry stamps");
  const client = read("ptmNormalizedClient.ts");
  assert.ok(/stamps: sentStamps/.test(client) && /applyStampedSave\(PTM_DESK/.test(client) && /onStampConflicts\(PTM_DESK, body\.conflicts\)/.test(client));
  assert.ok(/capturePtmStamps\(stamps, loadPtm\(\)\)/.test(read("ptmPersistence.ts")), "every load captures stamps");
  assert.ok(/\{ only: \{ bookings: \[result\.booking\.id\] \} \}/.test(read("ptmBook.server.ts")), "a parent's booking writes only itself");
  assert.ok(/\{ only: \{ bookings: \[bookingId\] \} \}/.test(read("../app/api/v1/ptm/cancel/route.ts")), "a parent's cancel writes only its booking");
  assert.ok(/only: \{ bookings: \[bookingId\], feedback:/.test(read("../app/api/v1/staff/ptm/booking/route.ts")));
  const slotsRoute = read("../app/api/v1/staff/ptm/slots/route.ts");
  assert.ok(/only: \{ slots: created\.map\(\(x\) => x\.id\) \}/.test(slotsRoute));
  assert.ok(/deletes: \{ ptm_desk_slots: \[slotId\] \}/.test(slotsRoute), "a teacher's slot removal is a named delete");

  console.log("ptmRowStamps.selftest: all assertions passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
