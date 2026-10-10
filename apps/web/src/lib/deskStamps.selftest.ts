import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stampsForServerMerge, writeDeskRows, writeDeskSettings } from "./deskStamps.server";
import { captureDeskStamps, stampedDeskBody } from "./deskStampsClient";

console.log("deskStamps.selftest.ts");

/**
 * Stamped saves for library, payroll, vault, statutory and RTE (10 Oct
 * 2026). Each used to upsert every row the browser held: an old tab brought
 * back an open library loan, put a posted pay run back to draft, or reset
 * settings. Driven against a tiny in-memory table.
 */

type Row = Record<string, unknown> & { id?: string; tenant_id: string; updated_at: string };
let clock = 0;
const tick = () => `2026-10-10T10:00:00.${String(++clock).padStart(3, "0")}+00:00`;
const tables = new Map<string, Map<string, Row>>();
const tableOf = (name: string) => {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name)!;
};
const keyOf = (r: Row) => String(r.id ?? r.tenant_id);

const sb = {
  from: (name: string) => {
    const t = tableOf(name);
    return {
      upsert: (rows: Row | Row[], opts?: { ignoreDuplicates?: boolean }) => {
        const list = Array.isArray(rows) ? rows : [rows];
        const run = () => {
          const data: { id: string; updated_at: string }[] = [];
          for (const r of list) {
            if (t.has(keyOf(r))) {
              if (opts?.ignoreDuplicates) continue;
            }
            const row = { ...r, updated_at: tick() };
            t.set(keyOf(r), row);
            data.push({ id: keyOf(row), updated_at: row.updated_at });
          }
          return { data, error: null };
        };
        return { select: async () => run(), then: (f: (v: unknown) => unknown) => f(run()) };
      },
      update: (patch: Row) => {
        const where: Record<string, string> = {};
        const q = {
          eq: (k: string, v: string) => {
            where[k] = v;
            return q;
          },
          select: async () => {
            const key = where.id ?? where.tenant_id;
            const cur = t.get(key);
            if (!cur || cur.tenant_id !== where.tenant_id || cur.updated_at !== where.updated_at) {
              return { data: [], error: null };
            }
            const row = { ...cur, ...patch, updated_at: tick() };
            t.set(key, row);
            return { data: [{ id: key, updated_at: row.updated_at }], error: null };
          },
        };
        return q;
      },
    };
  },
} as unknown as SupabaseClient;

const T = "t1";

