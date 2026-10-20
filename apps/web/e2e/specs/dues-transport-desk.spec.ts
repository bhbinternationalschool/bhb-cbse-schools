/**
 * dues-transport-desk — every screen that prints a child's dues loads the
 * transport desk first, recomputes when it lands, and says "not loaded" when
 * it cannot be read (15 Oct 2026, the defect class #665 found in
 * StudentFeeDuesCard).
 *
 * The dues engine (computeStudentDues / computeHouseholdDues) derives the bus
 * months from loadTransport(), which is EMPTY in a page that has not loaded
 * the transport desk — and the screens below read it once, on mount. So:
 *
 *   - the transport-desk read is HELD for a few seconds (a slow line, or the
 *     app shell's idle sweep not having reached it yet): the screen must gain
 *     the bus months when it lands. On the old code they never appeared.
 *   - the read FAILS: the screen must say the dues are not loaded and must
 *     not act on them (the adjustments desk's "Leave mid-year" wrote off only
 *     what it was shown). On the old code it showed tuition-only dues.
 *
 * The rider (e2e/duesTransportCase.ts): ₹500/month from April, April–
 * September paid, October owing. Written by scripts/e2e-seed-dues-transport.ts.
 *
 * The parent web portal (/parent) is checked too: a parent session is refused
 * every staff desk, and the page reads the family's dues from the server
 * (PR #670), so its bus months are all there, the paid ones as paid.
 *
 * Screenshots: e2e/dues-transport-shots (git-ignored), desktop-light and
 * phone375-dark.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { demoSessionCookieName } from "@/lib/auth";
import { APP_URL, expect, signIn, test } from "../support";
import { mintSessionCookie } from "../session";
import { AY_CURRENT, E2E_TENANT_SLUG } from "../fixture";
import { CHILD, PAID } from "../duesTransportCase";

const SHOTS = process.env.DUES_TRANSPORT_SHOTS || path.join(__dirname, "..", "dues-transport-shots");
const HOLD_MS = 8_000;

type Shot = { name: string; width: number; height: number; dark: boolean };
const SHOTS_AT: Shot[] = [
  { name: "desktop-light", width: 1440, height: 900, dark: false },
  { name: "phone375-dark", width: 375, height: 812, dark: true },
];

/** A principal's page whose transport-desk read is held, or fails. */
async function open(browser: Browser, shot: Shot, desk: "hold" | "fail"): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: shot.width, height: shot.height },
    colorScheme: shot.dark ? "dark" : "light",
  });
  await signIn(context, "principal");
  await context.addCookies([{ name: "bhb_theme", value: shot.dark ? "dark" : "light", url: APP_URL }]);
  await context.route("**/api/school-data/transport-desk**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (desk === "fail") return route.abort("connectionfailed");
    await new Promise((r) => setTimeout(r, HOLD_MS));
    return route.continue();
  });
  return context.newPage();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  expect(CHILD, "fixture has a second spare current-year child").toBeTruthy();
  execFileSync("npx", ["--yes", "tsx", path.join(__dirname, "..", "..", "..", "..", "scripts", "e2e-seed-dues-transport.ts")], {
    cwd: path.join(__dirname, "..", ".."),
    stdio: "inherit",
    env: process.env,
  });
  fs.mkdirSync(SHOTS, { recursive: true });
});

async function openProfileFees(page: Page): Promise<ReturnType<Page["getByRole"]>> {
  await page.goto("/students?tab=register");
  await page.getByPlaceholder(/Search name, adm no/).first().fill(CHILD.fullName);
  // The roster row (its name carries the admission no), not a sibling chip.
  await page.getByRole("button", { name: new RegExp(`${CHILD.admissionNo} ·`) }).first().click({ timeout: 30_000 });
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Fees", exact: true }).click();
  return dialog;
}

for (const shot of SHOTS_AT) {
  test(`student profile (${shot.name}): bus months appear when the transport desk lands`, async ({ browser }) => {
    const page = await open(browser, shot, "hold");
    const dialog = await openProfileFees(page);
    // Paid months are listed (includePaid) and October is owing.
    await expect(dialog.getByText("Transport · October 2026", { exact: false }).first()).toBeVisible({
      timeout: HOLD_MS + 20_000,
    });
    await expect(dialog.getByText("Transport · April 2026", { exact: false }).first()).toBeVisible();
    await expect(dialog.getByText("Transport · September 2026", { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `profile-fees-${shot.name}.png`), fullPage: false });
    await page.context().close();
  });

  test(`student profile (${shot.name}): an unreadable transport desk reads as not loaded`, async ({ browser }) => {
    const page = await open(browser, shot, "fail");
    const dialog = await openProfileFees(page);
    await expect(dialog.getByRole("alert")).toContainText("Fee dues not loaded — the transport desk could not be read", {
      timeout: 30_000,
    });
    // No figure at all — not tuition-only totals.
    await expect(dialog.getByText("Outstanding")).toHaveCount(0);
    await expect(dialog.getByText(/Transport · /)).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, `profile-not-loaded-${shot.name}.png`), fullPage: false });
    await page.context().close();
  });
}

