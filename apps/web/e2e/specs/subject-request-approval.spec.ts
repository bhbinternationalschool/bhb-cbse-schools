/**
 * subject-request-approval — data-layer 2.2f: approving a teacher's subject
 * request (Masters → Subjects → Requests; filed from the staff app's "My
 * subjects", POST /api/v1/staff/subject-requests — that endpoint is
 * unchanged) writes Masters as ONE element batch, never the whole book.
 *
 *   The teacher (Nursery-A's class teacher) files "add <a subject Nursery
 *   does not study>" through the same endpoint the Flutter app calls. The
 *   principal approves it through POST /api/masters/subject-requests. Then:
 *     - the new class link is stored, as a kernel element (`_rev` 1);
 *     - ONLY the classSubjects slice moved: every other Masters slice
 *       (subjects, classes, fee heads, holidays …) keeps the stamp it had —
 *       a whole-book write (pushMastersDeskToDb, before 2.2f) re-wrote every
 *       slice of the book;
 *     - the request reads "approved".
 *   The link is taken out again through the kernel afterwards.
 */
import type { APIRequestContext } from "@playwright/test";
import { expect, openAs, test } from "../support";

const NURSERY = "e2e_cls_01";
type Link = { id: string; classId: string; subjectId: string; isActive?: boolean; _rev?: number };
type Desk = { classSubjects: Link[]; sliceStamps: Record<string, string> };

async function desk(req: APIRequestContext): Promise<Desk> {
  const res = await req.get("/api/school-data/masters-desk");
  expect(res.status(), "GET masters-desk").toBe(200);
  return (await res.json()) as Desk;
}

test("approving a subject request writes one element batch — only the class links move, never the whole book", async ({ browser }) => {
  const teacher = await openAs(browser, "teacher");
  const principal = await openAs(browser, "principal");
  let added: Link | undefined;
  try {
    // The teacher's view, from the endpoint the staff app reads.
    const mine = await teacher.page.request.get("/api/v1/staff/subject-requests");
    expect(mine.status(), `GET v1 subject-requests: ${(await mine.text()).slice(0, 200)}`).toBe(200);
    const view = ((await mine.json()) as { data: { classes: { classId: string; subjects: { id: string }[] }[]; schoolSubjects: { id: string; parentName: string }[] } }).data;
    const nursery = view.classes.find((c) => c.classId === NURSERY);
    expect(nursery, "the teacher teaches Nursery").toBeTruthy();
    const studied = new Set(nursery!.subjects.map((s) => s.id));
    const pick = view.schoolSubjects.find((s) => !studied.has(s.id) && !s.parentName);
    expect(pick, "a top-level subject Nursery does not study").toBeTruthy();

    const filed = await teacher.page.request.post("/api/v1/staff/subject-requests", {
      data: { action: "file", classId: NURSERY, change: "add", subjectId: pick!.id, reason: "e2e 2.2f" },
    });
    expect(filed.status(), `file: ${(await filed.text()).slice(0, 200)}`).toBe(200);
    const requestId = ((await filed.json()) as { data: { request: { id: string } } }).data.request.id;

    const before = await desk(principal.page.request);
    const approve = await principal.page.request.post("/api/masters/subject-requests", { data: { id: requestId, decision: "approve" } });
    expect(approve.status(), `approve: ${(await approve.text()).slice(0, 300)}`).toBe(200);
    const after = await desk(principal.page.request);

    added = after.classSubjects.find((l) => l.classId === NURSERY && l.subjectId === pick!.id && l.isActive !== false);
    expect(added, "the link is stored").toBeTruthy();
    expect(added!._rev, "written as a kernel element (`_rev` 1)").toBe(1);

    const moved = Object.keys(before.sliceStamps).filter((k) => before.sliceStamps[k] !== after.sliceStamps[k]);
    expect(moved, "only the class links were written — never the whole book").toEqual(["classSubjects"]);

    const list = await principal.page.request.get("/api/masters/subject-requests");
    const recent = ((await list.json()) as { recent: { id: string; status: string }[] }).recent;
    expect(recent.find((r) => r.id === requestId)?.status).toBe("approved");
  } finally {
    if (added) {
      const rows = ((await (await principal.page.request.get("/api/data/masters.class-subjects?limit=1000")).json()) as { rows: Link[] }).rows;
      const now = rows.find((l) => l.id === added!.id);
      if (now) {
        await principal.page.request.post("/api/data/masters.class-subjects", {
          data: { ops: [{ op: "delete", id: now.id, base: String(now._rev ?? 0) }] },
        });
      }
    }
    await teacher.context.close();
    await principal.context.close();
  }
});
