/**
 * Run: npm run test:masters-element-commit
 *
 * Data-layer 2.2c — the Masters editor's commit as element writes:
 *  1. planMastersElementCommit: only what the action changed is sent, on the
 *     served `_rev` (or the revision a save of this tab answered); a stale
 *     answer's other elements are never sent; removals one per request,
 *     parents first; an emptied list / too many removals / bad ids refused;
 *     objects on the stamp; staff link changes apart; fee keys as elements
 *     (2.2e); other keys → `rest`.
 *  2. applyStaffLinkChange: laid on the record as stored.
 *  3. mastersElementPending: the per-element overlay and its `_rev` proof.
 *  4. (gone in 2.2f with the old whole-book path it guarded)
 */
import assert from "node:assert/strict";
import { applyStaffLinkChange, MASTERS_BATCH_PATH, MAX_REMOVALS, planMastersElementCommit } from "./mastersElementPlan";
import { QueryClient } from "@tanstack/react-query";
import { refetchMastersAnswer } from "./hooks";
import { objectDraftStep } from "@/components/masters/useObjectDraft";
import { bumpSeriesOnServer, fetchSeriesNext } from "@/lib/numberSeries";
import { seriesPrefix, tailNumber } from "../server/numberSeriesIssued";
import {
  HOLD_MS,
  SEND_TIMEOUT_MS,
  answerHolds,
  pendingAfterAnswer,
  pendingAfterSave,
  pendingRevision,
  withPending,
  type PendingElement,
} from "@/components/masters/mastersElementPending";
import { asRevision } from "../types";

type Row = Record<string, unknown>;
const ok = <T extends { ok: boolean }>(p: T): Extract<T, { ok: true }> => {
  assert.equal(p.ok, true, JSON.stringify(p));
  return p as Extract<T, { ok: true }>;
};