async function openAdjustments(page: Page): Promise<void> {
  await page.goto("/fees?tab=adjustments");
  // The adjustments' own picker (the previous-dues panel above has one too).
  const picker = page.locator("div").filter({ has: page.getByRole("heading", { name: "Student", exact: true }) }).last();
  await picker.getByPlaceholder("Search name / admission…").fill(CHILD.fullName);
  await picker.getByRole("button", { name: new RegExp(`${CHILD.admissionNo} ·`) }).first().click({ timeout: 30_000 });
}

for (const shot of SHOTS_AT) {
  test(`fee adjustments (${shot.name}): October transport is on the open ledger once the desk lands`, async ({ browser }) => {
    const page = await open(browser, shot, "hold");
    await openAdjustments(page);
    const ledger = page.locator("div").filter({ has: page.getByRole("heading", { name: /^Open ledger/ }) }).last();
    await expect(ledger.getByText(/Transport · October 2026/)).toBeVisible({ timeout: HOLD_MS + 20_000 });
    // Paid months are not open.
    await expect(ledger.getByText(/Transport · September 2026/)).toHaveCount(0);
    await ledger.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `adjustments-ledger-${shot.name}.png`), fullPage: false });
    await page.context().close();
  });

  test(`fee adjustments (${shot.name}): an unreadable transport desk blocks waivers and leave-settle`, async ({ browser }) => {
    const page = await open(browser, shot, "fail");
    let confirmed = 0;
    page.on("dialog", (d) => {
      confirmed += 1;
      void d.dismiss();
    });
    await openAdjustments(page);
    const alert = page.getByRole("alert").filter({ hasText: "Dues not loaded" });
    await expect(alert).toContainText("the transport desk could not be read", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /^Open ledger/ })).toHaveCount(0);
    // "Leave mid-year" writes off what it is shown: it must refuse, not ask.
    await page.getByRole("button", { name: /Leave mid-year/ }).click();
    await page.waitForTimeout(500);
    expect(confirmed, "no write-off confirmation is offered on dues that are not loaded").toBe(0);
    await alert.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `adjustments-not-loaded-${shot.name}.png`), fullPage: false });
    await page.context().close();
  });
}

test("parent web portal: a parent reads no staff desk, and sees every bus month from the server", async ({ browser }) => {
  for (const shot of SHOTS_AT) {
    const context = await browser.newContext({
      baseURL: APP_URL,
      viewport: { width: shot.width, height: shot.height },
      colorScheme: shot.dark ? "dark" : "light",
    });
    await context.addCookies([
      {
        name: demoSessionCookieName(),
        value: mintSessionCookie({
          persona: "parent",
          fullName: CHILD.fatherName || "E2E Parent",
          roleCode: "parent",
          householdId: CHILD.householdId,
          tenantSlug: E2E_TENANT_SLUG,
          academicYearCode: AY_CURRENT,
        }),
        url: APP_URL,
        httpOnly: true,
        sameSite: "Lax",
      },
      { name: "bhb_theme", value: shot.dark ? "dark" : "light", url: APP_URL },
    ]);
    const page = await context.newPage();
    for (const desk of ["transport-desk", "fees-vouchers", "sis-roster"]) {
      const res = await page.request.get(`/api/school-data/${desk}`);
      expect([401, 403], `${desk} is refused to a parent`).toContain(res.status());
    }
    // The page reads the parent's own dues from the server instead
    // (GET /api/payments/parent-dues, PR #670): every bus month is there,
    // paid ones as paid — never a fee book with the bus months missing.
    await page.goto("/parent");
    await expect(page.getByTestId("parent-due-now")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/No household linked/)).toHaveCount(0);
    const chip = page.locator(`button[data-student-id="${CHILD.id}"]`);
    if (await chip.count()) await chip.click();
    for (const ym of PAID) {
      await expect(
        page.locator(`li[data-due-kind="transport"][data-due-month="${ym}"]`),
        `${ym} bus month shown as paid`,
      ).toHaveAttribute("data-paid", "1");
    }
    await page.screenshot({ path: path.join(SHOTS, `parent-portal-${shot.name}.png`), fullPage: false });
    await context.close();
  }
});