void (async () => {
  // ── Rows ────────────────────────────────────────────────────────────────
  tableOf("library_desk_issues").set("i1", { id: "i1", tenant_id: T, returned_on: "2026-10-09", updated_at: tick() });
  const loaded = tableOf("library_desk_issues").get("i1")!.updated_at;

  // An unstamped (old-tab) save holding the loan as still open: refused, kept.
  const legacy = await writeDeskRows(sb, T, "library_desk_issues", [
    { id: "i1", tenant_id: T, returned_on: null, updated_at: "x" },
    { id: "i2", tenant_id: T, returned_on: null, updated_at: "x" },
  ], undefined);
  assert.ok(legacy.ok);
  assert.equal(tableOf("library_desk_issues").get("i1")!.returned_on, "2026-10-09", "an old tab can't reopen a returned loan");
  assert.ok(tableOf("library_desk_issues").has("i2"), "but its genuinely new loan is added");
  assert.equal(legacy.ok && legacy.kept, 1);

  // A stamped save from the loaded stamp lands; a second one from the same
  // (now old) stamp is a conflict.
  const s1 = await writeDeskRows(sb, T, "library_desk_issues", [{ id: "i1", tenant_id: T, note: "a", updated_at: "x" }], { i1: loaded });
  assert.ok(s1.ok && s1.landed.has("i1") && !s1.conflicts.length);
  const s2 = await writeDeskRows(sb, T, "library_desk_issues", [{ id: "i1", tenant_id: T, note: "b", updated_at: "x" }], { i1: loaded });
  assert.ok(s2.ok && s2.conflicts.includes("i1"), "a save from a superseded stamp is refused");
  assert.equal(tableOf("library_desk_issues").get("i1")!.note, "a");

  // Rows not named are not touched by a stamped save.
  const s3 = await writeDeskRows(sb, T, "library_desk_issues", [{ id: "i2", tenant_id: T, note: "z", updated_at: "x" }], {});
  assert.ok(s3.ok && s3.landed.size === 0);
  assert.equal(tableOf("library_desk_issues").get("i2")!.note, undefined);
  console.log("  ok  rows: old tabs only add; stamped saves land only at their stamp");

  // ── Settings ───────────────────────────────────────────────────────────
  tableOf("library_desk_settings").set(T, { tenant_id: T, loan_days: 14, updated_at: tick() });
  const setStamp = tableOf("library_desk_settings").get(T)!.updated_at;
  const old = await writeDeskSettings(sb, T, "library_desk_settings", { loan_days: 7 }, false, undefined);
  assert.ok(old.ok);
  assert.equal(tableOf("library_desk_settings").get(T)!.loan_days, 14, "an old tab can't reset settings");
  const unchanged = await writeDeskSettings(sb, T, "library_desk_settings", { loan_days: 7 }, true, null);
  assert.ok(unchanged.ok && !unchanged.conflict);
  assert.equal(tableOf("library_desk_settings").get(T)!.loan_days, 14, "settings not changed here are not written");
  const changed = await writeDeskSettings(sb, T, "library_desk_settings", { loan_days: 21 }, true, setStamp);
  assert.ok(changed.ok && changed.stamp && !changed.conflict);
  assert.equal(tableOf("library_desk_settings").get(T)!.loan_days, 21);
  const stale = await writeDeskSettings(sb, T, "library_desk_settings", { loan_days: 3 }, true, setStamp);
  assert.ok(stale.ok && stale.conflict, "settings from a superseded stamp are refused");
  console.log("  ok  settings: written only when changed, from the stamp they were loaded at");

  // ── Server-merged saves (function holders) ─────────────────────────────
  const merged = stampsForServerMerge(
    [{ id: "a", v: 1 }, { id: "b", v: 1 }],
    [{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "c", v: 1 }],
    { a: "sa", b: "sb" },
  );
  assert.deepEqual(merged, { b: "sb", c: "" }, "only rows the merge changed, at the stamps just read");

  // ── Browser body ───────────────────────────────────────────────────────
  const desk = { runs: [{ id: "r1", status: "posted" }, { id: "r2", status: "draft" }], settings: { x: 1 } };
  captureDeskStamps("payroll-test", desk, ["runs"], { runs: { r1: "s1", r2: "s2" } }, "set1");
  const idle = stampedDeskBody("payroll-test", desk, ["runs"]);
  assert.equal(idle.anything, false, "nothing changed → nothing to send");
  const edit = stampedDeskBody(
    "payroll-test",
    { ...desk, runs: [desk.runs[0], { id: "r2", status: "posted" }, { id: "r3", status: "draft" }] },
    ["runs"],
  );
  assert.deepEqual((edit.body.runs as { id: string }[]).map((r) => r.id), ["r2", "r3"]);
  assert.deepEqual(edit.stamps.runs, { r2: "s2", r3: "" });
  assert.equal(edit.body.settingsBase, null);
  console.log("  ok  browser sends only changed rows, settings only when changed");

  // ── Wiring ─────────────────────────────────────────────────────────────
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  for (const [server, route, client] of [
    ["libraryNormalized.server.ts", "../app/api/school-data/library-desk/route.ts", "libraryNormalizedClient.ts"],
    ["vaultNormalized.server.ts", "../app/api/school-data/vault-desk/route.ts", "vaultNormalizedClient.ts"],
    ["rteNormalized.server.ts", "../app/api/school-data/rte-desk/route.ts", "rteNormalizedClient.ts"],
    ["payrollNormalized.server.ts", "../app/api/school-data/payroll-desk/route.ts", "payrollNormalizedClient.ts"],
    ["statutoryNormalized.server.ts", "../app/api/school-data/statutory-desk/route.ts", "statutoryNormalizedClient.ts"],
  ] as const) {
    const s = read(server);
    assert.ok(/writeDeskRows\(/.test(s), `${server} writes rows stamped / insert-only`);
    assert.ok(!/await upsertChunks\(\s*sb,\s*"[a-z_]+_(titles|copies|issues|documents|seats|applications|runs|batches)"/.test(s), `${server} no longer upserts every row`);
    assert.ok(/stampsOf\(/.test(s), `${server} load returns stamps`);
    assert.ok(/readStampsParam\(body\.stamps/.test(read(route)), `${route} passes stamps`);
    const c = read(client);
    assert.ok(/stampedDeskBody\(/.test(c) && /afterStampedDeskSave\(/.test(c) && /captureDeskStamps\(/.test(c), `${client} sends stamps`);
  }
  assert.ok(/stampsForServerMerge\(stored\.bundle\.seats/.test(read("../app/api/school-data/rte-desk/route.ts")), "RTE function holders write at the stamps just read");
  assert.ok(/runWrite\.landed\.has\(String\(l\.run_id\)\)/.test(read("payrollNormalized.server.ts")), "pay-run lines only under a run that landed");
  console.log("  ok  wiring: five desks stamped, function-holder merges stamped, lines under landed parents");

  console.log("\nAll desk stamp checks passed.");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
