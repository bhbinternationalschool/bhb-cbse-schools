/**
 * Run: npm run test:masters-bridge
 *
 * data-layer 2.1a — the bridge from useMasters() to the tab's page-memory
 * Masters copy (lib/data/client/mastersBridge.ts), run against the REAL
 * page copy: a fake browser window (memory-only `bhb_masters_v5`, the same
 * path a tab uses), the real loadMasters() / writeMastersLocalRaw(), and
 * useMasters()'s own answer handler (acceptMastersAnswer in hooks.tsx).
 *
 *  1. A full answer replaces the book — renamed section, new subject, new
 *     fee head all reach loadMasters() — and leaves the staff roster,
 *     departments, designations and the SIS student projection exactly as
 *     the page copy had them (the view does not carry them).
 *  2. A teaching answer (a teacher: fee lists withheld, sent empty) updates
 *     classes / sections / subjects and leaves every fee list, the
 *     concession grants and the roster exactly as they were — it never
 *     empties a fee list (the 13 Oct ensureFeeSetupInner lesson).
 *  3. Nothing leaves the tab: no fetch, no 'bhb-masters-updated' (or any)
 *     event, one write, synchronously (no await between load and write).
 *  4. A malformed answer is a failed read (throws) and the page copy is
 *     untouched; no browser = no bridge.
 *  5. screenMastersOf: the server book + the access copy's staff side; no
 *     access copy = null (a permission check never runs without a roster).
 *
 * Needs Supabase env (a real tenant: loadMasters must not seed a demo
 * school) — the npm script supplies placeholders.
 */
import assert from "node:assert/strict";

// ── A browser tab, enough of one: storage, events, fetch — each counted.
const events: string[] = [];
let fetches = 0;
const store = new Map<string, string>();
const fakeWindow = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
  dispatchEvent: (e: { type: string }) => {
    events.push(e.type);
    return true;
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  setTimeout,
  clearTimeout,
  location: { href: "http://127.0.0.1/", search: "", pathname: "/" },
};
(globalThis as unknown as { window: unknown }).window = fakeWindow;
(globalThis as unknown as { fetch: unknown }).fetch = async () => {
  fetches += 1;
  throw new Error("the bridge must not fetch");
};

