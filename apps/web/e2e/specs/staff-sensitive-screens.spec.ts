/**
 * staff-sensitive-screens — data-layer 2.2b (director, 21 Oct 2026), seen on
 * the real screens: bank, UPI, Aadhaar, PAN and pay are the owner's and the
 * accountant's.
 *
 *  - The office (staff · edit, no "Bank, ID & pay details" function) opens a
 *    staff profile: the Bank tab says who enters these details and its inputs
 *    are locked — nothing typed there can be silently dropped by a save.
 *  - The accountant (staff 26 given the built-in Accounts role, which carries
 *    the function — through the rbac desk's own write path, removed again
 *    afterwards) opens the same profile: a panel with ONLY those fields; a
 *    changed account number saves through POST /api/data/sis.staff/sensitive
 *    and reads back; the record is put back as found.
 * Screenshots: desktop light and phone 375 dark of both.
 */
import { pushDeskSliceToDb } from "@/lib/deskSliceNormalized.server";
import type { DemoSession } from "@/lib/auth";
import type { Browser, TestInfo } from "@playwright/test";
import { demoSessionCookieName } from "@/lib/auth";
import { mintSessionCookie } from "../session";
import { APP_URL, expect, fx, openAs, test } from "../support";

const TARGET = "e2e_stf_25";
const ACC = "e2e_stf_26";
const ASSIGN = "e2e_22b_spec_acc";

async function accountantRbac(on: boolean) {
  const accRole = (fx.rbac.roles as { id: string; code: string }[]).find((r) => r.code === "accounts")!;
  const assignments = on
    ? [...fx.rbac.assignments, { id: ASSIGN, staffId: ACC, roleId: accRole.id, isPrimary: true, scope: { campusIds: [], classIds: [], departmentIds: [] }, expiresOn: "", note: "spec" }]
    : fx.rbac.assignments;
  const r = (await pushDeskSliceToDb("rbac", { ...fx.rbac, assignments } as never, on ? undefined : { deletes: { assignments: [ASSIGN] } })) as {
    ok?: boolean;
  };
  if (!r.ok) throw new Error("rbac push failed");
  await new Promise((res) => setTimeout(res, 2_600));
}

async function openAsAccountant(browser: Browser) {
  const session: DemoSession = {
    ...fx.sessions.office,
    staffId: ACC,
    fullName: fx.staff.staff.find((s) => s.id === ACC)!.fullName,
    roleCode: "accounts",
  };
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    { name: demoSessionCookieName(), value: mintSessionCookie(session), url: APP_URL, httpOnly: true, sameSite: "Lax" },
  ]);
  return { context, page: await context.newPage() };
}

async function shots(page: import("@playwright/test").Page, testInfo: TestInfo, label: string) {
  await testInfo.attach(`${label} desktop-light`, { body: await page.screenshot(), contentType: "image/png" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });
  await testInfo.attach(`${label} phone-375-dark`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("the office sees the bank details locked, with who enters them", async ({ browser }, testInfo) => {
  const office = await openAs(browser, "office");
  try {
    await office.page.goto(`/staff/${TARGET}/edit`);
    const tabs = office.page.locator('[aria-label="Staff profile sections"]');
    await tabs.getByText("Bank", { exact: true }).first().click({ timeout: 30_000 });
    await expect(office.page.getByTestId("sensitive-locked")).toContainText("entered by the accountant or the owner");
    await expect(office.page.getByLabel("Account number")).toBeDisabled();
    await expect(office.page.getByLabel("UPI ID")).toBeDisabled();
    await shots(office.page, testInfo, "office bank tab");
  } finally {
    await office.context.close();
  }
});

test("the accountant edits only bank, ID & pay details, through the sensitive route", async ({ browser }, testInfo) => {
  await accountantRbac(true);
  const acc = await openAsAccountant(browser);
  let before: Record<string, unknown> | null = null;
  try {
    const page = acc.page;
    await page.goto(`/staff/${TARGET}/edit`);
    const panel = page.getByTestId("staff-sensitive-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    // Only these fields: no name, no mobile, no tabs of the full profile.
    await expect(page.locator('[aria-label="Staff profile sections"]')).toHaveCount(0);
    const acct = panel.getByLabel("Account number");
    before = { bankAccountNo: await acct.inputValue() };
    const next = `E2E${Date.now().toString().slice(-9)}`;
    const posted = page.waitForResponse((r) => r.url().includes("/api/data/sis.staff/sensitive") && r.request().method() === "POST");
    await acct.fill(next);
    await panel.getByRole("button", { name: "Save bank, ID & pay details" }).click();
    expect((await posted).status()).toBe(200);
    await expect(page.getByTestId("sensitive-save-message")).toContainText("Saved: bankAccountNo");
    await expect(acct).toHaveValue(next);
    await shots(page, testInfo, "accountant panel");
  } finally {
    // Put the number back the same way.
    if (before) {
      const rows = (await (await acc.page.request.get("/api/data/sis.staff?limit=500")).json()) as { rows: { id: string; updated_at: string }[] };
      const row = rows.rows.find((r) => r.id === TARGET)!;
      await acc.page.request.post("/api/data/sis.staff/sensitive", {
        data: { ops: [{ id: TARGET, base: row.updated_at, fields: { bankAccountNo: before.bankAccountNo ?? "" } }] },
      });
    }
    await acc.context.close();
    await accountantRbac(false);
  }
});
