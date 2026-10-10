/**
 * Proves the data-layer contract still makes the 2026-08-09/10 bug shapes
 * unrepresentable.
 *
 * Most of the value here is at COMPILE time, not run time. Each
 * `@ts-expect-error` asserts that a line does not typecheck. If someone
 * later loosens a type so the line becomes legal, the directive turns into
 * an "unused '@ts-expect-error'" error and `npm run verify` fails on
 * typecheck. The guarantee therefore cannot rot quietly, which is exactly
 * what happened to the guarantees these types replace.
 *
 * Run: npx tsx src/lib/data/contract.selftest.ts
 */
import assert from "node:assert/strict";
import {
  asRevision,
  describeWriteFailure,
  isReadOk,
  isWriteOk,
  type ReadResult,
  type Revision,
  type WriteOp,
  type WriteResult,
} from "./types";
import { COLLECTIONS, collectionDef, collectionIds } from "./registry";

type Student = { id: string; fullName: string };

// ─── A revision may only come from the server ────────────────────────────
// The masters outage: persistMastersClient stamped `new Date()` into the key
// the push sends as `baseUpdatedAt`, so the client claimed to have hydrated
// at a revision that never existed and every save after the first was
// refused. These lines are the type system refusing to let that recur.
{
  // @ts-expect-error — a local clock is not a Revision
  const fromClock: Revision = new Date().toISOString();
  void fromClock;

  // @ts-expect-error — nor is an arbitrary string
  const fromLiteral: Revision = "2026-08-10T05:00:00.000Z";
  void fromLiteral;

  // Only the server boundary may mint one.
  const fromServer: Revision = asRevision("2026-08-10T05:00:00.000Z");
  assert.equal(String(fromServer), "2026-08-10T05:00:00.000Z");
}

// ─── A failed read has no rows to mistake for "no records" ───────────────
// hydrateXFromDb used to return {bundle:{}, ok:false} — success-shaped, with
// a flag nobody was obliged to check. A caller that ignored `ok` rendered an
// empty screen and pushed the emptiness back.
{
  const failed: ReadResult<Student> = {
    ok: false,
    code: "unavailable",
    error: "tenant unavailable",
  };

  // @ts-expect-error — there is no `rows` on a failure, so it cannot be
  // rendered as an empty list by accident
  void failed.rows;

  // The compiler forces the narrowing before any data is reachable.
  assert.equal(isReadOk(failed), false);
  if (isReadOk(failed)) {
    assert.fail("unreachable");
  }

  const okRead: ReadResult<Student> = {
    ok: true,
    rows: [{ id: "s1", fullName: "A" }],
    nextCursor: null,
    serverTime: "2026-08-10T05:00:00.000Z",
  };
  assert.equal(isReadOk(okRead), true);
  if (isReadOk(okRead)) {
    assert.equal(okRead.rows.length, 1);
  }
}

// ─── A failed write cannot be read as a success ──────────────────────────
{
  const failed: WriteResult<Student> = {
    ok: false,
    kind: "conflict",
    message: "stale",
    conflicts: [
      {
        id: "s1",
        status: "conflict",
        revision: asRevision("2026-08-10T05:00:00.000Z"),
        stored: { id: "s1", fullName: "theirs" },
      },
    ],
  };

  // @ts-expect-error — no `results` on a failure
  void failed.results;

  assert.equal(isWriteOk(failed), false);
  if (!isWriteOk(failed)) {
    assert.equal(failed.conflicts.length, 1);
  }
}

// ─── Only the network case may blame the user's connection ───────────────
// Telling someone to check a working router because the SERVER failed is
// what sent the director hunting a fault that was not theirs.
{
  const connectionWording = /connection/i;
  const cases: WriteResult<Student>[] = [
    { ok: false, kind: "network", message: "", conflicts: [] },
    { ok: false, kind: "auth", message: "", conflicts: [] },
    { ok: false, kind: "unavailable", message: "", conflicts: [] },
    { ok: false, kind: "conflict", message: "", conflicts: [] },
  ];

  for (const c of cases) {
    if (isWriteOk(c)) continue;
    const text = describeWriteFailure(c);
    assert.match(text, /not saved/i, `"${c.kind}" must say it was not saved`);
    if (c.kind === "network") {
      assert.match(text, connectionWording, "network may mention connection");
    } else {
      assert.doesNotMatch(
        text,
        connectionWording,
        `"${c.kind}" must NOT blame the user's connection`,
      );
    }
  }
}