void (async () => {
  try {
    const { buildFixture } = await import("../../../../e2e/fixture");
    const { isSupabaseConfigured } = await import("@/lib/supabase/client");
    if (!isSupabaseConfigured()) {
      console.error("mastersBridge.selftest: needs Supabase env — run `npm run test:masters-bridge`.");
      process.exit(1);
    }
    const { loadMasters } = await import("@/lib/masters");
    type MastersState = import("@/lib/masters").MastersState;
    const { writeMastersLocalRaw } = await import("@/lib/mastersPersistence");
    const { readCache } = await import("@/lib/browserStorage");
    /** The page copy exactly as stored (loadMasters() adds its read-time normalisation on top). */
    const stored = (): MastersState => JSON.parse(readCache("bhb_masters_v5") ?? "null") as MastersState;
    const { teachingMastersSubset } = await import("@/lib/mastersTeachingSubset");
    const bridge = await import("./mastersBridge");
    const { acceptMastersAnswer } = await import("./hooks");
    type MastersView = import("../viewTypes").MastersView;

    const fx = buildFixture();
    const projection = [
      { id: "proj_1", admissionNo: "P1", fullName: "Child One", classId: fx.masters.classes[0]!.id, sectionId: fx.masters.sections[0]!.id, status: "active" },
    ] as unknown as MastersState["students"];
    const feeHead = { id: "fh_tuition", code: "TUI", name: "Tuition", isActive: true } as unknown as MastersState["feeHeads"][number];
    const feeGroup = { id: "fg_1", name: "Primary", classIds: [fx.masters.classes[3]!.id] } as unknown as MastersState["feeGroups"][number];
    const line = { id: "fsl_1", feeGroupId: "fg_1", feeHeadId: "fh_tuition", amountPaise: 150000 } as unknown as MastersState["feeStructureLines"][number];
    const grant = { id: "cg_1", studentId: "stu_x", concessionId: "con_1" } as unknown as MastersState["concessionGrants"][number];

    /** The tab's copy as the old hydrates leave it: the book, the roster, the projection, fees. */
    function seedPageCopy(): MastersState {
      const copy: MastersState = {
        ...fx.masters,
        staff: fx.staff.staff,
        departments: fx.staff.departments,
        designations: fx.staff.designations,
        students: projection,
        feeHeads: [feeHead],
        feeGroups: [feeGroup],
        feeStructureLines: [line],
        concessionGrants: [grant],
      };
      writeMastersLocalRaw(copy);
      return loadMasters();
    }

    /** The server's book after an edit elsewhere: V-A renamed, a subject added. */
    function editedBook(): Record<string, unknown> {
      const book = { ...fx.masters } as unknown as Record<string, unknown>;
      delete book.staff;
      delete book.departments;
      delete book.designations;
      const sections = fx.masters.sections.map((s, i) => (i === 7 ? { ...s, name: "RENAMED" } : s));
      const subjects = [...fx.masters.subjects, { ...fx.masters.subjects[0]!, id: "sub_new", code: "NEW", nameEn: "Computer New" }];
      return {
        ...book,
        sections,
        subjects,
        // The server's own student slice — NOT this tab's projection.
        students: [],
        feeHeads: [feeHead, { ...feeHead, id: "fh_lab", code: "LAB", name: "Lab" }],
        feeGroups: [feeGroup],
        feeStructureLines: [line],
        concessionGrants: [grant],
      };
    }

    const before = seedPageCopy();
    assert.equal(before.staff.length, 35, "precondition: the page copy holds the roster");
    assert.equal(before.students.length, 1, "precondition: the page copy holds the projection");
    assert.ok(before.feeHeads.some((f) => f.id === "fh_tuition"), "precondition: the copy's fee head");
    assert.ok(!before.feeHeads.some((f) => f.id === "fh_lab"), "precondition: not yet the server's new one");

    // ── 1. Full answer, through useMasters()'s own handler.
    events.length = 0;
    fetches = 0;
    const full = acceptMastersAnswer({ scope: "full", masters: editedBook() });
    assert.equal(full.scope, "full");
    let after = loadMasters();
    assert.equal(after.sections[7]!.name, "RENAMED", "full: the renamed section reaches the page copy");
    assert.ok(after.subjects.some((s) => s.id === "sub_new"), "full: the new subject reaches the page copy");
    assert.ok(after.feeHeads.some((f) => f.id === "fh_lab"), "full: the server's new fee head reaches the page copy");
    assert.equal(after.staff.length, 35, "full: the roster is untouched (not in the view)");
    assert.deepEqual(after.staff.map((s) => s.id), before.staff.map((s) => s.id), "full: same staff, same order");
    assert.deepEqual(after.departments, before.departments, "full: departments untouched");
    assert.deepEqual(after.designations, before.designations, "full: designations untouched");
    assert.deepEqual(after.students, before.students, "full: the SIS projection is the tab's, not the server's empty slice");
    assert.deepEqual(events, [], "full: no event raised (nothing can turn the bridge into a push)");
    assert.equal(fetches, 0, "full: nothing sent");

    // ── 2. Teaching answer: the fee lists arrive EMPTY because withheld.
    seedPageCopy();
    const feeBefore = stored();
    assert.deepEqual(feeBefore.feeHeads.map((f) => f.id), ["fh_tuition"], "precondition: the stored copy's one fee head");
    const teaching = {
      version: 2,
      ...teachingMastersSubset({ ...editedBook(), sections: fx.masters.sections.map((s, i) => (i === 7 ? { ...s, name: "TEACH" } : s)) }),
    };
    assert.equal((teaching as unknown as { feeHeads: unknown[] }).feeHeads.length, 0, "precondition: the teaching subset sends fee heads empty");
    events.length = 0;
    acceptMastersAnswer({ scope: "teaching", masters: teaching });
    after = stored();
    assert.equal(after.sections[7]!.name, "TEACH", "teaching: sections reach the page copy");
    assert.ok(after.subjects.some((s) => s.id === "sub_new"), "teaching: subjects reach the page copy");
    assert.deepEqual(after.feeHeads, feeBefore.feeHeads, "teaching: fee heads NOT emptied");
    assert.deepEqual(after.feeGroups, feeBefore.feeGroups, "teaching: fee groups NOT emptied");
    assert.deepEqual(after.feeStructureLines, feeBefore.feeStructureLines, "teaching: fee structure NOT emptied");
    assert.deepEqual(after.concessionGrants, feeBefore.concessionGrants, "teaching: concession grants NOT emptied");
    assert.equal(after.staff.length, 35, "teaching: roster untouched");
    assert.deepEqual(after.students, feeBefore.students, "teaching: projection untouched");
    assert.deepEqual(events, [], "teaching: no event raised");
    assert.equal(fetches, 0, "teaching: nothing sent");
    assert.deepEqual(
      bridge.bridgedKeys({ scope: "teaching", masters: teaching } as unknown as MastersView).sort(),
      ["academicTerms", "academicYears", "campuses", "classSubjects", "classes", "holidays", "schoolProfile", "schoolTiming", "sections", "seniorStreams", "subjects"],
      "teaching: exactly the teaching keys are bridged",
    );

    // ── 3. One write, synchronously.
    let writes = 0;
    let loads = 0;
    const ret = bridge.bridgeMastersToPageMemory({ scope: "full", masters: editedBook() } as unknown as MastersView, {
      load: () => {
        loads += 1;
        return loadMasters();
      },
      write: () => {
        writes += 1;
      },
    });
    assert.equal(ret, undefined, "synchronous: no promise, so nothing can land between load and write");
    assert.equal(loads, 1, "one load");
    assert.equal(writes, 1, "one write");

    // ── 4. A malformed answer never reaches the page copy.
    seedPageCopy();
    const untouched = JSON.stringify(stored());
    for (const bad of [
      null,
      {},
      { scope: "full" },
      { scope: "everything", masters: editedBook() },
      { scope: "full", masters: { ...editedBook(), classes: null } },
      { scope: "teaching", masters: { ...editedBook(), sections: "x" } },
      { scope: "full", masters: { ...editedBook(), subjects: undefined } },
    ]) {
      assert.throws(() => acceptMastersAnswer(bad), /cannot read/, `malformed ${JSON.stringify(bad)?.slice(0, 40)} is a failed read`);
    }
    assert.equal(JSON.stringify(stored()), untouched, "malformed answers changed nothing");
    // No page copy to keep (deps null — what a server render gets): parsed, not bridged.
    assert.equal(acceptMastersAnswer({ scope: "full", masters: editedBook() }, null).scope, "full");
    assert.equal(JSON.stringify(stored()), untouched, "no deps: nothing written");

    // ── 5. What a converted screen reads.
    const view = { scope: "full", masters: editedBook() } as unknown as MastersView;
    assert.equal(bridge.screenMastersOf(view, null), null, "no access copy: still loading, never a roster-less Masters");
    assert.equal(bridge.screenMastersOf(undefined, before), null, "no answer: loading");
    const screen = bridge.screenMastersOf(view, before)!;
    assert.equal(screen.sections[7]!.name, "RENAMED", "screen: the book is the server's");
    assert.equal(screen.staff, before.staff, "screen: the roster is the access copy's");
    assert.equal(screen.designations, before.designations, "screen: designations from the access copy (rbac resolves through them)");
    assert.equal(screen.students, before.students, "screen: the projection from the access copy");

    console.log("mastersBridge.selftest: ok");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
