/**
 * certificates-dues-gate — a TC or a fee clearance ("no outstanding fee
 * dues") is issued only on dues the server counted from the whole fee book,
 * never on a partial copy's ₹0 (21 Oct 2026).
 *
 * The defect: the gate counted dues from the tab's page copy of Masters. The
 * built-in Accountant (Fees, Transport, Certificates — no Masters grant) is
 * answered with the teaching subset: fee groups, heads and structure
 * withheld. Every child's tuition came out at ₹0, so "Issue & print" was
 * enabled for a child owing a year's tuition. On origin/main the cases marked
 * (fails on old) below fail.
 *
 * The case (e2e/certificateDuesCase.ts): ₹1,000/month tuition for one class;
 * OWES owes ₹12,000 from that structure only, CLEAR owes nothing. Seeded in
 * beforeAll through the app's Masters write path and taken out in afterAll.
 * Seeding a structure switches on the school's built-in 2026-27 structures
 * for every class (ensureFeeSetup), so this spec runs in its own project,
 * after every other writer (playwright.config.ts "cert-gate").
 *
 * Screenshots: e2e/certificates-dues-shots (git-ignored), desktop-light and
 * phone375-dark.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { APP_URL, expect, signIn, test, type Who } from "../support";
import { CLEAR, OWES } from "../certificateDuesCase";

const SHOTS = process.env.CERT_DUES_SHOTS || path.join(__dirname, "..", "certificates-dues-shots");
const SEED = path.join(__dirname, "..", "..", "..", "..", "scripts", "e2e-seed-certificate-dues.ts");
const ROLE_MSG = "Fee dues could not be checked for your role — ask the office";

type Shot = { name: string; width: number; height: number; dark: boolean };
const DESKTOP: Shot = { name: "desktop-light", width: 1440, height: 900, dark: false };
const PHONE: Shot = { name: "phone375-dark", width: 375, height: 812, dark: true };

function seed(mode: "seed" | "restore") {
  execFileSync("npx", ["--yes", "tsx", SEED, mode], {
    cwd: path.join(__dirname, "..", ".."),
    stdio: "inherit",
    env: process.env,
  });
}

test.describe.configure({ mode: "serial" });

/** GET the dues route as the office until `ok` holds (the app's mirror re-reads on its next probe, ≤ 45 s). */
async function waitForServer(studentId: string, ok: (paise: number) => boolean, what: string): Promise<void> {
  const { request } = await import("@playwright/test");
  const { mintSessionCookie } = await import("../session");
  const { demoSessionCookieName } = await import("@/lib/auth");
  const { fx } = await import("../support");
  const ctx = await request.newContext({ baseURL: APP_URL });
  const cookie = `${demoSessionCookieName()}=${mintSessionCookie(fx.sessions.office)}`;
  const deadline = Date.now() + 90_000;
  try {
    for (;;) {
      const r = await ctx.get(`/api/data/views/certificate-dues?studentId=${studentId}`, { headers: { cookie } });
      const b = (await r.json()) as { data?: { openBalancePaise: number } };
      if (b.data && ok(b.data.openBalancePaise)) return;
      if (Date.now() > deadline) throw new Error(`${what}: ${JSON.stringify(b)}`);
      await new Promise((res) => setTimeout(res, 3_000));
    }
  } finally {
    await ctx.dispose();
  }
}

test.beforeAll(() => {
  expect(OWES, "fixture has a child in a free class").toBeTruthy();
  expect(CLEAR, "fixture has a child owing nothing").toBeTruthy();
  fs.mkdirSync(SHOTS, { recursive: true });
});

async function openAs(browser: Browser, who: Who, shot: Shot): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: shot.width, height: shot.height },
    colorScheme: shot.dark ? "dark" : "light",
  });
  await signIn(context, who);
  await context.addCookies([{ name: "bhb_theme", value: shot.dark ? "dark" : "light", url: APP_URL }]);
  return context.newPage();
}

/** Pick the child and the certificate, then open step 5 · Preview & issue. */
async function toIssueStep(page: Page, child: { fullName: string; admissionNo: string }, kind: "tc" | "fee_clearance") {
  await page.goto("/certificates");
  await page.getByPlaceholder("Name, admission no, or mobile…").fill(child.fullName, { timeout: 30_000 });
  await page.getByRole("button", { name: new RegExp(child.fullName) }).first().click({ timeout: 20_000 });
  await page.getByRole("tab", { name: /Certificate type/ }).click();
  await page.locator("label", { hasText: "Certificate type" }).locator("select").selectOption(kind);
  await page.getByRole("tab", { name: /Preview & issue/ }).click();
}

