/**
 * student-upgrade — Students → Upgrade keeps the fee group when none matches.
 *
 * Until 15 Oct 2026 the screen said "(no matching group found — keep
 * current)" and then saved the child with NO fee group (lib/classUpgrade.ts
 * assigned resolveFeeGroupId's null). The fixture gives one child, in LKG, the
 * only fee group (LKG, Promoted — e2e/fixture.ts UPGRADE_FEE_GROUP); this
 * moves that child to the first class no fee group matches, and asserts:
 *   - the hint promises to keep the current group;
 *   - after "Upgrade class" the panel and the history row show the group kept;
 *   - a fresh browser, reading the upgrade history from the server, shows
 *     the group kept ("E2E LKG Promoted → E2E LKG Promoted").
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
    // The target must be a class NO fee group matches. Which classes match
    // depends on every fee group the shared fixture seeds (other specs add
    // groups — "Foundation (Nur–UKG)" made UKG match on 15 Oct), so the class
    // is found on screen rather than assumed: the first one whose remap line
    // says "no matching group".
    const NO_MATCH = "(no matching group found — keep current)";
    const classSelect = form.locator("select").nth(0);
    const sectionSelect = form.locator("select").nth(1);
    const classOptions = (await classSelect.locator("option").allTextContents())
      .map((t) => t.trim())
      .filter((t) => t && !/^(select|choose|—|-)/i.test(t) && t !== "LKG");
    let target: { cls: string; section: string } | null = null;
    for (const cls of classOptions) {
      await classSelect.selectOption({ label: cls });
      const sections = (await sectionSelect.locator("option").allTextContents()).map((t) => t.trim());
      if (sections.length < 2) continue;
      await sectionSelect.selectOption({ index: 1 });
      if (await page.getByText(NO_MATCH).isVisible().catch(() => false)) {
        target = { cls, section: sections[1]! };
        break;
      }
    }
    expect(target, `a class with no matching fee group among: ${classOptions.join(", ")}`).not.toBeNull();
    await expect(page.getByText(NO_MATCH)).toBeVisible();

    fs.mkdirSync(SHOTS, { recursive: true });
    await page.getByText(NO_MATCH).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, "upgrade-before-desktop-light.png") });

    await page.getByRole("button", { name: "Upgrade class" }).click();
    const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(
      page.getByText(new RegExp(`^Updated .* → ${escape(target!.cls)}-${escape(target!.section)}$`)),
    ).toBeVisible({ timeout: 30_000 });
    // The panel re-reads the saved child: the group is still there.
    await expect(page.getByText(`Fee: ${UPGRADE_FEE_GROUP.name}`)).toBeVisible();
    // The history row says the group went nowhere ("E2E LKG Promoted → E2E LKG Promoted", not "→ —").
    const kept = new RegExp(`${UPGRADE_FEE_GROUP.name}\\s*→\\s*${UPGRADE_FEE_GROUP.name}`);
    const historyRow = page.locator("tr", { hasText: CHILD.fullName }).first();
    await expect(historyRow.locator("td").filter({ hasText: kept })).toHaveCount(1);
    await historyRow.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, "upgrade-after-desktop-light.png") });
    // Let the saves reach the server before the browser goes.
    await page.waitForTimeout(4_000);
    await page.context().close();

    // A fresh browser (no local copy) reads the upgrade history from the
    // server (sis_class_upgrades): the recorded fee group is the kept one.
    // NOT asserted here: the child's own row on the server — in this stack
    // the whole-roster push is refused (sis_push_guarded: duplicate key on
    // sis_students_tenant_admission_ay_uidx), a separate defect reported
    // with this PR.
    const fresh = await openUpgrade(browser, { width: 375, height: 812, dark: true });
    const freshRow = fresh.locator("tr", { hasText: CHILD.fullName }).first();
    await expect(freshRow.locator("td").filter({ hasText: kept })).toHaveCount(1, { timeout: 60_000 });
    await freshRow.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await fresh.waitForTimeout(400);
    await fresh.screenshot({ path: path.join(SHOTS, "upgrade-history-phone375-dark.png") });
    await fresh.context().close();
  });
});
