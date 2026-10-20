/**
 * dues-screens-transport — every browser screen that computes dues shows the
 * bus months, owing and paid, opened cold (15 Oct 2026, follow-up to #665).
 *
 * `computeStudentDues` reads the transport desk from memory. Screens that
 * computed before that desk had loaded — and never recomputed — left every
 * transport month out. Fixed with useDuesInputs (components/fees) plus
 * loadTransport() starting the load on first read and route preloads.
 *
 * Fixture: the Anvi shape (e2e/transportPaidCase.ts) for a spare child:
 * Apr–Aug paid under an assignment whose stop vanished, September paid under
 * the old id and re-billed under a backdated new stop, October ₹500 owing.
 *
 * Screens: the student profile modal's Fees tab (Students → Register), the
 * counter's Adjustments panel, the Defaulters list. Screenshots in
 * e2e/dues-screens-shots (git-ignored), desktop-light and phone-375-dark.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { APP_URL, expect, signIn, test } from "../support";
import { CHILD } from "../transportPaidCase";

const SHOTS = process.env.DUES_SCREENS_SHOTS || path.join(__dirname, "..", "dues-screens-shots");
const SIZES = [
  { name: "desktop-light", width: 1440, height: 900, dark: false },
  { name: "phone375-dark", width: 375, height: 812, dark: true },
] as const;

async function open(browser: Browser, opts: { width: number; height: number; dark?: boolean }): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  await signIn(context, "principal");
  await context.addCookies([{ name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL }]);
  return context.newPage();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  expect(CHILD, "fixture has a spare current-year child").toBeTruthy();
  // Through tsx, like the stack's own seed (see e2e/transportPaidCase.ts).
  execFileSync("npx", ["--yes", "tsx", path.join(__dirname, "..", "..", "..", "..", "scripts", "e2e-seed-transport-paid.ts")], {
    cwd: path.join(__dirname, "..", ".."),
    stdio: "inherit",
    env: { ...process.env, TPM_STEP: "" },
  });
  fs.mkdirSync(SHOTS, { recursive: true });
});

for (const size of SIZES) {
  test(`student profile Fees tab (${size.name}): bus months paid and owing`, async ({ browser }) => {
    const page = await open(browser, size);
    await page.goto("/students?tab=register");
    await page.locator("button", { has: page.getByText(`${CHILD.admissionNo} · `) }).first().click({ timeout: 30_000 });
    await page.getByRole("button", { name: /^Fees$/ }).first().click();
    const row = (label: RegExp) => page.locator("tr", { has: page.getByText(label) });
    // Paid from receipts of an assignment that bills nothing now.
    await expect(row(/^Transport · April 2026 · TPM-1 · paid$/)).toContainText("₹500", { timeout: 20_000 });
    // Paid under the old stop, billed under the new one.
    await expect(row(/^Transport · September 2026 · TPM-1$/)).toBeVisible();
    // Owing.
    await expect(row(/^Transport · October 2026 · TPM-1$/)).toContainText("₹500");
    // Billed ₹6,000 · paid ₹3,000 · outstanding ₹3,000 (Oct–Mar), nothing counted twice.
    await expect(page.getByText("₹6,000", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("₹3,000", { exact: true })).toHaveCount(2);
    await page.screenshot({ path: path.join(SHOTS, `profile-modal-${size.name}.png`) });
    await page.context().close();
  });
}

for (const size of SIZES) {
  test(`fee adjustments (${size.name}): the bus months owing can be waived`, async ({ browser }) => {
    const page = await open(browser, size);
    await page.goto("/fees?tab=adjustments");
    await page.locator('input.field.mt-2[placeholder="Search name / admission…"]').fill(CHILD.admissionNo, { timeout: 30_000 });
    await page.getByRole("button", { name: new RegExp(CHILD.fullName, "i") }).first().click();
    const options = page.locator("select option");
    await expect(options.filter({ hasText: /^Transport · October 2026 · TPM-1 · ₹500$/ })).toHaveCount(1, { timeout: 20_000 });
    await expect(options.filter({ hasText: /^Transport · September 2026/ })).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, `adjustments-${size.name}.png`) });
    await page.context().close();
  });
}

for (const size of SIZES) {
  test(`defaulters (${size.name}): the child owes the October bus fee`, async ({ browser }) => {
    const page = await open(browser, size);
    await page.goto("/fees/defaulters");
    const entry = page.getByRole("button", { name: new RegExp(`${CHILD.fullName}.*${CHILD.admissionNo}`, "i") }).first();
    await expect(entry).toBeVisible({ timeout: 30_000 });
    await expect(entry).toContainText("₹500");
    await entry.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `defaulters-${size.name}.png`) });
    await page.context().close();
  });
}
