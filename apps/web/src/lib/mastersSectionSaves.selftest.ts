import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mastersSectionSave } from "./mastersNormalizedClient";
import { rowFingerprint } from "./sliceRevClient";

console.log("mastersSectionSaves.selftest.ts");

/**
 * Masters saved section by section (10 Oct 2026). One version for the
 * whole book made a holiday edit on one PC refuse a concession saved on
 * another, and every save rewrote every section. Now a save sends only the
 * sections that changed, each with the stamp it was loaded at, and the
 * database writes them all or none (masters_write_slices, rehearsed on a
 * local Postgres: matching save lands, a different section from its own
 * base lands, one stale section refuses the whole save, a "new" section
 * that exists is refused).
 */

const loaded = {
  holidays: [{ id: "h1", date: "2026-10-20" }],
  concessions: [{ id: "c1", pct: 10 }],
  classes: [{ id: "cl1", name: "I" }],
  staff: [{ id: "s1" }],
};
const base = new Map<string, { stamp: string; hash: number }>([
  ["holidays", { stamp: "t-h", hash: rowFingerprint(loaded.holidays) }],
  ["concessions", { stamp: "t-c", hash: rowFingerprint(loaded.concessions) }],
  ["classes", { stamp: "t-cl", hash: rowFingerprint(loaded.classes) }],
]);

// Nothing changed: nothing to send.
assert.deepEqual(mastersSectionSave({ ...loaded }, base).sections, {});

// A holiday added: only holidays travel, at the stamp they were loaded at.
const edit = mastersSectionSave({ ...loaded, holidays: [...loaded.holidays, { id: "h2", date: "2026-10-21" }] }, base);
assert.deepEqual(Object.keys(edit.sections), ["holidays"]);
assert.deepEqual(edit.bases, { holidays: "t-h" });

// A section this browser never saw on the server goes as new ("").
const fresh = mastersSectionSave({ ...loaded, numberSeries: [{ id: "n1" }] }, base);
assert.deepEqual(fresh.bases, { numberSeries: "" });

// Staff sections never ride on a Masters save (they have their own desk).
const staffEdit = mastersSectionSave({ ...loaded, staff: [{ id: "s1" }, { id: "s2" }] }, base);
assert.equal("staff" in staffEdit.sections, false);
console.log("  ok  only changed sections travel, each with its loaded stamp; staff never");

// ── Wiring ─────────────────────────────────────────────────────────────────
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const route = read("../app/api/school-data/masters-desk/route.ts");
assert.ok(/pushMastersSlicesToDb\(/.test(route), "section saves go through the all-or-none writer");
assert.ok(/\.\.\.\(stored as unknown as MastersState\),\s*\.\.\.Object\.fromEntries\(sliceKeys/.test(route), "guards check the stored book with the sent sections laid on");
assert.ok(/guardMastersOverwrite\(/.test(route) && /guardSubjectsOverwrite\(stored, state\)/.test(route), "class and subject guards still run");
assert.ok(/sliceStamps,/.test(route), "the load returns each section's stamp");
const server = read("mastersNormalized.server.ts");
assert.ok(/sb\.rpc\("masters_write_slices"/.test(server), "the writer calls the transactional function");
const sql = readFileSync(join(__dirname, "../../../../supabase/migrations/20261010220000_masters_write_slices.sql"), "utf8");
assert.ok(/for update/.test(sql) && /if array_length\(v_conflicts, 1\) > 0 then\s*return/.test(sql), "locks, checks every base, writes nothing on any conflict");
assert.ok(/grant execute on function public\.masters_write_slices\(uuid, jsonb, timestamptz\) to service_role/.test(sql), "service_role may call it");
assert.ok(/revoke all on function public\.masters_write_slices/.test(sql), "nobody else may");
const client = read("mastersNormalizedClient.ts");
assert.ok(/captureSliceBases\(bundle/.test(client), "a full load becomes the base");
assert.ok(/body\?\.reason === "slice_stale"/.test(client), "a refused section reloads Masters");
console.log("  ok  wiring: transactional section writer, guards on the merged book, reload on conflict");

console.log("\nAll masters section-save checks passed.");
process.exit(0);