function main(): void {
  console.log("mastersElementPlan.selftest.ts");

  const served = {
    subjects: [
      { id: "eng", code: "ENG", nameEn: "English", _rev: 3 },
      { id: "hin", code: "HIN", nameEn: "Hindi", _rev: 5 },
      { id: "sci", code: "SCI", nameEn: "Science", _rev: 7 },
    ],
    classes: [{ id: "c1", name: "I", _rev: 2 }],
    sections: [{ id: "s1", classId: "c1", name: "A", _rev: 4 }],
    classSubjects: [
      { id: "l1", classId: "c1", subjectId: "eng", _rev: 1 },
      { id: "l2", classId: "c1", subjectId: "hin", _rev: 1 },
      { id: "l3", classId: "c1", subjectId: "sci", _rev: 1 },
      { id: "l4", classId: "c1", subjectId: "art", _rev: 1 },
    ],
    feeHeads: [{ id: "f1", name: "Tuition", _rev: 1 }],
    schoolProfile: { name: "BHB" },
    staff: [{ id: "t1", fullName: "Asha", classTeacherLinks: [{ id: "ctl1", classId: "c1", sectionId: "s1" }], subjectTeachingLinks: [] }],
  };

  /* ── 1a. One element changed: one upsert on its served _rev ── */
  {
    // The screen's book is STALE for Hindi (someone renamed it to "Hindi B"
    // since; the served answer has it). The action renames English only.
    const shown = { ...served, subjects: served.subjects.map((s) => (s.id === "hin" ? { ...s, nameEn: "Hindi (old)" } : s)) };
    const next = { ...shown, subjects: shown.subjects.map((s) => (s.id === "eng" ? { ...s, nameEn: "English Language" } : s)) };
    const p = ok(planMastersElementCommit({ shown, next, served }));
    assert.equal(p.requests.length, 1);
    assert.equal(p.requests[0].collection, "masters.subjects");
    assert.deepEqual(p.requests[0].ops, [
      { op: "upsert", id: "eng", base: asRevision("3"), row: { id: "eng", code: "ENG", nameEn: "English Language" } },
    ]);
    assert.deepEqual(p.rest, []);
    // Editing the STALE element itself: the base is the _rev the screen showed
    // (4), not the newer served one (5) — refused as stale, never written over.
    const shownStale = { ...served, subjects: served.subjects.map((s) => (s.id === "hin" ? { ...s, nameEn: "Hindi (old)", _rev: 4 } : s)) };
    const editStale = { ...shownStale, subjects: shownStale.subjects.map((s) => (s.id === "hin" ? { ...s, nameEn: "Hindi (mine)" } : s)) };
    const ps = ok(planMastersElementCommit({ shown: shownStale, next: editStale, served }));
    assert.equal(ps.requests[0].ops[0].base, asRevision("4"));
    console.log("  ✓ one element changed → one upsert on its _rev as shown; a stale neighbour is not sent");
  }

  /* ── 1b. Add a class with two sections: parents first, base null ── */
  {
    const next = {
      ...served,
      classes: [...served.classes, { id: "c2", name: "II" }],
      sections: [...served.sections, { id: "s2", classId: "c2", name: "A" }, { id: "s3", classId: "c2", name: "B" }],
    };
    const p = ok(planMastersElementCommit({ shown: served, next, served }));
    assert.deepEqual(p.requests.map((r) => r.collection), [MASTERS_BATCH_PATH], "one all-or-none batch");
    assert.deepEqual(p.requests[0].parts?.map((x) => x.collection), ["masters.classes", "masters.sections", "masters.sections"]);
    assert.deepEqual(p.requests[0].ops.map((o) => [o.op, o.id, o.base]), [["upsert", "c2", null], ["upsert", "s2", null], ["upsert", "s3", null]]);
    console.log("  ✓ new class + sections: one batch, classes before sections, new elements on base null");
  }

  /* ── 1c. Removals of a cascade: one batch, the class before its links ── */
  {
    const next = {
      ...served,
      classes: [],
      classSubjects: served.classSubjects.filter((l) => l.id === "l4"),
      sections: [],
    };
    // Emptying classes (and sections) is refused outright.
    const refused = planMastersElementCommit({ shown: served, next, served });
    assert.equal(refused.ok, false);
    assert.match((refused as { reason: string }).reason, /empty/);

    const shown = { ...served, classes: [...served.classes, { id: "c9", name: "IX", _rev: 1 }] };
    const served2 = { ...served, classes: shown.classes };
    const next2 = { ...shown, classes: served.classes, classSubjects: served.classSubjects.filter((l) => l.id === "l4") };
    const p = ok(planMastersElementCommit({ shown, next: next2, served: served2 }));
    assert.equal(p.requests.length, 1);
    assert.deepEqual(
      p.requests[0].ops.map((o, i) => `${p.requests[0].parts?.[i]?.collection}:${o.op}:${o.id}:${o.base}`),
      ["masters.classes:delete:c9:1", "masters.class-subjects:delete:l1:1", "masters.class-subjects:delete:l2:1", "masters.class-subjects:delete:l3:1"],
    );
    console.log("  ✓ a cascade's removals: one all-or-none batch, parents first; emptying a list refused");
  }

  /* ── 1d. Too many removals at once ── */
  {
    const many = Array.from({ length: MAX_REMOVALS + 2 }, (_, i) => ({ id: `h${i}`, date: `2026-11-${i + 1}`, _rev: 1 }));
    const book = { holidays: [...many, { id: "keep", _rev: 1 }] };
    const p = planMastersElementCommit({ shown: book, next: { holidays: [{ id: "keep", _rev: 1 }] }, served: book });
    assert.equal(p.ok, false);
    assert.match((p as { reason: string }).reason, /at once/);
    console.log(`  ✓ more than ${MAX_REMOVALS} removals in one action refused`);
  }

  /* ── 1e. A dropped key is said (null); unchanged-as-served is not sent ── */
  {
    const shown = { subjects: [{ id: "eng", code: "ENG", nameEn: "English", note: "x", _rev: 3 }] };
    const next = { subjects: [{ id: "eng", code: "ENG", nameEn: "English" }] };
    const p = ok(planMastersElementCommit({ shown, next, served: shown }));
    assert.deepEqual(p.requests[0].ops[0], { op: "upsert", id: "eng", base: asRevision("3"), row: { id: "eng", code: "ENG", nameEn: "English", note: null } });
    // The server already holds exactly what the action wants: nothing to send.
    const q = ok(planMastersElementCommit({ shown, next, served: next }));
    assert.equal(q.requests.length, 0);
    console.log("  ✓ a key the editor dropped is sent as null; already-as-wanted is not sent");
  }

  /* ── 1f. The revision a save of this tab answered wins over the stale served one ── */
  {
    const next = { ...served, subjects: served.subjects.map((s) => (s.id === "hin" ? { ...s, nameEn: "Hindi 2" } : s)) };
    const p = ok(
      planMastersElementCommit({
        shown: served,
        next,
        served,
        revisionOf: (k, id) => (k === "subjects" && id === "hin" ? asRevision("6") : undefined),
      }),
    );
    assert.equal(p.requests[0].ops[0].base, asRevision("6"));
    // A new element this tab created and the view has not served yet: its own revision, not null.
    const shown2 = { ...served, subjects: [...served.subjects, { id: "art", code: "ART", nameEn: "Art" }] };
    const next2 = { ...shown2, subjects: shown2.subjects.map((s) => (s.id === "art" ? { ...s, nameEn: "Art & craft" } : s)) };
    const p2 = ok(planMastersElementCommit({ shown: shown2, next: next2, served, revisionOf: (k, id) => (id === "art" ? asRevision("1") : undefined) }));
    assert.equal(p2.requests[0].ops[0].base, asRevision("1"));
    console.log("  ✓ base = the revision this tab's own save answered, when the view lags");
  }

  /* ── 1g. Objects on the stamp; staff links apart; fee keys are elements (2.2e) ── */
  {
    const next = {
      ...served,
      schoolProfile: { name: "BHB International" },
      feeHeads: [{ id: "f1", name: "Tuition fee", _rev: 1 }],
      staff: [{ ...served.staff[0], classTeacherLinks: [] }],
    };
    const p = ok(planMastersElementCommit({ shown: served, next, served, stamps: { schoolProfile: "2026-10-21T10:00:00Z" } }));
    // Since 2.2e a fee head is an element write too (lists first, then objects).
    assert.deepEqual(p.requests.map((r) => [r.collection, r.kind, String(r.ops[0].base)]), [
      ["masters.fee-heads", "slice", "1"],
      ["masters.school-profile", "object", "2026-10-21T10:00:00Z"],
    ]);
    assert.deepEqual(p.rest, []);
    assert.deepEqual(p.staff, [{ staffId: "t1", field: "classTeacherLinks", put: [], remove: ["ctl1"] }]);
    const noStamp = planMastersElementCommit({ shown: served, next: { ...served, schoolProfile: { name: "X" } }, served });
    assert.equal(noStamp.ok, false, "an object without a served stamp is refused");
    // Any other change to a staff record is not the Masters editor's: the old save.
    const other = ok(planMastersElementCommit({ shown: served, next: { ...served, staff: [{ ...served.staff[0], fullName: "Asha R" }] }, served }));
    assert.deepEqual(other.rest, ["staff"]);
    assert.deepEqual(other.staff, []);
    console.log("  ✓ object on its stamp; teacher links as link changes; fee keys as elements; other staff edits → rest");
  }

  /* ── 1h. Bad ids ── */
  {
    const p = planMastersElementCommit({ shown: served, next: { ...served, sections: [...served.sections, { classId: "c1", name: "B" }] }, served });
    assert.equal(p.ok, false);
    const q = planMastersElementCommit({ shown: served, next: { ...served, sections: [...served.sections, served.sections[0]] }, served });
    assert.equal(q.ok, false);
    console.log("  ✓ an element without an id, or an id twice, refused");
  }

  /* ── 2. Links laid on the record as stored ── */
  {
    const stored = [{ id: "ctl1", classId: "c1" }, { id: "ctl-other", classId: "c5" }];
    assert.deepEqual(applyStaffLinkChange(stored, { put: [{ id: "ctl2", classId: "c2" }], remove: ["ctl1"] }), [
      { id: "ctl-other", classId: "c5" },
      { id: "ctl2", classId: "c2" },
    ]);
    console.log("  ✓ a link someone else added meanwhile is kept");
  }

  /* ── 3. The per-element overlay ── */
  {
    const read = { subjects: [{ id: "eng", nameEn: "English", _rev: 3 }, { id: "hin", nameEn: "Hindi", _rev: 5 }] };
    const pend: PendingElement[] = [
      { sliceKey: "subjects", id: "eng", kind: "slice", value: { id: "eng", nameEn: "English L" }, revision: "", saveId: 1, savedAt: 0 },
      { sliceKey: "subjects", id: "hin", kind: "slice", value: null, revision: "", saveId: 1, savedAt: 0 },
      { sliceKey: "subjects", id: "art", kind: "slice", value: { id: "art", nameEn: "Art" }, revision: "", saveId: 1, savedAt: 0 },
    ];
    const shown = withPending(read, pend) as { subjects: Row[] };
    assert.deepEqual(shown.subjects.map((s) => s.nameEn), ["English L", "Art"]);
    // No proof while saving.
    assert.equal(pendingAfterAnswer(pend, read, null, 1).length, 3);
    const saved = pendingAfterSave(pend, 1, { ok: true, versions: { eng: "4", art: "1" } }, 1000);
    assert.equal(pendingRevision(saved, "subjects", "eng"), "4");
    // A stale answer (eng still 3, hin still there, no art) proves nothing.
    assert.equal(pendingAfterAnswer(saved, read, null, 2000).length, 3);
    // The answer that holds it: eng at 4, hin gone, art at 1 — all proven; the screen is the server's.
    const fresh = { subjects: [{ id: "eng", nameEn: "English L", _rev: 4 }, { id: "art", nameEn: "Art", _rev: 1 }] };
    assert.equal(pendingAfterAnswer(saved, fresh, null, 3000).length, 0);
    // Someone changed eng again since (rev 5): proven too (≥).
    assert.equal(answerHolds(saved[0], { subjects: [{ id: "eng", _rev: 5 }] }, null), true);
    // A failed save drops its entries at once.
    assert.equal(pendingAfterSave(pend, 1, { ok: false }, 1000).length, 0);
    // Unproven past HOLD_MS: dropped.
    assert.equal(pendingAfterAnswer(saved, read, null, 1000 + HOLD_MS + 1).length, 0);
    // Objects: proven by the view's stamp.
    const obj: PendingElement = { sliceKey: "schoolProfile", id: "schoolProfile", kind: "object", value: { name: "X" }, revision: "2026-10-21T10:00:00.5+00:00", saveId: 2, savedAt: 1 };
    assert.equal(answerHolds(obj, {}, { schoolProfile: "2026-10-21T10:00:00Z" }), false);
    assert.equal(answerHolds(obj, {}, { schoolProfile: "2026-10-21T10:00:00.500Z" }), true);
    console.log("  ✓ overlay per element: held until an answer serves its _rev (or it is gone); failed saves drop");
  }

  /* ── 5. (review) Objects: the form's LOADED stamp is the base ── */
  {
    // A loaded the profile at stamp S1 and typed; B saved (S2). A's save must be on S1 → a conflict, not a revert.
    const shown = { schoolProfile: { name: "BHB", website: "b.example" } };
    const next = { schoolProfile: { name: "BHB (typed)", website: "a-old.example" } };
    const p = ok(planMastersElementCommit({ shown, next, served: shown, stamps: { schoolProfile: "S2" }, objectBases: { schoolProfile: "S1" } }));
    assert.equal(String(p.requests[0].ops[0].base), "S1", "the stamp the form was loaded at");
    // The form's draft: typing survives a newer value and keeps its base; a clean form follows; own save moves the base.
    let st = { draft: { v: 1 }, loaded: { v: 1 }, base: "S1" as string | undefined };
    st = { ...st, draft: { v: 5 } }; // typing
    st = objectDraftStep(st, { v: 2 }, "S2"); // B's save arrives
    assert.deepEqual([st.draft, st.base], [{ v: 5 }, "S1"], "typing kept, base kept");
    let clean = { draft: { v: 1 }, loaded: { v: 1 }, base: "S1" as string | undefined };
    clean = objectDraftStep(clean, { v: 2 }, "S2");
    assert.deepEqual([clean.draft, clean.base], [{ v: 2 }, "S2"], "a clean form follows");
    let own = { draft: { v: 7 }, loaded: { v: 1 }, base: "S1" as string | undefined };
    own = objectDraftStep(own, { v: 7 }, "S3"); // its own save comes back
    assert.deepEqual([own.draft, own.base], [{ v: 7 }, "S3"], "own save moves the base on");
    console.log("  ✓ objects: saved on the stamp the form was loaded at; typing keeps its base");
  }

  /* ── 6. (review) A cascade is ONE all-or-none batch; 14 links fit ── */
  {
    const links = Array.from({ length: 14 }, (_, i) => ({ id: `cl${i}`, classId: "cz", subjectId: `s${i}`, _rev: 1 }));
    const book = { classes: [{ id: "c1", name: "I", _rev: 1 }, { id: "cz", name: "ZZ", _rev: 2 }], classSubjects: [...links, { id: "keep", classId: "c1", subjectId: "s0", _rev: 1 }] };
    const next = { classes: [book.classes[0]], classSubjects: [book.classSubjects[14]] };
    const p = ok(planMastersElementCommit({ shown: book, next, served: book }));
    assert.equal(p.requests.length, 1, "one request");
    const r = p.requests[0];
    assert.equal(r.kind, "batch");
    assert.equal(r.collection, MASTERS_BATCH_PATH);
    assert.equal(r.ops.length, 15);
    assert.deepEqual(r.parts?.map((x) => x.collection).filter((c, i, a) => a.indexOf(c) === i), ["masters.classes", "masters.class-subjects"]);
    // A class with two new sections: one batch too (both or neither).
    const add = ok(planMastersElementCommit({ shown: served, next: { ...served, classes: [...served.classes, { id: "c2", name: "II" }], sections: [...served.sections, { id: "s2", classId: "c2", name: "A" }] }, served }));
    assert.deepEqual(add.requests.map((x) => x.kind), ["batch"]);
    // One list, one removal: still its own route.
    const one = ok(planMastersElementCommit({ shown: book, next: { ...book, classSubjects: book.classSubjects.slice(1) }, served: book }));
    assert.deepEqual(one.requests.map((x) => [x.kind, x.collection]), [["slice", "masters.class-subjects"]]);
    console.log("  ✓ a cascade (class + 14 links) is one all-or-none batch; single removals keep their route");
  }

  /* ── 7. (review) Overlay: a save that never answers is given up ── */
  {
    const p: PendingElement = { sliceKey: "subjects", id: "eng", kind: "slice", value: { id: "eng" }, revision: "", saveId: 9, savedAt: 0, sentAt: 1000 };
    assert.equal(pendingAfterAnswer([p], {}, null, 1000 + SEND_TIMEOUT_MS - 1).length, 1);
    assert.equal(pendingAfterAnswer([p], {}, null, 1000 + SEND_TIMEOUT_MS + 1).length, 0);
    console.log("  ✓ an entry whose request never answers goes after SEND_TIMEOUT_MS");
  }
}

