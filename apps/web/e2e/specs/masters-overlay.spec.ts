/**
 * masters-overlay — data-layer 2.1h review fixes, on element writes since
 * 2.2c: the Masters editor keeps what a save sent until an answer of the
 * masters view provably holds it — per element, on its `_rev`
 * (components/masters/mastersElementPending.ts). Writes Masters, so it runs in the
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
 *      On the branch before the 2.1h fix the stale answer dropped the overlay,
 *      the screen went back to "Active", and B's save sent the campuses
 *      section again with the old value: A reverted on the server. Since
 *      2.2c B's save is B's element alone (asserted).
 *   2. A refused save: the element write answers 409; the screen goes back
 *      to the stored value and says "Not saved — …" (before 2.1h: the refused
 *      edit stayed on screen and was sent again with the next commit).
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

type Rev = { _rev?: number };

/** Put the campus and class IV's section back as seeded — through the kernel (the masters-desk POST is 410 since 2.2f). */
async function putBack(req: APIRequestContext): Promise<void> {
  const campuses = ((await (await req.get("/api/data/masters.campuses?limit=1000")).json()) as { rows: (Campus & Rev)[] }).rows;
  const sections = ((await (await req.get("/api/data/masters.sections?limit=1000")).json()) as { rows: (Section & Rev)[] }).rows;
  const ops: Record<string, unknown>[] = [];
  for (const c of campuses) {
    if (c.id === CAMPUS && !c.isActive) ops.push({ collection: "masters.campuses", op: "upsert", id: c.id, base: String(c._rev ?? 0), row: { isActive: true } });
  }
  for (const s of sections) {
    if (s.classId === CLASS_IV && s.name !== "A") ops.push({ collection: "masters.sections", op: "upsert", id: s.id, base: String(s._rev ?? 0), row: { name: "A" } });
  }
  if (ops.length === 0) return;
  const res = await req.post("/api/data/masters/batch", { data: { ops } });
  expect(res.status(), `put back: ${(await res.text()).slice(0, 200)}`).toBe(200);
}

async function principalPage(browser: import("@playwright/test").Browser): Promise<Page> {
  // No service worker (29 Oct 2026). Both tests answer the page's requests
  // with page.route, and Playwright cannot route a request of a page the
  // app's worker (public/sw.js) controls — it claims the page ~0.5 s after
  // load, which since 2.3a is when the screen is up: on CI the refused save
  // went to the real server (stored, "Campus inactivated") instead of the
  // 409 this test serves. The worker caches the shell only; nothing here
  // tests it.
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
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
    const savedA = page.waitForResponse((r) => r.url().includes("/api/data/masters.campuses") && r.request().method() === "POST");
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
    const savedB = page.waitForResponse((r) => r.url().includes("/api/data/masters.sections") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Update", exact: true }).click();
    const resB = await savedB;
    const bodyB = resB.request().postDataJSON() as { ops: { id: string }[] };
    expect(resB.status(), "edit B saved").toBe(200);
    // Since 2.2c: B's save is ONE element (IV's section), nothing of campuses.
    expect(bodyB.ops.map((o) => o.id), "B's save carries its own section only").toEqual(["e2e_sec_07a"]);

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
    await page.route("**/api/data/masters.campuses", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              ok: false,
              kind: "conflict",
              message: "Changed on another device since you loaded it",
              conflicts: [{ id: CAMPUS, status: "conflict", revision: "9", stored: {}, reason: "stale" }],
            }),
          })
        : route.fallback(),
    );
    await campusRow(page).getByRole("button", { name: "Inactivate" }).click();
    await expect(page.getByText(/^Not saved — Someone changed this on another device/)).toBeVisible({ timeout: 15_000 });
    await expect(campusRow(page).getByRole("button", { name: "Inactivate" })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: test.info().outputPath("refused-save.png") });
    expect((await desk(page.request)).campuses.find((c) => c.id === CAMPUS)?.isActive, "nothing stored").toBe(true);
  } finally {
    await page.unroute("**/api/data/masters.campuses");
    await page.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});
