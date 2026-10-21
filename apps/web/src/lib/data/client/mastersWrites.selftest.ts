/**
 * Run: npm run test:masters-writes
 *
 * Data-layer 2.2b — the Masters write plumbing:
 *  1. the registry: every Masters list writes on its element's `_rev`;
 *     useMastersMutation finds each slice's collection;
 *  2. the commit adapter (mastersCommit.ts): only differences are sent, with
 *     the served `_rev` as base; > 1 delete, an emptied list, bad ids refused;
 *  3. the function-grant rule for element writes (sliceFunctionRules.ts):
 *     a teacher's own-class class subjects, nothing else;
 *  4. the masters view passes `_rev` through and hands out object-slice stamps;
 *  5. the staff bridge re-reads the roster into the page copy after a write.
 */
import assert from "node:assert/strict";
import { COLLECTIONS, collectionKind } from "../registry";
import { mastersListCommitOps, mastersObjectCommitOp, sameElement } from "./mastersCommit";
import { mastersCollectionFor } from "./writeHooks";
import { bridgeStaffAfterWrite } from "./staffBridge";
import { decideSliceOps } from "../server/sliceFunctionRules";
import { MASTERS_FEATURES } from "@/lib/rbacFeatureCatalog/masters";
import * as views from "../server/views";
import type { WriteOp } from "../types";

type Row = Record<string, unknown>;

