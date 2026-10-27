/**
 * stale-writer — data-layer step 1.5 (COMMAND.md step 1.1): a context pinned
 * to the previous build's POST shape — a whole-desk body from a copy read
 * BEFORE the kernel wrote — is refused, and does not revert or remove what
 * the kernel wrote.
 *
 *   Masters: context OLD reads masters-desk (subjects + their stamps + the
 *   desk revision). Context NEW renames a subject through the kernel
 *   (POST /api/data/masters.subjects, on the element's `_rev`). OLD then sends the shapes an old tab
 *   sends — a section save of `subjects` (its pre-write copy, renamed back,
 *   and one without the subject) with its old stamp, and a whole-book save
 *   with the old desk revision. Since data-layer 2.2f each is answered 410
 *   `build_stale` (reload) with `X-Bhb-Build-Stale: 1` (it was 409 before),
 *   and the kernel's value and the subject stay.
 *
 *   masters-desk POST, every body (2.2f): a whole book, a section save, a
 *   teacher's `{classSubjects}` (the function-only save — 200 `functionOnly`
 *   and written, before 2.2f), `{}` and an empty body — all 410, and the
 *   masters revision (masters_desk_sync_meta.updated_at, served by erp_versions
 *   and the desk GET) does not move.
 *
 *   Rows: an old build's POST /api/data/sis.students with no base (the shape
 *   every caller sent before 1.5) after the kernel wrote the row: 409
 *   `unversioned`, the row keeps the kernel's value. The request carries an
 *   old X-Bhb-Build and is answered X-Bhb-Build-Stale: 1 (step 1.2).
 *
 * Everything is put back as seeded.
 */
import type { APIRequestContext } from "@playwright/test";
import { fx, expect, openAs, test } from "../support";

const SUBJECT = "e2e_sub_eng";
type Subject = { id: string; nameEn?: string; _rev?: number };

/** The element's own `_rev` — its write base since data-layer 2.2b. */
const revOf = (list: Record<string, unknown>, id: string) => String((list.rows as Subject[]).find((s) => s.id === id)?._rev ?? "");

async function json(r: Awaited<ReturnType<APIRequestContext["get"]>>) {
  return (await r.json()) as Record<string, unknown>;
}

/** The masters-desk POST since data-layer 2.2f: 410, reload, the stale header — nothing written. */
async function expectGone(r: Awaited<ReturnType<APIRequestContext["post"]>>) {
  const text = await r.text();
  expect(r.status(), text.slice(0, 200)).toBe(410);
  expect(r.headers()["x-bhb-build-stale"], "X-Bhb-Build-Stale").toBe("1");
  const body = JSON.parse(text) as { ok?: boolean; reason?: string; reload?: boolean };
  expect(body).toMatchObject({ ok: false, reason: "build_stale", reload: true });
}

/** masters_desk_sync_meta.updated_at, as erp_versions serves it ("masters") and as the desk GET reports it. */
async function mastersRevision(req: APIRequestContext): Promise<{ versions: string; desk: string }> {
  const v = await json(await req.get("/api/data/views/versions"));
  const d = await json(await req.get("/api/school-data/masters-desk"));
  return {
    versions: String(((v.versions as Record<string, { updated_at?: string } | null>).masters ?? {}).updated_at ?? ""),
    desk: String(d.updatedAt ?? ""),
  };
}

