/**
 * error — a failed Masters read is shown as a failure, never as an empty school.
 *
 * GET /api/school-data/masters-desk is intercepted to answer exactly what the
 * route answers when its database read fails (data-layer 0.5b: 503,
 * `{ ok:false, error:"Could not read the school setup — please try again." }`).
 * Each screen must then say it could not load and offer "Try again" — and must
 * NOT draw its class / subject pickers (an empty picker is the old failure: a
 * read error shown as "this school has no classes"). Then the intercept is
 * lifted and "Try again" must bring the real school back (15 classes) without
 * a page reload.
 *
 * Selectors: the visible text /could not load/i and the button named
 * "Try again" (components/shell/CoreDataGate.tsx draws both for every desk
 * route), and the "Class" combobox.
 *
 * Measured 13 Oct 2026 on origin/main: every page below passes — CoreDataGate
 * already turns the 503 into "Could not load the school's classes, subjects
 * and staff from the server. Try again".
 */
import type { Page } from "@playwright/test";
import { expect, fx, metric, test } from "../support";

const FAILED_READ = JSON.stringify({ ok: false, error: "Could not read the school setup — please try again." });

async function failMastersReads(page: Page): Promise<() => Promise<void>> {
  const pattern = "**/api/school-data/masters-desk**";
  let hits = 0;
  await page.route(pattern, (route) => {
    if (route.request().method() !== "GET") return route.continue();
    hits += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: FAILED_READ });
  });
  return async () => {
    expect(hits, "the page asked for masters-desk at least once").toBeGreaterThan(0);
    await page.unroute(pattern);
  };
}

const PAGES: { path: string; afterRecovery: (page: Page) => Promise<void> }[] = [
  {
    path: "/masters",
    afterRecovery: async (p) => {
      await expect(p.getByRole("button", { name: `${fx.expected.classes} Classes`, exact: true })).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    path: "/attendance",
    afterRecovery: async (p) => {
      await p.getByRole("tab", { name: "Students", exact: true }).click({ timeout: 15_000 });
      await expect(p.getByRole("combobox", { name: "Class", exact: true }).first().locator("option")).toHaveCount(fx.expected.classes + 1, { timeout: 15_000 });
    },
  },
  {
    path: "/timetable",
    afterRecovery: async (p) => {
      await expect(p.getByRole("combobox", { name: "Class", exact: true }).first().locator("option")).toHaveCount(fx.expected.classes + 1, { timeout: 15_000 });
    },
  },
  {
    path: "/homework",
    afterRecovery: async (p) => {
      // /homework's class picker has no "Select…" placeholder.
      await expect(p.getByRole("combobox", { name: "Class", exact: true }).first().locator("option")).toHaveCount(fx.expected.classes, { timeout: 15_000 });
    },
  },
];

for (const p of PAGES) {
  test(`office ${p.path}: masters-desk 503 shows "could not load" + Try again, not empty pickers; Try again recovers`, async ({ page }, testInfo) => {
    const lift = await failMastersReads(page);
    const t0 = Date.now();
    await page.goto(p.path);

    await test.step("the failure is shown", async () => {
      await expect(page.getByText(/could not load/i).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    });
    const shownAfterMs = Date.now() - t0;
    await test.step("no class picker is drawn from a failed read", async () => {
      await expect(page.getByRole("combobox", { name: "Class", exact: true })).toHaveCount(0);
    });
    await test.step("Try again (read restored) brings the school back without a reload", async () => {
      await lift();
      await page.getByRole("button", { name: "Try again" }).click();
      await p.afterRecovery(page);
    });
    await metric(testInfo, "error", { page: p.path, failureShownAfterMs: shownAfterMs });
  });
}
