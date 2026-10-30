/**
 * staff-tasks — the staff task module on the real stack: a Principal assigns
 * through the actual panel, the assignee works it through the actual panel,
 * and every privacy and conflict rule is asserted against the real Next
 * routes, the real PostgREST tables and the in-memory storage bucket with
 * production privacy (scripts/e2e/storage.mjs).
 *
 * Lifecycle covered, in order:
 *   1. assign through the UI → the task is the assignee's alone: the other
 *      teacher's list and direct read refuse it, and Office (Staff · edit,
 *      no approve — the director's 30 Oct rule) can neither assign nor see
 *      the board;
 *   2. evidence upload through the panel's file input → the object really
 *      lands in the in-memory school-files bucket under staff-tasks/<id>/;
 *   3. task-scoped download: assignee 200 with the exact bytes, other staff
 *      403, board holder 200, the generic /api/file route 404, an unsigned
 *      storage URL guess refused by the bucket itself;
 *   4. evidence-required refusal, submit → review accept, and a stale-base
 *      second review refused 409 with the first reviewer's result standing.
 *
 * Notifications are deliberately out of scope here (notify writes are the
 * notify-writes project's concern). Writes only to staff_tasks /
 * staff_task_updates and the throwaway bucket; runs in the
 * staff-tasks-writes project after the read-only gate.
 */
import { expect, openAs, test } from "../support";
import { CLASS_TEACHER, staffId } from "../fixture";

const ASSIGNEE = staffId(CLASS_TEACHER);