test("a whole-desk POST from a pre-write copy is refused and does not revert or remove the kernel's write", async ({ browser }) => {
  const old = await openAs(browser, "principal");
  const now = await openAs(browser, "principal");
  const tag = Date.now().toString(36);
  const kernelName = `English kernel-${tag}`;
  let seeded: Subject | undefined;
  try {
    // The old tab's copy, read before the kernel write.
    const desk = await json(await old.page.request.get("/api/school-data/masters-desk"));
    const oldSubjects = desk.subjects as Subject[];
    const oldStamp = String((desk.sliceStamps as Record<string, string>).subjects);
    const oldRevision = String(desk.updatedAt);
    seeded = oldSubjects.find((s) => s.id === SUBJECT);
    expect(seeded, "the seeded subject").toBeTruthy();

    await test.step("the kernel writes (new build)", async () => {
      const list = await json(await now.page.request.get("/api/data/masters.subjects?limit=1000"));
      const w = await now.page.request.post("/api/data/masters.subjects", {
        data: { ops: [{ op: "upsert", id: SUBJECT, base: revOf(list, SUBJECT), row: { nameEn: kernelName } }] },
      });
      expect(w.status()).toBe(200);
    });

    await test.step("old shape 1: section save of its pre-write subjects (renamed back) → 410 build_stale", async () => {
      const r = await old.page.request.post("/api/school-data/masters-desk", {
        headers: { "x-bhb-build": "previous-build-e2e" },
        data: { version: 2, subjects: oldSubjects, sliceBases: { subjects: oldStamp } },
      });
      await expectGone(r);
    });
    await test.step("old shape 2: the same copy WITHOUT the subject (a removal) → 410 build_stale", async () => {
      const r = await old.page.request.post("/api/school-data/masters-desk", {
        headers: { "x-bhb-build": "previous-build-e2e" },
        data: { version: 2, subjects: oldSubjects.filter((s) => s.id !== SUBJECT), sliceBases: { subjects: oldStamp } },
      });
      await expectGone(r);
    });
    await test.step("old shape 3: a whole-book save against the old desk revision → 410 build_stale", async () => {
      const book: Record<string, unknown> = { ...desk };
      for (const k of ["sliceStamps", "updatedAt", "ok"]) delete book[k];
      const r = await old.page.request.post("/api/school-data/masters-desk", {
        headers: { "x-bhb-build": "previous-build-e2e" },
        data: { ...book, subjects: oldSubjects, baseUpdatedAt: oldRevision },
      });
      await expectGone(r);
    });
    await test.step("the kernel's value and the subject are still there", async () => {
      const list = await json(await now.page.request.get("/api/data/masters.subjects?limit=1000"));
      expect((list.rows as Subject[]).find((s) => s.id === SUBJECT)?.nameEn).toBe(kernelName);
      const deskNow = await json(await now.page.request.get("/api/school-data/masters-desk"));
      expect((deskNow.subjects as Subject[]).find((s) => s.id === SUBJECT)?.nameEn).toBe(kernelName);
    });

    await test.step("rows: an old build's unversioned POST after a kernel write → 409, row keeps the kernel value", async () => {
      const student = fx.sis.students.find((s) => s.status === "active")!;
      const first = await json(await now.page.request.get(`/api/data/sis.students?limit=500`));
      const row = (first.rows as { id: string; updated_at: string; notes?: string }[]).find((r) => r.id === student.id);
      expect(row, "the student is on the first page").toBeTruthy();
      const w = await now.page.request.post("/api/data/sis.students", {
        data: { ops: [{ op: "upsert", id: student.id, base: row!.updated_at, row: { notes: `kernel ${tag}` } }] },
      });
      expect(w.status()).toBe(200);
      const newBase = String(((await w.json()) as { versions: Record<string, string> }).versions[student.id]);
      const stale = await old.page.request.post("/api/data/sis.students", {
        headers: { "x-bhb-build": "previous-build-e2e" },
        data: { ops: [{ op: "upsert", id: student.id, base: null, row: { notes: row!.notes ?? null } }] },
      });
      expect(stale.status()).toBe(409);
      expect(stale.headers()["x-bhb-build-stale"]).toBe("1");
      const body = (await stale.json()) as { conflicts: { reason?: string }[] };
      expect(body.conflicts[0]?.reason).toBe("unversioned");
      const check = await json(await now.page.request.get(`/api/data/sis.students?limit=500`));
      expect((check.rows as { id: string; notes?: string }[]).find((r) => r.id === student.id)?.notes).toBe(`kernel ${tag}`);
      const restore = await now.page.request.post("/api/data/sis.students", {
        data: { ops: [{ op: "upsert", id: student.id, base: newBase, row: { notes: row!.notes ?? null } }] },
      });
      expect(restore.status()).toBe(200);
    });
  } finally {
    if (seeded) {
      const list = await json(await now.page.request.get("/api/data/masters.subjects?limit=1000"));
      await now.page.request.post("/api/data/masters.subjects", {
        data: { ops: [{ op: "upsert", id: SUBJECT, base: revOf(list, SUBJECT), row: { nameEn: seeded.nameEn } }] },
      });
    }
    await old.context.close();
    await now.context.close();
  }
});

