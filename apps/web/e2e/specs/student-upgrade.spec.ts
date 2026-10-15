/**
 * student-upgrade — Students → Upgrade keeps the fee group when none matches.
 *
 * Until 15 Oct 2026 the screen said "(no matching group found — keep
 * current)" and then saved the child with NO fee group (lib/classUpgrade.ts
 * assigned resolveFeeGroupId's null). The fixture gives one child, in LKG, the
 * only fee group (LKG, Promoted — e2e/fixture.ts UPGRADE_FEE_GROUP); this
 * moves that child to UKG, where nothing matches, and asserts:
 *   - the hint promises to keep the current group;
 *   - after "Upgrade class" the panel and the history row show the group kept;
 *   - a fresh browser, reading the roster from the server, still shows it.
 *
 * Writes to the stack, so it runs in the "propagation" project (after every
 * read-only spec). Screenshots to e2e/student-upgrade-shots (git-ignored).
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { APP_URL, expect, fx, signIn, test } from "../support";
import { AY_CURRENT, UPGRADE_CHILD_INDEX, UPGRADE_FEE_GROUP } from "../fixture";

const SHOTS = process.env.STUDENT_UPGRADE_SHOTS || path.join(__dirname, "..", "student-upgrade-shots");
const ADMISSION_NO = `E2E-${String(UPGRADE_CHILD_INDEX).padStart(4, "0")}`;
const CHILD = fx.sis.students.find((s) => s.admissionNo === ADMISSION_NO && s.academicYearCode === AY_CURRENT)!;

async function openUpgrade(browser: Browser, opts: { width: number; height: number; dark?: boolean }): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  await signIn(context, "principal");
  await context.addCookies([{ name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL }]);
  const page = await context.newPage();
  await page.goto("/students?tab=upgrade");
  await expect(page.getByPlaceholder("Search name, admission no, roll…")).toBeVisible({ timeout: 90_000 });
  return page;
}

async function pickChild(page: Page) {
  await page.getByPlaceholder("Search name, admission no, roll…").fill(ADMISSION_NO);
  await page.getByRole("button", { name: new RegExp(ADMISSION_NO) }).first().click({ timeout: 60_000 });
}

test.describe("student upgrade — fee group", () => {
  test.setTimeout(300_000);

  test("no matching group keeps the current one — on screen and on the server", async ({ browser }) => {
    expect(CHILD, "fixture child").toBeTruthy();
    expect(CHILD.feeGroupId).toBe(UPGRADE_FEE_GROUP.id);

    const page = await openUpgrade(browser, { width: 1440, height: 900 });
    await pickChild(page);
    await expect(page.getByText(`Fee: ${UPGRADE_FEE_GROUP.name}`)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("group", { name: "Upgrade mode" }).getByRole("button", { name: "Class + section" }).click();
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Upgrade class" }) });
    await form.locator("select").nth(0).selectOption({ label: "UKG" });
    await form.locator("select").nth(1).selectOption({ index: 1 });
    await expect(page.getByText("(no matching group found — keep current)")).toBeVisible();

    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "upgrade-before-desktop-light.png"), fullPage: true });

    await page.getByRole("button", { name: "Upgrade class" }).click();
    await expect(page.getByText(/^Updated .* → UKG-A$/)).toBeVisible({ timeout: 30_000 });
    // The panel re-reads the saved child: the group is still there.
    await expect(page.getByText(`Fee: ${UPGRADE_FEE_GROUP.name}`)).toBeVisible();
    // The history row says the group went nowhere ("E2E LKG Promoted → E2E LKG Promoted", not "→ —").
    const historyRow = page.locator("tr", { hasText: CHILD.fullName }).first();
    await expect(historyRow.locator("td").filter({ hasText: "→" }).last()).toHaveText(
      new RegExp(`${UPGRADE_FEE_GROUP.name}\\s*→\\s*${UPGRADE_FEE_GROUP.name}`),
    );
    await page.screenshot({ path: path.join(SHOTS, "upgrade-after-desktop-light.png"), fullPage: true });
    // Let the roster push reach the server before the browser goes.
    await page.waitForTimeout(4_000);
    await page.context().close();

    // A fresh browser reads the roster from the server.
    for (let attempt = 0; ; attempt += 1) {
      const fresh = await openUpgrade(browser, { width: 375, height: 812, dark: true });
      await pickChild(fresh);
      try {
        await expect(fresh.getByText(/Current:.*UKG-A/)).toBeVisible({ timeout: 15_000 });
        await expect(fresh.getByText(`Fee: ${UPGRADE_FEE_GROUP.name}`)).toBeVisible();
        await fresh.screenshot({ path: path.join(SHOTS, "upgrade-after-phone375-dark.png"), fullPage: true });
        await fresh.context().close();
        break;
      } catch (e) {
        await fresh.context().close();
        if (attempt >= 3) throw e;
      }
    }
  });
});
