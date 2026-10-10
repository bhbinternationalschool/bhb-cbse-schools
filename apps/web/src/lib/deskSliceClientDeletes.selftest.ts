import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deskSliceDef } from "./deskSliceRegistry";
import { computeDeskSliceDeletions } from "./deskSliceNormalizedClient";

console.log("deskSliceClientDeletes.selftest.ts");

/**
 * Roles and grants, exam papers, advances, and leave types/balances were the
 * last slice-desk lists a save REPLACED: the UI deletes from them, so a merge
 * would have brought deleted rows back — and replacing let a stale browser
 * overwrite the whole list. Now they merge too, and the browser names its
 * deletions: rows it knew from the server (last load/save this session) and
 * has since dropped. A row created elsewhere was never known here, so it can
 * never be taken for a deletion; a lost cache is refused, not obeyed.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const was = (o: Record<string, string[]>) => new Map(Object.entries(o));
const rows = (...ids: string[]) => ids.map((id) => ({ id }));

// ── The registry ───────────────────────────────────────────────────────────
{
  const sorted = (a?: string[]) => [...(a ?? [])].sort();
  assert.deepEqual(sorted(deskSliceDef("rbac")?.clientDeleteSlices), ["assignments", "roles", "userGrants"]);
  assert.deepEqual(sorted(deskSliceDef("exam_papers")?.clientDeleteSlices), ["bank", "blueprints", "papers"]);
  assert.deepEqual(sorted(deskSliceDef("staff_advances")?.clientDeleteSlices), ["advances"]);
  assert.deepEqual(sorted(deskSliceDef("staff_hr")?.clientDeleteSlices), ["leaveBalances", "leaveTypes"]);
  assert.equal(deskSliceDef("staff_hr")?.mergeKeys?.leaveTypes, "code", "leave types are keyed by code");
  assert.equal(deskSliceDef("rbac")?.mergeCaps?.audit?.max, 200, "the rbac audit keeps its newest 200");
  // Every client-delete slice is a merge slice (deletes apply to merge slices only).
  for (const id of ["rbac", "exam_papers", "staff_advances", "staff_hr"] as const) {
    const d = deskSliceDef(id)!;
    for (const s of d.clientDeleteSlices ?? []) assert.ok(d.mergeSlices?.includes(s), `${id}.${s} merges`);
  }
}

// ── What a save deletes ────────────────────────────────────────────────────
{
  const advances = deskSliceDef("staff_advances")!;
  // Voiding one advance names exactly it.
  assert.deepEqual(
    computeDeskSliceDeletions(advances, was({ advances: ["a1", "a2", "a3"] }), { advances: rows("a1", "a3") }).deletes,
    { advances: ["a2"] },
  );
  // An advance created on another device (never known here) is not deleted.
  assert.deepEqual(
    computeDeskSliceDeletions(advances, was({ advances: ["a1"] }), { advances: rows("a1") }).deletes,
    {},
  );
  // Deleting the last one is allowed.
  assert.deepEqual(
    computeDeskSliceDeletions(advances, was({ advances: ["a1"] }), { advances: [] }).deletes,
    { advances: ["a1"] },
  );
  // Nothing known yet (not loaded this session): nothing is named.
  assert.deepEqual(computeDeskSliceDeletions(advances, undefined, { advances: [] }).deletes, {});
  // A lost cache — every deletable list empty while 2+ rows were known — names nothing.
  const lost = computeDeskSliceDeletions(advances, was({ advances: ["a1", "a2"] }), { advances: [] });
  assert.deepEqual(lost.deletes, {});
  assert.ok(lost.skipped);
}
{
  const papers = deskSliceDef("exam_papers")!;
  const many = Array.from({ length: 30 }, (_, i) => `p${i}`);
  // 25 of 30 gone at once: a lost cache, not a person deleting.
  const res = computeDeskSliceDeletions(papers, was({ papers: many, bank: ["b1"], blueprints: [] }), {
    papers: rows(...many.slice(0, 5)),
    bank: rows("b1"),
    blueprints: [],
  });
  assert.equal(res.deletes.papers, undefined);
  // Deleting one paper from 30 is named.
  assert.deepEqual(
    computeDeskSliceDeletions(papers, was({ papers: many }), { papers: rows(...many.slice(1)), bank: [], blueprints: [] }).deletes,
    { papers: ["p0"] },
  );
}
{
  // Leave types are matched by code; a removed type and its balances are named.
  const hr = deskSliceDef("staff_hr")!;
  assert.deepEqual(
    computeDeskSliceDeletions(
      hr,
      was({ leaveTypes: ["CL", "SL", "EL"], leaveBalances: ["b-cl", "b-sl"] }),
      { leaveTypes: [{ code: "CL" }, { code: "EL" }], leaveBalances: rows("b-cl") },
    ).deletes,
    { leaveTypes: ["SL"], leaveBalances: ["b-sl"] },
  );
}
{
  // A grant edited in place gets a new id: the superseded one is named, so a
  // merge cannot keep both.
  const rbac = deskSliceDef("rbac")!;
  assert.deepEqual(
    computeDeskSliceDeletions(rbac, was({ userGrants: ["g-old"], roles: ["r1"], assignments: [] }), {
      userGrants: rows("g-new"),
      roles: rows("r1"),
      assignments: [],
    }).deletes,
    { userGrants: ["g-old"] },
  );
}

// ── Wiring ─────────────────────────────────────────────────────────────────
{
  const client = read("deskSliceNormalizedClient.ts");
  assert.ok(/noteDeskSliceDeletions\(id, state\);\s*pending\.set\(id, state\)/.test(client), "every save computes its deletions");
  assert.ok(/deletes: sentDeletes/.test(client) && /confirmDeskDeletes\(deskKey\(id\), sentDeletes\)/.test(client), "sent, and forgotten only once confirmed");
  assert.ok(/rememberDeskSliceKnownIds\(id, state\)/.test(client), "a successful save updates what is known");
  assert.equal(/localStorage[\s\S]{0,80}known/.test(client), false, "known ids are memory-only");
  assert.ok(/rememberDeskSliceKnownIds\(\s*opts\.moduleId/.test(read("createDeskSlicePersistence.ts")), "a successful load sets what is known");

  const route = read("../app/api/school-data/desk-slice/[module]/route.ts");
  assert.ok(/readSliceDeletes\(body\.deletes, def\.clientDeleteSlices \?\? \[\]\)/.test(route), "the route accepts deletes for those slices only");
  assert.ok(/deletes = gateAuthorizedSliceDeletes\(/.test(route), "function holders: named AND dropped by the gate");
  assert.ok(/pushDeskSliceToDb\(id, body, \{ allowShrink, deletes, revs \}\)/.test(route));

  const server = read("deskSliceNormalized.server.ts");
  assert.ok(/const field = def\.mergeKeys\?\.\[key\] \?\? "id";/.test(server), "named deletes respect the slice's key");
  assert.ok(/mergeWithRevs\(storedNow, incoming, \{ key: field,/.test(server), "keyed slices merge by their key");
}

console.log("deskSliceClientDeletes.selftest: all assertions passed");
