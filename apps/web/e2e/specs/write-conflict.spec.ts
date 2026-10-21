/**
 * write-conflict — data-layer step 1.5 acceptance: two browsers edit the same
 * subject through the write kernel. The second gets the conflict notice and
 * sees the first's value; its own stale save is never written.
 *
 * Both contexts are the Principal (the fixture's Office role may only view
 * Masters). The screen is the test-only /e2e/write-kernel (GET
 * /api/data/masters.subjects, save through useSaveMutation → POST
 * /api/data/masters.subjects → desk_slice_row_write with the element's `_rev`
 * it read as the base — data-layer 2.2b). The subject is put back as seeded at the end.
 */
import type { Page } from "@playwright/test";
import { expect, metric, openAs, test } from "../support";

const SUBJECT = "e2e_sub_eng";

async function openEditor(page: Page): Promise<void> {
  await page.goto("/e2e/write-kernel");
  await expect(page.getByTestId(`subject-${SUBJECT}`)).toBeVisible({ timeout: 15_000 });
}

async function rename(page: Page, to: string): Promise<void> {
  // Within the subject's own row: another subject's id may start with this one's.
  const item = page.getByTestId(`subject-${SUBJECT}`);
  await item.getByRole("textbox").fill(to);
  await item.getByRole("button").click();
}

const nameOn = (page: Page) => page.getByTestId(`subject-${SUBJECT}`).getByTestId("subject-name");

test("two contexts edit the same subject: the second is refused, told so, and shows the first's value", async ({ browser }, testInfo) => {
  const a = await openAs(browser, "principal");
  const b = await openAs(browser, "principal");
  const tag = Date.now().toString(36);
  const first = `English A-${tag}`;
  const second = `English B-${tag}`;
  let original = "";
  try {
    await test.step("both open the subject (B holds the same _rev as A)", async () => {
      await openEditor(a.page);
      await openEditor(b.page);
      original = (await nameOn(a.page).textContent()) ?? "";
      expect(original).not.toBe("");
      await expect(nameOn(b.page)).toHaveText(original);
    });

    await test.step("A saves first", async () => {
      await rename(a.page, first);
      await expect(a.page.getByTestId("kernel-toast")).toHaveText("Saved");
      await expect(nameOn(a.page)).toHaveText(first);
    });

    await test.step("B saves from its older copy: the conflict notice, and A's value on screen", async () => {
      await rename(b.page, second);
      await expect(b.page.getByTestId("kernel-toast")).toContainText("someone else changed this");
      await expect(nameOn(b.page)).toHaveText(first);
    });

    await test.step("the database holds A's value (B's was never written)", async () => {
      const r = await a.page.request.get("/api/data/masters.subjects?limit=1000");
      const body = (await r.json()) as { rows: { id: string; nameEn?: string }[] };
      expect(body.rows.find((s) => s.id === SUBJECT)?.nameEn).toBe(first);
      const desk = await a.page.request.get("/api/school-data/masters-desk");
      const deskBody = (await desk.json()) as { subjects: { id: string; nameEn?: string }[] };
      expect(deskBody.subjects.find((s) => s.id === SUBJECT)?.nameEn).toBe(first);
    });
    await metric(testInfo, "write-conflict", { first, second, refused: true });
  } finally {
    // Put the seed back through the same kernel (fresh read → current stamp).
    if (original) {
      await openEditor(a.page);
      await rename(a.page, original);
      await expect(a.page.getByTestId("kernel-toast")).toHaveText("Saved");
    }
    await a.context.close();
    await b.context.close();
  }
});