test("staff tasks: assign, own-only visibility, evidence upload/download privacy, review and stale-base refusal", async ({
  browser,
  page: officePage,
}) => {
  const tag = Date.now().toString(36);
  const TITLE = `E2E supervision ${tag}`;
  const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, ...Buffer.from(`e2e-${tag}`)]);
  let taskId = "";
  let evidencePath = "";
  let base = "";

  const principal = await openAs(browser, "principal");
  const teacher = await openAs(browser, "teacher");
  const other = await openAs(browser, "timetableTeacher");
  // The gate's config sets no action/navigation timeout: without these, a
  // wrong locator or an unanswered option waits the full 120 s test timeout
  // and reports nothing. Bound every action so a hang names its step, and
  // dump each page's state on failure — CI artifacts are not always readable.
  for (const ctx of [principal.context, teacher.context, other.context, officePage.context()]) {
    ctx.setDefaultTimeout(20_000);
    ctx.setDefaultNavigationTimeout(30_000);
  }
  const dumpPages = async (why: unknown) => {
    const pages: [string, import("@playwright/test").Page][] = [
      ["principal", principal.page],
      ["teacher", teacher.page],
      ["other", other.page],
      ["office", officePage],
    ];
    for (const [name, pg] of pages) {
      try {
        const snap = await Promise.race([
          pg.evaluate(() => location.pathname + " :: " + document.body.innerText.slice(0, 600)),
          new Promise<string>((_, rej) => setTimeout(() => rej(new Error("snap timeout")), 5_000)),
        ]);
        console.log(`[staff-tasks dump] ${name}: ${snap}`);
      } catch (e) {
        console.log(`[staff-tasks dump] ${name}: unreadable (${String(e).slice(0, 120)})`);
      }
    }
    throw why;
  };
  try {
    await test.step("the Principal assigns through the real panel", async () => {
      await principal.page.goto("/staff");
      // ModuleTabs renders role="tab", and there is no action timeout in the
      // gate's config — expect before every action so a wrong locator fails
      // fast and named, instead of hanging to the test timeout.
      const tasksTab = principal.page.getByRole("tab", { name: "Tasks", exact: true });
      await expect(tasksTab).toBeVisible({ timeout: 15_000 });
      await tasksTab.click();
      // The assign form sits behind the manager's "Assign" sub-tab.
      const assignSub = principal.page.getByRole("button", { name: "Assign", exact: true });
      await expect(assignSub).toBeVisible({ timeout: 15_000 });
      await assignSub.click();
      await expect(principal.page.getByText("Assign a new task")).toBeVisible({ timeout: 15_000 });
      // Scope to the assign panel: the page header has its own dropdown.
      const newTaskPanel = principal.page
        .getByRole("heading", { name: "Assign a new task", exact: true })
        .locator("..");
      await newTaskPanel.locator("select").selectOption(ASSIGNEE);
      await principal.page.getByLabel("Task", { exact: true }).fill(TITLE);
      // "Completion evidence required" stays ticked — that is the rule under test.
      await principal.page.getByRole("button", { name: "Assign task", exact: true }).click();
      // A successful assign returns to the board, which lists the new task.
      await expect(principal.page.getByText(TITLE)).toBeVisible({ timeout: 15_000 });
      const view = (await (await principal.page.request.get("/api/staff/tasks")).json()) as {
        tasks: { id: string; title: string; updatedAt: string }[];
      };
      const mine = view.tasks.find((t) => t.title === TITLE);
      expect(mine, "the assigned task is in the board's own answer").toBeTruthy();
      taskId = mine!.id;
    });

    await test.step("the task is the assignee's alone", async () => {
      // The assignee sees it in My tasks.
      await teacher.page.goto("/staff");
      const teacherTab = teacher.page.getByRole("tab", { name: "Tasks", exact: true });
      await expect(teacherTab).toBeVisible({ timeout: 15_000 });
      await teacherTab.click();
      await expect(teacher.page.getByText(TITLE)).toBeVisible({ timeout: 15_000 });

      // Another member of staff: list hides it, direct read refuses it.
      const list = await other.page.request.get("/api/staff/tasks");
      expect(list.status()).toBe(200);
      const listBody = (await list.json()) as { tasks: { id: string }[] };
      expect(listBody.tasks.some((t) => t.id === taskId)).toBe(false);
      const direct = await other.page.request.get(`/api/staff/tasks/${taskId}`);
      expect(direct.status()).toBe(403);
      await other.page.goto("/staff");
      const otherTab = other.page.getByRole("tab", { name: "Tasks", exact: true });
      await expect(otherTab).toBeVisible({ timeout: 15_000 });
      await otherTab.click();
      await expect(other.page.getByText("My tasks")).toBeVisible({ timeout: 15_000 });
      await expect(other.page.getByText(TITLE)).toHaveCount(0);

      // Office (Staff · edit, no approve — the 30 Oct rule): no assign, no board.
      const refused = await officePage.request.post("/api/staff/tasks", {
        data: { op: "assign", title: `E2E office ${tag}`, detail: "", assigneeStaffId: ASSIGNEE, priority: "normal", dueOn: null, evidenceRequired: false },
      });
      expect(refused.status()).toBe(403);
      await officePage.goto("/staff");
      const officeTab = officePage.getByRole("tab", { name: "Tasks", exact: true });
      await expect(officeTab).toBeVisible({ timeout: 15_000 });
      await officeTab.click();
      await expect(officePage.getByText("My tasks")).toBeVisible({ timeout: 15_000 });
      await expect(officePage.getByText("Assign a new task")).toHaveCount(0);
    });

    await test.step("evidence is required before review", async () => {
      await teacher.page.getByText(TITLE).click();
      await teacher.page.getByRole("button", { name: "Done — send for review", exact: true }).click();
      await expect(
        teacher.page.getByText("This task needs a photo, file or link as evidence before it can be sent for review."),
      ).toBeVisible();
    });

    await test.step("evidence upload through the panel lands in the bucket, task-scoped", async () => {
      await teacher.page.locator('input[type="file"]').setInputFiles({
        name: "photo.jpg",
        mimeType: "image/jpeg",
        buffer: PHOTO,
      });
      await expect(teacher.page.getByText("photo.jpg")).toBeVisible({ timeout: 15_000 });
      await teacher.page.getByRole("button", { name: "Done — send for review", exact: true }).click();

      let body!: {
        task: { status: string; updatedAt: string };
        updates: { attachments: { kind: string; name: string; path: string }[] }[];
      };
      await expect
        .poll(
          async () => {
            const one = await teacher.page.request.get(`/api/staff/tasks/${taskId}`);
            if (one.status() !== 200) return "";
            body = (await one.json()) as typeof body;
            return body.task.status;
          },
          { timeout: 15_000 },
        )
        .toBe("submitted");
      const att = body.updates.flatMap((u) => u.attachments ?? []).find((a) => a.name === "photo.jpg");
      expect(att, "the submitted evidence is on the task's own log").toBeTruthy();
      evidencePath = att!.path;
      base = body.task.updatedAt;
      expect(evidencePath.startsWith(`staff-tasks/${taskId}/`)).toBe(true);

      // The object really is in the in-memory bucket (service-key list, as the app sees it).
      const storage = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const listRes = await teacher.page.request.get(
        `${storage}/storage/v1/object/school-files/${evidencePath}`,
      );
      expect(listRes.status()).toBe(403); // no service key in the browser: the bucket itself refuses
    });

    await test.step("download is task-scoped on every path", async () => {
      const own = await teacher.page.request.get(`/api/staff/tasks/evidence/${evidencePath}`);
      expect(own.status()).toBe(200);
      expect(Buffer.from(await own.body()).equals(PHOTO)).toBe(true);

      const stranger = await other.page.request.get(`/api/staff/tasks/evidence/${evidencePath}`);
      expect(stranger.status()).toBe(403);

      const board = await principal.page.request.get(`/api/staff/tasks/evidence/${evidencePath}`);
      expect(board.status()).toBe(200);

      const officeTry = await officePage.request.get(`/api/staff/tasks/evidence/${evidencePath}`);
      expect(officeTry.status()).toBe(403);

      // The old staff-wide file route must not serve staff-task evidence at all.
      const generic = await officePage.request.get(`/api/file/${evidencePath}`);
      expect(generic.status()).toBe(404);
    });

    await test.step("review accept, and a stale base is refused with the first result standing", async () => {
      const second = await openAs(browser, "principal");
      try {
        const accept = { op: "review", decision: "accept", note: "Checked", base };
        const first = await principal.page.request.patch(`/api/staff/tasks/${taskId}`, { data: accept });
        expect(first.status()).toBe(200);

        const stale = await second.page.request.patch(`/api/staff/tasks/${taskId}`, { data: accept });
        expect(stale.status()).toBe(409);

        const finalGet = await teacher.page.request.get(`/api/staff/tasks/${taskId}`);
        const final = (await finalGet.json()) as { task: { status: string } };
        expect(final.task.status).toBe("done");
      } finally {
        await second.context.close();
      }
    });
  } catch (e) {
    await dumpPages(e);
  } finally {
    // Teardown must never hang or mask the real failure: a stuck context
    // close once hid the actual assertion behind a bare 120 s timeout.
    await Promise.allSettled(
      [principal, teacher, other].map(({ context }) =>
        Promise.race([context.close(), new Promise((res) => setTimeout(res, 10_000))]),
      ),
    );
  }
});
