import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { featureAuthorizedDeletes } from "./deskNamedDeletesFeature.server";

console.log("admissionsLibraryRtePtmExamsNoPrune.selftest.ts");

/**
 * Admissions, library, RTE, PTM and exam setup each pruned every row a desk
 * save did not carry. Fresh enquiries from the public form and the WhatsApp
 * bot were deleted by any office browser that had read before they arrived;
 * an empty browser's PTM or RTE seed (pushed before it pulled the desk)
 * deleted every other event — bookings and feedback cascading — or every
 * stored quota seat; library loans went with any title or copy a stale copy
 * lacked. Now nothing is deleted by absence: leads, households, subjects,
 * promotions and loans never; the rest only by named id. This reads the push
 * code itself, so a prune cannot quietly come back.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

function pushOf(src: string, start: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `found ${start}`);
  // Up to the next top-level declaration.
  const ends = ["\nexport ", "\nasync function ", "\nfunction "]
    .map((m) => src.indexOf(m, a + start.length))
    .filter((i) => i > 0);
  return src.slice(a, ends.length ? Math.min(...ends) : undefined);
}

function guard(opts: {
  label: string;
  file: string;
  push: string;
  named: string[];
  constName?: string;
  route?: string;
  client?: string;
  ui?: [file: string, call: RegExp][];
}) {
  const src = read(opts.file);
  assert.equal(/deleteStale/.test(src), false, `${opts.label}: no prune-by-absence helper`);
  const push = pushOf(src, opts.push);
  assert.equal(/\.delete\(\)/.test(push), false, `${opts.label}: no direct deletes in the push`);
  if (!opts.named.length) {
    assert.equal(/deleteNamedIds/.test(push), false, `${opts.label}: deletes nothing at all`);
    return;
  }
  assert.ok(/deleteNamedIds\(sb, tenantId, table, deletes\[table\]\)/.test(push), `${opts.label}: named deletes`);
  const list = src.slice(src.indexOf(`${opts.constName} = [`), src.indexOf("] as const;", src.indexOf(`${opts.constName} = [`)));
  assert.deepEqual(
    [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort(),
    [...opts.named].sort(),
    `${opts.label}: deletable tables`,
  );
  if (opts.route) {
    assert.ok(
      new RegExp(`readNamedDeletes\\(body\\.deletes, ${opts.constName}\\)`).test(read(opts.route)),
      `${opts.label}: route reads named deletes`,
    );
  }
  if (opts.client) assert.ok(/deletes: sentDeletes/.test(read(opts.client)), `${opts.label}: client sends them`);
  for (const [f, re] of opts.ui ?? []) assert.ok(re.test(read(f)), `${opts.label}: ${f} names its deletion (${re})`);
}

guard({
  label: "admissions",
  file: "admissionsNormalized.server.ts",
  push: "export async function pushAdmissionDeskToDb",
  named: [],
});

guard({
  label: "library",
  file: "libraryNormalized.server.ts",
  push: "export async function pushLibraryDeskToDb",
  named: ["library_desk_titles", "library_desk_copies", "library_desk_procurement_docs"],
  constName: "LIBRARY_DELETABLE_TABLES",
  route: "../app/api/school-data/library-desk/route.ts",
  client: "libraryNormalizedClient.ts",
  ui: [
    ["library.ts", /recordLibraryDeletion\("library_desk_titles", \[titleId\]\)/],
    ["library.ts", /recordLibraryDeletion\("library_desk_copies", \[\.\.\.removeIds\]\)/],
    ["library.ts", /recordLibraryDeletion\("library_desk_procurement_docs", \[docId\]\)/],
  ],
});
assert.ok(/page\("library_desk_issues"\)/.test(read("libraryNormalized.server.ts")), "library reads are paged");

guard({
  label: "rte",
  file: "rteNormalized.server.ts",
  push: "export async function pushRteDeskToDb",
  named: ["rte_desk_seats", "rte_desk_applications"],
  constName: "RTE_DELETABLE_TABLES",
  route: "../app/api/school-data/rte-desk/route.ts",
  client: "rteNormalizedClient.ts",
  ui: [
    ["rteEws.ts", /recordRteDeletion\("rte_desk_seats", \[id\]\)/],
    ["rteEws.ts", /recordRteDeletion\("rte_desk_applications", \[id\]\)/],
  ],
});

guard({
  label: "ptm",
  file: "ptmNormalized.server.ts",
  push: "export async function pushPtmDeskToDb",
  named: ["ptm_desk_events", "ptm_desk_slots"],
  constName: "PTM_DELETABLE_TABLES",
  route: "../app/api/school-data/ptm-desk/route.ts",
  client: "ptmNormalizedClient.ts",
  ui: [
    ["ptm.ts", /recordPtmDeletion\("ptm_desk_events", \[eventId\]\)/],
    ["ptm.ts", /recordPtmDeletion\("ptm_desk_slots", \[slotId\]\)/],
  ],
});

guard({
  label: "exams",
  file: "examsNormalized.server.ts",
  push: "export async function pushExamDeskToDb",
  named: ["exam_desk_terms", "exam_desk_date_sheet", "exam_desk_rooms", "exam_desk_seating"],
  constName: "EXAMS_DELETABLE_TABLES",
  route: "../app/api/school-data/exams-desk/route.ts",
  client: "examsNormalizedClient.ts",
  ui: [
    ["exams.ts", /recordExamsDeletion\("exam_desk_terms", \[termId\]\)/],
    ["exams.ts", /recordExamsDeletion\("exam_desk_date_sheet", \[entryId\]\)/],
    ["exams.ts", /recordExamsDeletion\("exam_desk_rooms", \[roomId\]\)/],
    ["exams.ts", /recordExamsDeletion\("exam_desk_seating", \[planId\]\)/],
  ],
});

// A deleted exam's empty sheets: only for exams the user deleted, by name.
{
  const src = read("examsNormalized.server.ts");
  assert.equal(/deleteOrphanEmptySheets/.test(src), false, "no 'sheets of terms this browser lacks' cleanup");
  assert.ok(/deleteEmptySheetsOfTerms\(sb, tenantId, \[\.\.\.goneTerms\]\)/.test(src));
}

// Function-only writers: the gated routes narrow named deletes to rows the
// gate's merge actually dropped.
for (const r of ["rte-desk", "ptm-desk", "exams-desk"]) {
  assert.ok(
    /deletes = featureAuthorizedDeletes\(deletes, [A-Z]+_TABLE_SLICES, stored\.bundle, merged\.state\)/.test(
      read(`../app/api/school-data/${r}/route.ts`),
    ),
    `${r}: function-holder deletes are gate-authorized`,
  );
}

// ── featureAuthorizedDeletes ───────────────────────────────────────────────
{
  const slices = { t_seats: "seats" };
  const stored = { seats: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  const merged = { seats: [{ id: "a" }, { id: "c" }] };
  // Named and dropped by the gate → deleted.
  assert.deepEqual(featureAuthorizedDeletes({ t_seats: ["b"] }, slices, stored, merged), { t_seats: ["b"] });
  // Named but the gate kept it (role may not delete) → not deleted.
  assert.deepEqual(featureAuthorizedDeletes({ t_seats: ["a"] }, slices, stored, merged), {});
  // Dropped by the merge but never named (a stale copy) → not deleted.
  assert.deepEqual(featureAuthorizedDeletes({}, slices, stored, merged), {});
  // A table with no slice mapping → nothing.
  assert.deepEqual(featureAuthorizedDeletes({ other: ["b"] }, slices, stored, merged), {});
}

console.log("admissionsLibraryRtePtmExamsNoPrune.selftest: all assertions passed");