// ─── A write op states its intent; a partial row is legal ────────────────
// The server patches rather than replaces, so sending only the changed field
// must not erase the rest. (The first cut of desk_write_guarded did erase
// it — jsonb_populate_record nulls every omitted column.)
{
  const patch: WriteOp<Student> = {
    op: "upsert",
    id: "s1",
    base: asRevision("2026-08-10T05:00:00.000Z"),
    row: { fullName: "only this field" },
  };
  assert.equal(patch.op === "upsert" && "fullName" in patch.row, true);

  // A delete carries a base too — removing someone else's newer record by
  // accident is as bad as overwriting it.
  const del: WriteOp<Student> = {
    op: "delete",
    id: "s1",
    base: asRevision("2026-08-10T05:00:00.000Z"),
  };
  assert.equal(del.op, "delete");

  const deleteWithRow: WriteOp<Student> = {
    op: "delete",
    id: "s1",
    base: null,
    // @ts-expect-error — a delete states an id, never a payload; smuggling
    // a row through a delete is how "delete" quietly becomes "overwrite"
    row: { fullName: "smuggled" },
  };
  void deleteWithRow;
}

// ─── Registry invariants ─────────────────────────────────────────────────
{
  assert.ok(COLLECTIONS.length > 0, "registry must not be empty");

  const ids = collectionIds();
  assert.equal(
    new Set(ids).size,
    ids.length,
    "collection ids must be unique — they are URL segments",
  );

  for (const c of COLLECTIONS) {
    assert.ok(
      c.scope.includes("tenant_id"),
      `${c.id}: tenant_id is mandatory or one school reads another's records`,
    );
    assert.ok(
      c.list.maxLimit >= c.list.defaultLimit,
      `${c.id}: maxLimit must not be below defaultLimit`,
    );
    assert.ok(
      c.list.maxLimit > 0 && c.list.maxLimit <= 1000,
      `${c.id}: an unbounded page size is how admissions reached 2.37 MB`,
    );
    assert.ok(c.table.length > 0, `${c.id}: needs a table`);
    assert.ok(c.rbac.view && c.rbac.edit, `${c.id}: needs view and edit keys`);
  }

  // Records that belong to a session must be scoped to one.
  const students = collectionDef("sis.students");
  assert.ok(students, "sis.students must exist");
  // NOT scoped by academic_year_code, and this assertion was the opposite
  // until 2026-08-10. It encoded the same plausible assumption the registry
  // did: "students belong to a session".
  //
  // Measured against production: of 680 ACTIVE students, academic_year_code
  // reads 2026-27 for 238, 2025-26 for 213, 2024-25 for 142 and 2023-24 for
  // 88 — every group holding currently enrolled children from Nursery to X,
  // all with earliest_joined 2023-01-01. The column records when a record was
  // created or imported and was never advanced.
  //
  // Scoping by it would return 238 of 680: a roster missing two thirds of the
  // school, presented as the roster. A test written from the same assumption
  // as the code confirms the assumption, not the behaviour — which is why
  // this one is pinned to the measurement instead.
  assert.ok(
    !students.scope.includes("academic_year_code"),
    "sis_students.academic_year_code is an import stamp, not the current " +
      "session — scoping by it hides 442 of 680 active students",
  );
  assert.deepEqual(students.scope, ["tenant_id"]);

  // The admissions collection is the genuine contrast: there the column is
  // the intake year sought, a real property of a lead, so the scope is right.
  const leads = collectionDef("admissions.leads");
  assert.ok(leads, "admissions.leads must exist");
  assert.ok(
    leads.scope.includes("academic_year_code"),
    "a lead's academic_year_code IS the year it is for — 690 of 919 leads " +
      "are 2025-26 enquiries and must not be mixed into this year's list",
  );

  // An unknown id must be undefined, never a guess — it arrives from a URL.
  assert.equal(collectionDef("sis.students; drop table"), undefined);
  assert.equal(collectionDef("profiles"), undefined);
}

console.log("data/contract.selftest: all assertions passed");