async function main(): Promise<void> {
  console.log("mastersWrites.selftest.ts");

  /* ── 1. Registry ── */
  {
    const lists = COLLECTIONS.filter((c) => c.module === "masters" && collectionKind(c) === "slice");
    assert.equal(lists.length, 21, "21 Masters list collections");
    for (const c of lists) assert.equal(c.slice?.base, "rev", `${c.id} writes on the element's _rev`);
    const objects = COLLECTIONS.filter((c) => c.module === "masters" && collectionKind(c) === "object");
    for (const c of objects) assert.equal(c.slice?.base, "slice", `${c.id} (an object) writes on the slice stamp`);
    assert.deepEqual(mastersCollectionFor("classSubjects"), { id: "masters.class-subjects", kind: "slice", keyField: "id" });
    assert.deepEqual(mastersCollectionFor("schoolProfile"), { id: "masters.school-profile", kind: "object", keyField: "id" });
    assert.equal(mastersCollectionFor("staff"), null, "staff is not a Masters list");
    assert.equal(mastersCollectionFor("nope"), null);
    for (const id of ["sis.staff", "sis.departments", "sis.designations"]) {
      const d = COLLECTIONS.find((c) => c.id === id)!;
      assert.ok(d && collectionKind(d) === "rows" && d.rbac.edit === "staff" && d.approval?.onDelete && d.approval.action === "delete", id);
    }
    assert.equal(COLLECTIONS.find((c) => c.id === "sis.staff")!.softDelete, true, "staff Remove is soft");
    console.log("  ✓ registry: 21 lists on _rev, objects on the stamp, the three staff collections");
  }

  /* ── 2. The commit adapter ── */
  {
    const served = [
      { id: "eng", nameEn: "English", code: "ENG", _rev: 3 },
      { id: "hin", nameEn: "Hindi", code: "HIN", _rev: 1 },
      { id: "sci", nameEn: "Science", code: "SCI", _rev: 7 },
    ];
    // Rename one, add one, remove one; `hin` comes back with an OLDER _rev — unchanged.
    const next = [
      { id: "eng", nameEn: "English Language", code: "ENG", _rev: 3 },
      { id: "hin", nameEn: "Hindi", code: "HIN", _rev: 0 },
      { id: "art", nameEn: "Art", code: "ART" },
    ];
    const c = mastersListCommitOps("subjects", served, next);
    assert.ok(c.ok, c.ok ? "" : c.reason);
    const ops = (c.ok ? c.ops : []) as (WriteOp<Row> & { row?: Row })[];
    assert.deepEqual(
      ops.map((o) => [o.op, o.id, o.base]),
      [
        ["delete", "sci", "7"],
        ["upsert", "eng", "3"],
        ["upsert", "art", null],
      ],
      "only the differences, each on its served _rev; a new id has no base",
    );
    assert.ok(!("_rev" in ops[1]!.row!), "a client never sends _rev");
    // A key the editor dropped is said (the kernel patches).
    const dropped = mastersListCommitOps("subjects", [{ id: "eng", nameEn: "E", streamId: "s1", _rev: 2 }], [{ id: "eng", nameEn: "E" }]);
    assert.ok(dropped.ok && (dropped.ops[0] as { row: Row }).row.streamId === null);
    // Nothing changed → nothing to send.
    const same = mastersListCommitOps("subjects", served, served.map((s) => ({ ...s, _rev: 99 })));
    assert.ok(same.ok && same.ops.length === 0, "an older/newer _rev alone is no change");
    // Refusals.
    const two = mastersListCommitOps("subjects", served, [served[0]]);
    assert.ok(!two.ok && /remove 2 subjects at once/.test(two.reason), "more than one delete in one commit");
    const empty = mastersListCommitOps("subjects", served, []);
    assert.ok(!empty.ok && /empty/.test(empty.reason), "a list going empty");
    assert.ok(!mastersListCommitOps("subjects", served, [{ id: "eng" }, { id: "eng" }]).ok, "an id twice");
    assert.ok(!mastersListCommitOps("subjects", served, [{ nameEn: "x" }]).ok, "an element without an id");
    assert.ok(!mastersListCommitOps("subjects", undefined, next).ok, "nothing served = nothing to compare with");
    assert.ok(mastersListCommitOps("holidays", [], [{ id: "h1", date: "2026-11-01" }]).ok, "a first element on an empty list");
    // Object slices.
    const o = mastersObjectCommitOp("schoolProfile", { name: "BHB" }, { name: "BHB School" }, "2026-10-21T09:00:00.1+00:00");
    assert.ok(o.ok && o.ops.length === 1 && o.ops[0]!.base === "2026-10-21T09:00:00.1+00:00" && o.ops[0]!.id === "schoolProfile");
    assert.ok(!mastersObjectCommitOp("schoolProfile", { name: "BHB" }, {}, "s").ok, "an empty object");
    assert.ok(!mastersObjectCommitOp("schoolProfile", { name: "BHB" }, null, "s").ok);
    assert.ok(!mastersObjectCommitOp("schoolProfile", { name: "BHB" }, { name: "x" }, undefined).ok, "no stamp for a stored value");
    const noop = mastersObjectCommitOp("schoolProfile", { name: "BHB" }, { name: "BHB" }, "s");
    assert.ok(noop.ok && noop.ops.length === 0);
    assert.ok(sameElement({ a: 1, b: undefined, _rev: 2 }, { a: 1 }));
    console.log("  ✓ commit adapter: differences on served _rev; >1 delete, empty, bad ids refused; objects on the stamp");
  }

  /* ── 3. Function-grant rule for element writes ── */
  {
    const feature = MASTERS_FEATURES.find((f) => f.id === "masters.class_subjects")!;
    const stored = new Map<string, Row>([
      ["l1", { id: "l1", classId: "c6", subjectId: "eng", _rev: 2 }],
      ["l3", { id: "l3", classId: "c7", subjectId: "eng", _rev: 1 }],
    ]);
    const teacher = (_f: string, a: string) => ({ allowed: a !== "view" || true, ownClassesOnly: true });
    const own = new Set(["c6"]);
    const run = (ops: object[], access = teacher, ownIds: Set<string> | null = own, mode: "module" | "function" = "function") =>
      decideSliceOps({ feature, ops: ops as WriteOp<Row>[], stored, access, ownClassIds: ownIds, mode, classLabel: (c) => ({ c6: "Class 6", c7: "Class 7" })[c] ?? c });
    assert.ok(run([{ op: "upsert", id: "l1", base: "2", row: { periodsPerWeek: 6 } }]).ok, "edit in her class");
    assert.ok(run([{ op: "upsert", id: "l9", base: null, row: { classId: "c6", subjectId: "art" } }]).ok, "add in her class");
    assert.ok(run([{ op: "delete", id: "l1", base: "2" }]).ok, "remove in her class");
    const other = run([{ op: "upsert", id: "l3", base: "1", row: { periodsPerWeek: 6 } }]);
    assert.ok(!other.ok && /Class 7 is not one of your classes/.test(other.message), "another class: refused");
    const move = run([{ op: "upsert", id: "l1", base: "2", row: { classId: "c7" } }]);
    assert.ok(!move.ok, "moving her link to another class: refused");
    const addOther = run([{ op: "upsert", id: "l8", base: null, row: { classId: "c7", subjectId: "art" } }]);
    assert.ok(!addOther.ok, "adding in another class: refused");
    const noClass = run([{ op: "upsert", id: "l7", base: null, row: { subjectId: "art" } }]);
    assert.ok(!noClass.ok, "a new link with no class: refused");
    const batch = run([
      { op: "upsert", id: "l1", base: "2", row: { periodsPerWeek: 6 } },
      { op: "delete", id: "l3", base: "1" },
    ]);
    assert.ok(!batch.ok, "one op out of bounds refuses the batch");
    const createOnly = (_f: string, a: string) => ({ allowed: a === "create", ownClassesOnly: true });
    const noEdit = run([{ op: "upsert", id: "l1", base: "2", row: { periodsPerWeek: 6 } }], createOnly);
    assert.ok(!noEdit.ok && /You may not change class subjects — ask the office/.test(noEdit.message), "edit not held");
    assert.ok(run([{ op: "delete", id: "gone", base: "1" }], createOnly).ok, "deleting what is not there changes nothing");
    // Unrestricted (leadership) function holder: no class limit.
    assert.ok(run([{ op: "upsert", id: "l3", base: "1", row: { periodsPerWeek: 6 } }], teacher, null).ok);
    // Whole-module holder personally denied delete.
    const denyDelete = (_f: string, a: string) => ({ allowed: a !== "delete", ownClassesOnly: false });
    const md = run([{ op: "delete", id: "l3", base: "1" }], denyDelete, null, "module");
    assert.ok(!md.ok && /turned off for you/.test(md.message), "module holder: a personal deny closes the function");
    assert.ok(run([{ op: "upsert", id: "l3", base: "1", row: { periodsPerWeek: 6 } }], denyDelete, null, "module").ok);
    console.log("  ✓ function grant: own-class class subjects only; edit/add/remove each checked; batch all-or-none");
  }

  /* ── 4. The masters view: `_rev` through, object-slice stamps out ── */
  {
    const book = {
      version: 2,
      classes: [{ id: "c6", name: "Class 6", _rev: 4 }],
      sections: [{ id: "s6", classId: "c6", _rev: 1 }],
      subjects: [{ id: "eng", nameEn: "English", _rev: 9 }],
      classSubjects: [{ id: "l1", classId: "c6", subjectId: "eng", _rev: 2 }],
      feeHeads: [{ id: "f1", name: "Tuition", _rev: 5 }],
      schoolProfile: { name: "BHB" },
      schoolTiming: { start: "08:00" },
      statutoryConfig: { epfRate: 12 },
      staff: [],
      departments: [],
      designations: [],
    } as unknown as import("@/lib/masters").MastersState;
    const stamps = {
      classes: "2026-10-21T01:00:00.000001+00:00",
      schoolProfile: "2026-10-21T02:00:00.000002+00:00",
      schoolTiming: "2026-10-21T03:00:00.000003+00:00",
      statutoryConfig: "2026-10-21T04:00:00.000004+00:00",
    };
    let scope: "full" | "teaching" = "full";
    const deps = {
      mastersScope: async () => ({ ok: true as const, scope, auth: {} as never }),
      requireStaff: async () => ({ ok: true }) as never,
      requireSettingsView: async () => ({ ok: true }) as never,
      mirrorSecret: () => false,
      readMasters: async () => ({ ok: true as const, value: book, stale: false, from: "cache" as const, builtFrom: null }),
      readRbac: async () => ({ ok: false as const, error: "x" }),
      readModuleRegistry: async () => ({ ok: false as const, error: "x" }),
      mastersStamps: (s: unknown) => (s === book ? stamps : null),
    };
    const get = async () => (await (await views.mastersViewGet(new Request("https://x.test/v"), deps as never)).json()) as {
      data: { masters: Record<string, Row[]>; stamps: Record<string, string> };
    };
    const full = await get();
    assert.equal(full.data.masters.classes[0]!._rev, 4, "an element's _rev reaches the browser");
    assert.equal(full.data.masters.feeHeads[0]!._rev, 5);
    assert.deepEqual(
      full.data.stamps,
      { schoolProfile: stamps.schoolProfile, schoolTiming: stamps.schoolTiming, statutoryConfig: stamps.statutoryConfig },
      "object slices only, at full precision",
    );
    scope = "teaching";
    const teach = await get();
    assert.equal(teach.data.masters.classSubjects[0]!._rev, 2, "a teacher gets her class subjects' _rev too");
    assert.deepEqual(Object.keys(teach.data.stamps).sort(), ["schoolProfile", "schoolTiming"], "no stamp for a withheld object");
    const without = (await (await views.mastersViewGet(new Request("https://x.test/v"), { ...deps, mastersStamps: undefined } as never)).json()) as {
      data: { stamps: Record<string, string> };
    };
    assert.deepEqual(without.data.stamps, {}, "no stamps known = none given (a commit of an object then refuses)");
    console.log("  ✓ masters view: _rev passed through; object-slice stamps (withheld ones left out)");
  }

  /* ── 5. The staff bridge ── */
  {
    const calls: string[] = [];
    const ok = await bridgeStaffAfterWrite({
      reset: () => calls.push("reset"),
      hydrate: async () => {
        calls.push("hydrate");
        return true;
      },
    });
    assert.ok(ok);
    assert.deepEqual(calls, ["reset", "hydrate"], "forget the loaded mark, then re-read from the server");
    const bad = await bridgeStaffAfterWrite({
      reset: () => undefined,
      hydrate: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(bad, false, "a failed re-read is reported, never thrown");
    assert.equal(await bridgeStaffAfterWrite(null), false, "no page copy (server) = nothing to do");
    console.log("  ✓ staff bridge: reset → re-read; failures reported, not thrown");
  }

  console.log("mastersWrites.selftest: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
