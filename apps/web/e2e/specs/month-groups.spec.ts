/**
 * month-groups — growing lists fold by month (components/ui/month-grouped-rows.tsx).
 *
 * The fixture seeds payroll runs over October, September and August 2026 and
 * automation runs over October, September and August 2026 (e2e/fixture.ts),
 * one of them at 20:00Z on 30 Sep — 01:30 on 1 Oct in India, so October.
 *
 * Asserted, from the DOM:
 *   - the newest month is open and older months are folded (aria-expanded,
 *     and the folded rows are not visible);
 *   - a month header toggles by click and by keyboard (Enter / Space);
 *   - "Export data" on Payroll runs carries EVERY run, folded months
 *     included — read from the downloaded CSV, not from the screen;
 *   - the IST boundary run is counted in October.
 *
 * Also saves desktop / 375 px, light / dark screenshots of both screens to
 * e2e/test-results/month-groups-shots (or MONTH_GROUPS_SHOTS).
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { APP_URL, expect, fx, signIn, test } from "../support";

// with-env.mjs passes only an allowlist of variables, so the default is a
// folder inside Playwright's (git-ignored) output directory.
const SHOTS = process.env.MONTH_GROUPS_SHOTS || path.join(__dirname, "..", "test-results", "month-groups-shots");

async function openPrincipal(
  browser: Browser,
  opts: { width: number; height: number; dark?: boolean },
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  await signIn(context, "principal");
  await context.addCookies([
    { name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL },
  ]);
  return context.newPage();
}

function monthHeader(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(`^${label}\\b`) });
}

async function openPayrollRuns(page: Page) {
  await page.goto("/payroll");
  // The tab strip settles once the viewer's payroll rights resolve.
  await page.getByRole("tab", { name: /^Runs$/ }).first().click({ timeout: 30_000 });
  await expect(monthHeader(page, "October 2026")).toBeVisible({ timeout: 30_000 });
}

async function openAutomationRuns(page: Page) {
  await page.goto("/masters?tab=automation");
  await page.getByRole("button", { name: /^Runs \(\d+\)/ }).click({ timeout: 30_000 });
  await expect(monthHeader(page, "October 2026")).toBeVisible({ timeout: 30_000 });
}

test.describe("month-grouped lists", () => {
  test("payroll runs: newest month open, older folded, toggles by click and keyboard", async ({ browser }) => {
    const page = await openPrincipal(browser, { width: 1440, height: 900 });
    await openPayrollRuns(page);

    const oct = monthHeader(page, "October 2026");
    const sep = monthHeader(page, "September 2026");
    const aug = monthHeader(page, "August 2026");
    await expect(oct).toHaveAttribute("aria-expanded", "true");
    await expect(sep).toHaveAttribute("aria-expanded", "false");
    await expect(aug).toHaveAttribute("aria-expanded", "false");
    await expect(oct).toContainText("2 runs");
    await expect(sep).toContainText("2 runs");
    await expect(aug).toContainText("1 run");

    // October's rows show; September's are in the DOM but folded.
    const octBody = page.locator(`[id="${await oct.getAttribute("aria-controls")}"]`);
    const sepBody = page.locator(`[id="${await sep.getAttribute("aria-controls")}"]`);
    await expect(octBody.locator("tr")).toHaveCount(2);
    await expect(octBody).toBeVisible();
    await expect(sepBody).toBeHidden();

    await sep.click();
    await expect(sep).toHaveAttribute("aria-expanded", "true");
    await expect(sepBody).toBeVisible();
    await expect(sepBody.locator("tr")).toHaveCount(2);

    await sep.focus();
    await page.keyboard.press("Enter");
    await expect(sep).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(sep).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect(sep).toHaveAttribute("aria-expanded", "false");

    // The row menu still works inside a group.
    await page.getByRole("button", { name: "Actions for run 2026-10" }).first().click();
    await expect(page.getByRole("menuitem", { name: "Open run" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.context().close();
  });

  test("payroll runs: Export data carries folded months too", async ({ browser }) => {
    const page = await openPrincipal(browser, { width: 1440, height: 900 });
    await openPayrollRuns(page);
    await expect(monthHeader(page, "August 2026")).toHaveAttribute("aria-expanded", "false");

    await page.getByRole("button", { name: "Export data" }).first().click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: /CSV/ }).click(),
    ]);
    const csv = fs.readFileSync(await download.path(), "utf8");
    const lines = csv.split(/\r?\n/).filter((l) => /2026-(08|09|10)/.test(l));
    expect(lines.length, `every run exported, folded or not:\n${csv}`).toBe(fx.payroll.runs.length);
    for (const m of ["2026-10", "2026-09", "2026-08"]) {
      expect(lines.filter((l) => l.includes(m)).length).toBe(fx.payroll.runs.filter((r) => r.month === m).length);
    }
    // No month header leaked into the export as a row.
    expect(csv).not.toMatch(/October 2026|September 2026|August 2026/);
    // And folding was put back after the read.
    await expect(monthHeader(page, "August 2026")).toHaveAttribute("aria-expanded", "false");
    const augBody = page.locator(`[id="${await monthHeader(page, "August 2026").getAttribute("aria-controls")}"]`);
    await expect(augBody).toBeHidden();
    await page.context().close();
  });

  test("automation runs: grouped by IST month, boundary run in October", async ({ browser }) => {
    const page = await openPrincipal(browser, { width: 1440, height: 900 });
    await openAutomationRuns(page);
    const oct = monthHeader(page, "October 2026");
    const sep = monthHeader(page, "September 2026");
    await expect(oct).toHaveAttribute("aria-expanded", "true");
    // 12 Oct, 5 Oct, and 20:00Z on 30 Sep (= 1 Oct 01:30 IST).
    await expect(oct).toContainText("3 runs");
    await expect(sep).toContainText("2 runs");
    await expect(sep).toHaveAttribute("aria-expanded", "false");
    await expect(monthHeader(page, "August 2026")).toContainText("1 run");
    await page.context().close();
  });

  test("screenshots: desktop and 375 px, light and dark", async ({ browser }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const dark of [false, true]) {
      for (const [w, h, tag] of [
        [1440, 900, "desktop"],
        [375, 812, "phone375"],
      ] as const) {
        const page = await openPrincipal(browser, { width: w, height: h, dark });
        const theme = dark ? "dark" : "light";
        await openPayrollRuns(page);
        await monthHeader(page, "October 2026").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `payroll-runs-${tag}-${theme}.png`), fullPage: true });
        // No sideways page scroll at phone width.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(1);
        await openAutomationRuns(page);
        await page.screenshot({ path: path.join(SHOTS, `automation-runs-${tag}-${theme}.png`), fullPage: true });
        await page.context().close();
      }
    }
  });
});

