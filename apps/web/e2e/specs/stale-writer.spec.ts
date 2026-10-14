/**
 * stale-writer — data-layer step 1.5 (COMMAND.md step 1.1): a context pinned
 * to the previous build's POST shape — a whole-desk body from a copy read
 * BEFORE the kernel wrote — is refused, and does not revert or remove what
 * the kernel wrote.
 *
 *   Masters: context OLD reads masters-desk (subjects + their stamps + the
 *   desk revision). Context NEW renames a subject through the kernel
 *   (POST /api/data/masters.subjects). OLD then sends the shapes an old tab
 *   sends — a section save of `subjects` (its pre-write copy, renamed back,
 *   and one without the subject) with its old stamp, and a whole-book save
 *   with the old desk revision. Each is refused (409) and the kernel's value
 *   and the subject stay.
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
type Subject = { id: string; nameEn?: string };

async function json(r: Awaited<ReturnType<APIRequestContext["get"]>>) {
  return (await r.json()) as Record<string, unknown>;
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
        data: { ops: [{ op: "upsert", id: SUBJECT, base: list.revision, row: { nameEn: kernelName } }] },
      });
      expect(w.status()).toBe(200);
    });

    await test.step("old shape 1: section save of its pre-write subjects (renamed back) → 409", async () => {
      const r = await old.page.request.post("/api/school-data/masters-desk", {
        data: { version: 2, subjects: oldSubjects, sliceBases: { subjects: oldStamp } },
      });
      expect(r.status()).toBe(409);
    });
    await test.step("old shape 2: the same copy WITHOUT the subject (a removal) → 409", async () => {
      const r = await old.page.request.post("/api/school-data/masters-desk", {
        data: { version: 2, subjects: oldSubjects.filter((s) => s.id !== SUBJECT), sliceBases: { subjects: oldStamp } },
      });
      expect(r.status()).toBe(409);
    });
    await test.step("old shape 3: a whole-book save against the old desk revision → 409", async () => {
      const book: Record<string, unknown> = { ...desk };
      for (const k of ["sliceStamps", "updatedAt", "ok"]) delete book[k];
      const r = await old.page.request.post("/api/school-data/masters-desk", {
        data: { ...book, subjects: oldSubjects, baseUpdatedAt: oldRevision },
      });
      expect(r.status()).toBe(409);
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
        data: { ops: [{ op: "upsert", id: SUBJECT, base: list.revision, row: { nameEn: seeded.nameEn } }] },
      });
    }
    await old.context.close();
    await now.context.close();
  }
});
