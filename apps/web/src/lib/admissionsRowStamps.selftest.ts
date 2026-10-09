import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

console.log("admissionsRowStamps.selftest.ts");

/**
 * Admissions: a stale copy can't write an older lead back.
 *  - The office desk sends only the leads/households/payments it changed,
 *    each stamped with the `updated_at` it loaded (rowStampClient /
 *    rowStampWrite.server — exercised end to end in test:ptm-row-stamps).
 *  - Whole-desk writers (lead forms, WhatsApp bot, survey capture, call
 *    logs, the registration link, older browsers) skip any lead or
 *    household the database holds at a later `updated_at`.
 *  - The number counters only move forward.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost";

void (async () => {
  const { storedNewerIds: storedNewer } = await import("./rowStampWrite.server");

  // ── storedNewer on a fake table ──────────────────────────────────────────
  const stored = [
    { id: "L1", updated_at: "2026-10-09T10:05:00.000+00:00" }, // newer than the copy
    { id: "L2", updated_at: "2026-10-09T09:00:00.000+00:00" }, // older
    { id: "L3", updated_at: "2026-10-09T10:00:00.000+00:00" }, // same
  ];
  let failRead = false;
  const sb = {
    from: () => {
      let ids: string[] = [];
      const q = {
        select: () => q,
        eq: () => q,
        in: (_k: string, v: string[]) => {
          ids = v;
          return q;
        },
        order: () => q,
        range: async () =>
          failRead
            ? { data: null, error: { message: "timeout" } }
            : { data: stored.filter((r) => ids.includes(r.id)), error: null },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  const copy = ["L1", "L2", "L3", "L4"].map((id) => ({ id, updated_at: "2026-10-09T10:00:00.000Z" }));
  const r = await storedNewer(sb, "t", "admission_desk_leads", copy);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([...r.ids], ["L1"], "only the lead changed since this copy is skipped; new and same-time leads are written");
  failRead = true;
  const bad = await storedNewer(sb, "t", "admission_desk_leads", copy);
  assert.equal(bad.ok, false, "a failed read writes nothing");

  // ── Wiring ───────────────────────────────────────────────────────────────
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  const push = read("admissionsNormalized.server.ts");
  const body = push.slice(push.indexOf("export async function pushAdmissionDeskToDb("), push.indexOf("async function touchAdmissionMeta("));
  assert.ok(/writeStampedRows\(sb, table, tenantId, rows\[slice\], opts\.stamps\[slice\] \?\? \{\}\)/.test(body), "a browser's save is written stamped");
  assert.ok(/storedNewerIds\(sb, tenantId, table, write\)/.test(body) && /if \(!newer\.ok\) return newer;/.test(body), "whole-desk writers skip newer stored rows; a failed read writes nothing");
  assert.ok(/Math\.max\(Number\(ops\[k\]\) \|\| 0, Number\(storedSeq\[k\]\) \|\| 0\)/.test(body), "number counters never rewind");
  assert.ok(/if \(opsErr\) return/.test(body), "an unreadable counter row writes nothing");
  assert.ok(/touchAdmissionMeta\(sb, tenantId, now\)/.test(body), "meta counts come from the tables");
  assert.ok(/stamps: \{\s*households: stampsOf\(hhRows\)/.test(push), "the load returns each row's stamp");
  assert.ok(/normalizeAdmissionLead\(\{ \.\.\.lead, updatedAt: new Date\(\)\.toISOString\(\) \}\)/.test(push), "a single-lead server write moves the lead's stamp on");
  const route = read("../app/api/school-data/admissions-desk/route.ts");
  assert.ok(/readStampsParam\(body\.stamps, ADMISSION_SLICES\)/.test(route) && /pushAdmissionDeskToDb\(normalized, \{ stamps(, deletes)? \}\)/.test(route));
  assert.ok(/stamps: stampsFor\(stripped, stamps\)/.test(route) && /^\s*stamps,$/m.test(route), "both GET shapes carry stamps");
  const client = read("admissionsNormalizedClient.ts");
  assert.ok(/stamps: sentStamps/.test(client) && /applyStampedSave\(\s*ADMISSIONS_DESK/.test(client) && /onStampConflicts\(ADMISSIONS_DESK, body\.conflicts\)/.test(client));
  assert.ok(/captureAdmissionStamps\(deskStamps, normalizeAdmissionsState\(loadAdmissions\(\)\)\)/.test(read("admissionsPersistence.ts")), "every load captures stamps");

  console.log("admissionsRowStamps.selftest: all assertions passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
