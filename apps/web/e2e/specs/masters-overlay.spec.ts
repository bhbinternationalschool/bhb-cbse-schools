/**
 * masters-overlay — data-layer 2.1h review fixes: the Masters editor keeps
 * what a commit sent until an answer of the masters view provably holds it
 * (components/masters/mastersPending.ts). Writes Masters, so it runs in the
 * "propagation" project (after every reader), and puts the school back.
 *
 *   1. A stale answer after a save cannot revert edit A. The principal
 *      inactivates the Main Campus (edit A, the campuses section). From then
 *      on views/masters answers with the book from BEFORE the save (the body
 *      the page first got — built from the old revision), as another
 *      instance's cache would. The screen must keep A; then the principal
 *      renames class IV's section in another panel (edit B). Edit A must
 *      still be on the server after B's save, and once views/masters answers
 *      truthfully again the screen shows both.
 *      On the branch before this fix the stale answer dropped the overlay,
 *      the screen went back to "Active", and B's save sent the campuses
 *      section again with the old value: A reverted on the server.
 *   2. A refused save: masters-desk answers 409; the screen goes back to the
 *      stored value and says "Not saved" (before: the refused edit stayed on
 *      screen and was sent again with the next commit).
 */
import type { APIRequestContext, Page, Route } from "@playwright/test";
import { APP_URL, collectPageErrors, expect, signIn, test } from "../support";

type Campus = { id: string; name: string; isActive: boolean };
type Section = { id: string; classId: string; name: string };
type Desk = { campuses: Campus[]; sections: Section[]; sliceStamps?: Record<string, string> };

const CAMPUS = "e2e_cam_main";
const CLASS_IV = "e2e_cls_07";

async function desk(req: APIRequestContext): Promise<Desk> {
  const res = await req.get("/api/school-data/masters-desk");
  expect(res.status(), "GET masters-desk").toBe(200);
  return (await res.json()) as Desk;
}

async function putBack(req: APIRequestContext): Promise<void> {
  const d = await desk(req);
  const res = await req.post("/api/school-data/masters-desk", {
    data: {
      version: 2,
      campuses: d.campuses.map((c) => (c.id === CAMPUS ? { ...c, isActive: true } : c)),
      sections: d.sections.map((s) => (s.classId === CLASS_IV ? { ...s, name: "A" } : s)),
      sliceBases: { campuses: d.sliceStamps?.campuses ?? "", sections: d.sliceStamps?.sections ?? "" },
    },
  });
  expect(res.status(), `put back: ${(await res.text()).slice(0, 200)}`).toBe(200);
}

async function principalPage(browser: import("@playwright/test").Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 } });
  await signIn(context, "principal");
  return context.newPage();
}

const campusRow = (p: Page) => p.getByRole("row").filter({ hasText: "Main Campus" });

test.describe.configure({ mode: "serial" });

test("a stale masters answer after a save does not revert edit A (on screen or on the server)", async ({ browser }) => {
  const page = await principalPage(browser);
  const errors = collectPageErrors(page);
  await putBack(page.request); // a known start, whatever an earlier run left
  try {
    // Capture the first (pre-save) answer; after A's save, serve it again and again.
    let preSave: string | null = null;
    let staleMode = false;
    let staleServed = 0;
    await page.route("**/api/data/views/masters", async (route: Route) => {
      if (staleMode && preSave) {
        staleServed += 1;
        return route.fulfill({ status: 200, contentType: "application/json", body: preSave });
      }
      const res = await route.fetch();
      const body = await res.text();
      if (!preSave) preSave = body;
      return route.fulfill({ response: res, body });
    });

    await page.goto("/masters?tab=campuses");
    await expect(campusRow(page).getByRole("button", { name: "Inactivate" })).toBeVisible({ timeout: 30_000 });
    expect(preSave, "the page read views/masters").not.toBeNull();

    // Edit A. Every answer from here on is the pre-save book.
    const savedA = page.waitForResponse((r) => r.url().includes("/api/school-data/masters-desk") && r.request().method() === "POST");
    staleMode = true;
    await campusRow(page).getByRole("button", { name: "Inactivate" }).click();
    expect((await savedA).status(), "edit A saved").toBe(200);
    expect((await desk(page.request)).campuses.find((c) => c.id === CAMPUS)?.isActive, "A on the server").toBe(false);

    // The editor re-asks; every answer is stale. A stays on screen.
    await expect.poll(() => staleServed, { timeout: 15_000, message: "the editor re-asked after the save" }).toBeGreaterThan(0);
    await page.waitForTimeout(3_000);
    await expect(campusRow(page).getByRole("button", { name: "Activate", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("overlay-after-stale-answer.png") });

    // Edit B in another panel of the same page (answers still stale).
    await page.getByRole("tab", { name: /^Academic/ }).click();
    await page.getByRole("tab", { name: "Classes & sections" }).click();
    await page.getByRole("button", { name: "IV 1 section", exact: true }).click({ timeout: 20_000 });
    await page.getByRole("tab", { name: "2 · Sections" }).click();
    const row = page.getByRole("listitem").filter({ hasText: /^IV-A/ });
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Rename section" }).fill("B");
    const savedB = page.waitForResponse((r) => r.url().includes("/api/school-data/masters-desk") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Update", exact: true }).click();
    const resB = await savedB;
    const bodyB = resB.request().postDataJSON() as Record<string, unknown>;
    expect(resB.status(), "edit B saved").toBe(200);
    expect(Object.keys(bodyB), "B's save carries its own section").toContain("sections");

    // The proof: A is still on the server after B's save, and B landed too.
    const after = await desk(page.request);
    expect(after.campuses.find((c) => c.id === CAMPUS)?.isActive, "edit A survives edit B on the server").toBe(false);
    expect(after.sections.find((s) => s.classId === CLASS_IV)?.name, "edit B on the server").toBe("B");

    // Answers truthful again: the screen takes the server's book (A and B).
    staleMode = false;
    await page.getByRole("tab", { name: /^Institution/ }).click();
    await page.getByRole("tab", { name: "Campuses" }).click();
    await expect(campusRow(page).getByRole("button", { name: "Activate", exact: true })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: test.info().outputPath("overlay-after-truth.png") });
  } finally {
    await putBack(page.request);
    await page.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

test("a refused save puts the stored value back on screen and says so", async ({ browser }) => {
  const page = await principalPage(browser);
  const errors = collectPageErrors(page);
  await putBack(page.request);
  try {
    await page.goto("/masters?tab=campuses");
    await expect(campusRow(page).getByRole("button", { name: "Inactivate" })).toBeVisible({ timeout: 30_000 });
    await page.route("**/api/school-data/masters-desk", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: "Someone changed the same part of Masters on another device.", reason: "slice_stale", conflicts: ["campuses"] }),
          })
        : route.fallback(),
    );
    await campusRow(page).getByRole("button", { name: "Inactivate" }).click();
    await expect(page.getByText("Not saved — showing the school's saved Masters again.")).toBeVisible({ timeout: 15_000 });
    await expect(campusRow(page).getByRole("button", { name: "Inactivate" })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: test.info().outputPath("refused-save.png") });
    expect((await desk(page.request)).campuses.find((c) => c.id === CAMPUS)?.isActive, "nothing stored").toBe(true);
  } finally {
    await page.unroute("**/api/school-data/masters-desk");
    await page.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});
