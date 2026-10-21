/**
 * staff-locked-validation — a malformed STORED PAN must not refuse the
 * office's Save (21 Oct 2026, fix/staff-locked-field-validation).
 *
 * After 2.2b (PR #702) the office (staff · edit, no "Bank, ID & pay details"
 * function) sees Aadhaar, PAN and bank inputs locked, but Save still checked
 * their format: a legacy malformed PAN refused "Fix the highlighted fields"
 * and sent the office to the IDs tab, where nothing can be changed.
 *
 *  - Seed: staff 23's PAN set to a malformed value through the app's own
 *    sensitive write path (POST /api/data/sis.staff/sensitive, as staff 26
 *    given the built-in Accounts role for the run); put back afterwards.
 *  - The office edits the father's name: Save goes out and the server keeps
 *    the new name (and the stored PAN untouched).
 *  - The Principal, given the Accounts role too (staff · edit + the function,
 *    so the full form with the inputs open), types a malformed PAN: still
 *    refused with the PAN error, and nothing is posted.
 * Writes, so it runs in the staff-sensitive project after every read-only spec.
 */
import { pushDeskSliceToDb } from "@/lib/deskSliceNormalized.server";
import type { DemoSession } from "@/lib/auth";
import type { StaffRecord } from "@/lib/foundationMasters";
import { demoSessionCookieName } from "@/lib/auth";
import type { Browser, TestInfo } from "@playwright/test";
import { mintSessionCookie } from "../session";
import { staffId } from "../fixture";
import { APP_URL, expect, fx, openAs, test } from "../support";

const TARGET = staffId(23);
const ACC = staffId(26);
const PRINCIPAL = fx.sessions.principal.staffId!;
const ASSIGN_ACC = "e2e_lockval_acc";
const ASSIGN_PRIN = "e2e_lockval_prin";
const BAD_PAN = "BADPAN";

type Roster = { ok: boolean; staff: StaffRecord[] };

async function accountsRoles(on: boolean) {
  const accRole = (fx.rbac.roles as { id: string; code: string }[]).find((r) => r.code === "accounts")!;
  const extra = (id: string, staff: string, isPrimary: boolean) => ({
    id,
    staffId: staff,
    roleId: accRole.id,
    isPrimary,
    scope: { campusIds: [], classIds: [], departmentIds: [] },
    expiresOn: "",
    note: "spec",
  });
  const assignments = on
    ? [...fx.rbac.assignments, extra(ASSIGN_ACC, ACC, true), extra(ASSIGN_PRIN, PRINCIPAL, false)]
    : fx.rbac.assignments;
  const r = (await pushDeskSliceToDb(
    "rbac",
    { ...fx.rbac, assignments } as never,
    on ? undefined : { deletes: { assignments: [ASSIGN_ACC, ASSIGN_PRIN] } },
  )) as { ok?: boolean };
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
  return context;
}

/** Sets TARGET's PAN through the accountant's sensitive route. */
async function setPan(browser: Browser, pan: string) {
  const ctx = await openAsAccountant(browser);
  try {
    const rows = (await (await ctx.request.get("/api/data/sis.staff?limit=500")).json()) as {
      rows: { id: string; updated_at: string }[];
    };
    const row = rows.rows.find((r) => r.id === TARGET)!;
    const res = await ctx.request.post("/api/data/sis.staff/sensitive", {
      data: { ops: [{ id: TARGET, base: row.updated_at, fields: { panNo: pan } }] },
    });
    expect(res.status(), `set PAN ${pan}`).toBe(200);
  } finally {
    await ctx.close();
  }
}

async function shots(page: import("@playwright/test").Page, testInfo: TestInfo, label: string) {
  await testInfo.attach(`${label} desktop-light`, { body: await page.screenshot(), contentType: "image/png" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });
  await testInfo.attach(`${label} phone-375-dark`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

let originalPan = "";

test.describe.serial("locked sensitive fields are not validated for who cannot edit them", () => {
  test.beforeAll(async ({ browser }) => {
    await accountsRoles(true);
    const office = await openAs(browser, "office");
    const roster = (await (await office.context.request.get("/api/school-data/staff-roster")).json()) as Roster;
    originalPan = roster.staff.find((s) => s.id === TARGET)?.panNo ?? "";
    await office.context.close();
    await setPan(browser, BAD_PAN);
  });

  test.afterAll(async ({ browser }) => {
    try {
      await setPan(browser, originalPan);
    } finally {
      await accountsRoles(false);
    }
  });

  test("the office saves a profile whose stored PAN is malformed", async ({ browser }, testInfo) => {
    const { context, page } = await openAs(browser, "office");
    try {
      const next = `E2E Father ${String(Date.now()).slice(-6)}`;
      await page.goto(`/staff/${TARGET}/edit`);
      const father = page.locator("label", { hasText: "Father's name" }).locator("input");
      await expect(father).toBeEnabled({ timeout: 30_000 });
      await father.fill(next);
      const posted = page.waitForResponse(
        (r) => r.url().includes("/api/school-data/staff-roster") && r.request().method() === "POST",
        { timeout: 15_000 },
      );
      await page.getByRole("button", { name: "Save profile" }).first().click();
      await expect(page.getByText("Fix the highlighted fields before saving"), "Save refused the profile").toHaveCount(0);
      const res = await posted;
      expect(res.status(), "POST staff-roster").toBe(200);

      const after = (await (await context.request.get("/api/school-data/staff-roster")).json()) as Roster;
      const saved = after.staff.find((s) => s.id === TARGET);
      expect(saved?.fatherName, "server father's name").toBe(next);
      expect(saved?.panNo, "the stored PAN untouched").toBe(BAD_PAN);
      await page.locator('[aria-label="Staff profile sections"]').getByText("IDs", { exact: true }).first().click();
      await expect(page.locator("label", { hasText: "PAN" }).first().locator("input")).toBeDisabled();
      await shots(page, testInfo, "office ids tab after save");
    } finally {
      await context.close();
    }
  });

  test("a holder of the function typing a malformed PAN is still refused", async ({ browser }, testInfo) => {
    const { context, page } = await openAs(browser, "principal");
    try {
      let posts = 0;
      page.on("request", (r) => {
        if (r.url().includes("/api/school-data/staff-roster") && r.method() === "POST") posts += 1;
      });
      await page.goto(`/staff/${TARGET}/edit`);
      await page.locator('[aria-label="Staff profile sections"]').getByText("IDs", { exact: true }).first().click({ timeout: 30_000 });
      const pan = page.locator("label", { hasText: "PAN" }).first().locator("input");
      await expect(pan).toBeEnabled({ timeout: 30_000 });
      await pan.fill("ABC12");
      await page.getByRole("button", { name: "Save profile" }).first().click();
      await expect(page.getByText("Fix the highlighted fields before saving").first()).toBeVisible();
      await expect(page.getByText("PAN format: AAAAA9999A")).toBeVisible();
      await page.waitForTimeout(1_000);
      expect(posts, "nothing posted").toBe(0);
      await shots(page, testInfo, "function holder pan refused");
    } finally {
      await context.close();
    }
  });
});