test("masters-desk POST (2.2f): every body — whole book, section save, a teacher's classSubjects, {} and empty — is 410 and moves nothing", async ({ browser }) => {
  const principal = await openAs(browser, "principal");
  const teacher = await openAs(browser, "teacher");
  const NURSERY = "e2e_cls_01";
  type Link = { id: string; classId: string; subjectId: string; isOptional?: boolean; _rev?: number };
  let touched: Link | undefined;
  try {
    const before = await mastersRevision(principal.page.request);
    expect(before.versions, "the stack has a masters revision").not.toBe("");
    const desk = await json(await principal.page.request.get("/api/school-data/masters-desk"));
    const book: Record<string, unknown> = { ...desk };
    for (const k of ["sliceStamps", "updatedAt", "ok", "meta", "source", "classCount", "feeHeadCount", "subjectCount", "sliceCount"]) delete book[k];
    const stamps = desk.sliceStamps as Record<string, string>;

    // The teacher's own copy (the teaching subset) with ONE real change in her
    // own class: the function-only save the old route accepted and wrote.
    const tDesk = await json(await teacher.page.request.get("/api/school-data/masters-desk"));
    const tLinks = tDesk.classSubjects as Link[];
    touched = tLinks.find((l) => l.classId === NURSERY && l.subjectId === "e2e_sub_music");
    expect(touched, "Nursery's Music link in the teacher's copy").toBeTruthy();
    const teacherBody = { version: 2, classSubjects: tLinks.map((l) => (l.id === touched!.id ? { ...l, isOptional: !l.isOptional } : l)) };

    const cases: { name: string; ctx: typeof principal; send: () => Promise<Awaited<ReturnType<APIRequestContext["post"]>>> }[] = [
      { name: "whole book at the desk revision", ctx: principal, send: () => principal.page.request.post("/api/school-data/masters-desk", { data: { ...book, version: 2, baseUpdatedAt: String(desk.updatedAt) } }) },
      { name: "section save (sliceBases)", ctx: principal, send: () => principal.page.request.post("/api/school-data/masters-desk", { data: { version: 2, subjects: desk.subjects, sliceBases: { subjects: stamps.subjects } } }) },
      { name: "teacher {classSubjects}", ctx: teacher, send: () => teacher.page.request.post("/api/school-data/masters-desk", { data: teacherBody }) },
      { name: "{}", ctx: principal, send: () => principal.page.request.post("/api/school-data/masters-desk", { data: {} }) },
      { name: "empty body", ctx: principal, send: () => principal.page.request.post("/api/school-data/masters-desk", { headers: { "content-type": "application/json" }, data: "" }) },
    ];
    for (const c of cases) {
      await test.step(`${c.name} → 410`, async () => {
        await expectGone(await c.send());
      });
    }
    await test.step("the masters revision did not move; the teacher's link is as it was", async () => {
      const after = await mastersRevision(principal.page.request);
      expect(after, "masters_desk_sync_meta.updated_at").toEqual(before);
      const links = (await json(await principal.page.request.get("/api/data/masters.class-subjects?limit=1000"))).rows as Link[];
      expect(links.find((l) => l.id === touched!.id)?.isOptional ?? false).toBe(touched!.isOptional ?? false);
    });
  } finally {
    // Old code wrote the teacher's change: put it back through the kernel.
    if (touched) {
      const links = (await json(await principal.page.request.get("/api/data/masters.class-subjects?limit=1000"))).rows as Link[];
      const now = links.find((l) => l.id === touched!.id);
      if (now && (now.isOptional ?? false) !== (touched.isOptional ?? false)) {
        await principal.page.request.post("/api/data/masters.class-subjects", {
          data: { ops: [{ op: "upsert", id: now.id, base: String(now._rev ?? 0), row: { isOptional: touched.isOptional ?? false } }] },
        });
      }
    }
    await principal.context.close();
    await teacher.context.close();
  }
});