const issueButton = (page: Page) => page.getByRole("button", { name: "Issue & print" });
const openDues = (page: Page) => page.getByTestId("cert-open-dues");

// ── Before the structure is seeded: CLEAR owes nothing on the server ──────
test.describe("before the structure: a child owing nothing", () => {
  test.beforeAll(async () => {
    await waitForServer(CLEAR!.id, (p) => p === 0, "precondition: CLEAR owes nothing");
  });

  for (const who of ["accountant", "office"] as const) {
    for (const kind of ["tc", "fee_clearance"] as const) {
      test(`${who}, ${kind}: ₹0 from the server, issue allowed`, async ({ browser }) => {
        const page = await openAs(browser, who, DESKTOP);
        await toIssueStep(page, CLEAR!, kind);
        await expect(openDues(page)).toContainText("₹0", { timeout: 30_000 });
        await expect(issueButton(page)).toBeEnabled();
        await page.context().close();
      });
    }
  }
  test("dues route refused (403): 'not shown for your role', refused with the role message (fails on old)", async ({ browser }) => {
    for (const shot of [DESKTOP, PHONE]) {
      const page = await openAs(browser, "accountant", shot);
      let asked = 0;
      await page.route("**/api/data/views/certificate-dues**", (route) => {
        asked += 1;
        return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Forbidden" }) });
      });
      await toIssueStep(page, CLEAR!, "fee_clearance");
      await expect(openDues(page)).toHaveText("Open dues: not shown for your role", { timeout: 30_000 });
      await expect(page.getByText(ROLE_MSG)).toBeVisible();
      await expect(issueButton(page)).toBeDisabled();
      expect(asked, "the screen asked the server").toBeGreaterThan(0);
      await openDues(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, `accountant-route-403-${shot.name}.png`), fullPage: true });
      await page.context().close();
    }
  });

  test("issue-time re-check: the fresh answer decides — dues found at issue refuse it (fails on old)", async ({ browser }) => {
    const page = await openAs(browser, "accountant", DESKTOP);
    let freshAsked = 0;
    await page.route("**/api/data/views/certificate-dues**", async (route) => {
      if (!route.request().url().includes("fresh=1")) return route.continue();
      freshAsked += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { studentId: CLEAR!.id, openBalancePaise: 50_000, openDueCount: 1 } }),
      });
    });
    await toIssueStep(page, CLEAR!, "fee_clearance");
    await expect(issueButton(page)).toBeEnabled({ timeout: 30_000 });
    await issueButton(page).click();
    await expect(page.getByText("Open dues ₹500 — clear fees before issuing no-dues").first()).toBeVisible({ timeout: 20_000 });
    expect(freshAsked).toBe(1);
    await expect(page.getByText(/^Issued /)).toHaveCount(0);
    await page.context().close();
  });
});

// ── With the tuition structure: OWES owes ₹12,000 that only the full book shows ──
test.describe("with the structure: a child owing a year's tuition", () => {
  test.beforeAll(async () => {
    seed("seed");
    await waitForServer(OWES!.id, (p) => p >= 1_200_000, "the server never saw the seeded structure");
  });
  test.afterAll(() => {
    seed("restore");
  });

  for (const kind of ["tc", "fee_clearance"] as const) {
    test(`accountant (teaching-subset book), ${kind}, child owing tuition: the server's ₹12,000 shown, issue refused (fails on old)`, async ({ browser }) => {
      for (const shot of kind === "tc" ? [DESKTOP, PHONE] : [DESKTOP]) {
        const page = await openAs(browser, "accountant", shot);
        await toIssueStep(page, OWES!, kind);
        await expect(openDues(page)).toContainText("₹12,000", { timeout: 30_000 });
        await expect(openDues(page)).toContainText("12 lines");
        await expect(page.getByText(/^Open dues ₹12,000 — /)).toBeVisible();
        await expect(issueButton(page)).toBeDisabled();
        await openDues(page).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `accountant-${kind}-owes-${shot.name}.png`), fullPage: true });
        await page.context().close();
      }
    });
  }


  test("office (full book), tc, child owing tuition: ₹12,000, refused — as before", async ({ browser }) => {
    const page = await openAs(browser, "office", DESKTOP);
    await toIssueStep(page, OWES!, "tc");
    await expect(openDues(page)).toContainText("₹12,000", { timeout: 30_000 });
    await expect(issueButton(page)).toBeDisabled();
    await page.screenshot({ path: path.join(SHOTS, `office-tc-owes-${DESKTOP.name}.png`), fullPage: true });
    await page.context().close();
  });
});