async function asyncChecks(): Promise<void> {
  /* ── 10. (director) Numbers on record: prefix + digits only ── */
  {
    assert.equal(seriesPrefix({ prefix: "BHB-", includeSessionInPrefix: false }, "2026-27"), "BHB-");
    assert.equal(seriesPrefix({ prefix: "TC/", includeSessionInPrefix: true }, "2026-27"), "TC/2026-27/");
    assert.equal(tailNumber("SRN-00060", "SRN-"), 60);
    assert.equal(tailNumber("SRN-00060A", "SRN-"), null);
    assert.equal(tailNumber("RCV-12", "SRN-"), null);
    const fake = (async () => new Response(JSON.stringify({ ok: true, next: 1071, formatted: "BHB-1071", lifted: true }), { status: 200 })) as unknown as typeof fetch;
    assert.deepEqual(await fetchSeriesNext("ADMISSION", "2026-27", { post: fake }), { next: 1071, formatted: "BHB-1071", lifted: true });
    const down = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    assert.equal(await fetchSeriesNext("ADMISSION", "2026-27", { post: down }), null, "unknown → the caller keeps its own suggestion");
    console.log("  ✓ numbers on record: prefix + digits; the next-number answer, and null when unknown");
  }

  /* ── 8. (review) Number series bump: retried once, a failure is said ── */
  {
    let calls = 0;
    const said: string[] = [];
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("network down");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    assert.equal(await bumpSeriesOnServer("RECEIPT", "Fee receipt", 12, undefined, { post: flaky, say: (m) => said.push(m) }), true);
    assert.equal(calls, 2, "retried once");
    calls = 0;
    const refused = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: false, message: "too far ahead" }), { status: 409 });
    }) as unknown as typeof fetch;
    assert.equal(await bumpSeriesOnServer("RECEIPT", "Fee receipt", 9999, undefined, { post: refused, say: (m) => said.push(m) }), false);
    assert.equal(calls, 1, "a refusal is not retried");
    assert.match(said[0] ?? "", /Fee receipt: the next number was not moved past 9999 \(too far ahead\)/);
    console.log("  ✓ series bump: one retry on a blink; a refusal or a standing failure is said on screen");
  }

  /* ── 9. (2.2f) After a lib/ write the masters view is asked again, mounted or not ── */
  {
    // The masters-desk bridge (a ~235 KB re-read of the old route) went with
    // the whole-book save; the lib/ writers now wait for the masters VIEW's
    // next answer, which the 2.1 bridge lays on the page copy. It must ask
    // even when no screen observes the view, share an in-flight read, and
    // never throw.
    const realFetch = globalThis.fetch;
    let reads = 0;
    let fail = false;
    const book = { classes: [{ id: "c1" }], sections: [], subjects: [{ id: "s1" }] };
    globalThis.fetch = (async (input: string | URL) => {
      if (!String(input).includes("/api/data/views/masters")) throw new Error(`unexpected ${String(input)}`);
      reads += 1;
      await new Promise((r) => setTimeout(r, 5));
      if (fail) return new Response(JSON.stringify({ ok: false, error: "down" }), { status: 503 });
      return new Response(JSON.stringify({ ok: true, data: { scope: "full", masters: book }, versions: { masters: { updated_at: "2026-10-27T10:00:00Z", count: 1 } } }), { status: 200 });
    }) as typeof fetch;
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      assert.equal(await refetchMastersAnswer(null), false, "no tab client: nothing to ask");
      assert.equal(await refetchMastersAnswer(client), true);
      assert.equal(reads, 1, "asked with no screen mounted");
      const cached = client.getQueryData<{ data: { masters: typeof book } }>(["masters", "/api/data/views/masters"]);
      assert.deepEqual(cached?.data.masters, book, "the answer is the masters view's cache entry");
      const [x, y] = await Promise.all([refetchMastersAnswer(client), refetchMastersAnswer(client)]);
      assert.ok(x && y);
      assert.equal(reads, 2, "two writes at once share one read");
      fail = true;
      assert.equal(await refetchMastersAnswer(client), false, "a failed read is false, not a throw");
    } finally {
      globalThis.fetch = realFetch;
    }
    console.log("  ✓ after a write: the masters view is asked again (no screen needed), one read shared, never throws");
  }
}

main();
asyncChecks()
  .then(() => console.log("mastersElementPlan.selftest.ts: all passed"))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
