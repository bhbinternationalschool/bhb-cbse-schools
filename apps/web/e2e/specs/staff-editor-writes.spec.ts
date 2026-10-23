/**
 * staff-editor-writes — data-layer 2.2d: the staff editor writes rows.
 *
 *  1. The office (Staff · edit, Masters VIEW only — the fixture's office)
 *     changes a peon's designation and fills his blank (0000000000) mobile on
 *     the real profile form: ONE POST /api/data/sis.staff, "Staff updated"
 *     only after it answered 200, the database holds both. On main the form's
 *     save went through saveMasters, which a user without Masters · edit never
 *     sends (no request at all) while the form said "Staff updated".
 *  2. A refused save shows the refusal, never "updated": the office changes a
 *     member's SET mobile (the owner's, director 21 Oct) → 403, the form shows
 *     the server's reason, the notice never says "Staff updated", nothing
 *     written.
 *  3. Remove → reload → gone, and restorable: the principal removes the
 *     inactive member from the roster; after a reload the roster does not list
 *     them (the server's roster neither), the row is SOFT-removed (who, when);
 *     "Removed staff" lists them and Restore brings them back. On main Remove
 *     only changed the tab's copy (nothing on the server): back after reload.
 *  4. Staff 0: with the staff roster's answer held back, the principal saves
 *     a fee head (the old whole-book Masters save, still 2.2e's) → no staff
 *     write of any kind and sis_staff unchanged (count and every revision).
 *
 * Writes staff records, so it runs in the staff-sensitive project after every
 * reader, and puts each record back.
 */
import type { Browser, Page, Request, TestInfo } from "@playwright/test";
import { demoSessionCookieName, type DemoSession } from "@/lib/auth";
import { mintSessionCookie } from "../session";
import { staffId } from "../fixture";
import { APP_URL, expect, fx, openAs, test } from "../support";

const PEON = staffId(33); // placeholder mobile, Peon, no powerful access
const SET_MOBILE = staffId(25); // a teacher with a set mobile
const LEFT = staffId(35); // inactive, no links: removable
const FILLED = "9311000033";

type Row = { id: string; updated_at: string; deleted_at?: string | null; deleted_by?: string | null; mobile?: string; designation_id?: string | null; full_name?: string; profile?: Record<string, unknown> };

async function ownerContext(browser: Browser) {
  const session: DemoSession = { ...fx.sessions.office, staffId: undefined, roleCode: "owner", fullName: "Director", email: "director@bhbinternational.school" };
  const context = await browser.newContext({ baseURL: APP_URL });
  await context.addCookies([{ name: demoSessionCookieName(), value: mintSessionCookie(session), url: APP_URL, httpOnly: true, sameSite: "Lax" }]);
  return context;
}

async function rows(page: Page): Promise<Row[]> {
  const res = await page.request.get("/api/data/sis.staff?limit=500");
  expect(res.status(), "GET sis.staff").toBe(200);
  return ((await res.json()) as { rows: Row[] }).rows;
}

function staffWrites(page: Page): string[] {
  const out: string[] = [];
  page.on("request", (q: Request) => {
    if (q.method() !== "POST") return;
    if (/\/api\/(data\/sis\.|school-data\/(staff-roster|masters-desk))/.test(q.url())) out.push(new URL(q.url()).pathname);
  });
  return out;
}

async function shots(page: Page, testInfo: TestInfo, label: string) {
  await testInfo.attach(`${label} desktop-light`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  await testInfo.attach(`${label} phone-375-dark`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
}

test.describe.serial("the staff editor writes rows (data-layer 2.2d)", () => {
  test("office without Masters edit: designation + a blank mobile save, said only after the server", async ({ browser }, testInfo) => {
    const { context, page } = await openAs(browser, "office");
    const before = (await rows(page)).find((r) => r.id === PEON)!;
    expect(before.mobile, "fixture: placeholder mobile").toBe("0000000000");
    try {
      const writes = staffWrites(page);
      await page.goto(`/staff/${PEON}/edit`);
      const mobile = page.locator("label", { hasText: "Mobile *" }).locator("input");
      await expect(mobile).toHaveValue("0000000000", { timeout: 30_000 });
      await mobile.fill(FILLED);
      await page.locator('[aria-label="Staff profile sections"]').getByText("Employment", { exact: true }).first().click();
      await page.locator("label", { hasText: "Designation" }).locator("select").first().selectOption({ label: "Driver" });
      const posted = page.waitForResponse((r) => r.url().endsWith("/api/data/sis.staff") && r.request().method() === "POST", { timeout: 15_000 });
      await page.getByRole("button", { name: "Save profile" }).first().click();
      const res = await posted;
      expect(res.status(), `POST sis.staff: ${(await res.text()).slice(0, 300)}`).toBe(200);
      await expect(page.getByTestId("staff-save-notice")).toHaveText("Staff updated", { timeout: 15_000 });
      await expect(page.getByTestId("staff-save-error")).toHaveCount(0);
      expect(writes, "one kernel write; never masters-desk or staff-roster").toEqual(["/api/data/sis.staff"]);
      const after = (await rows(page)).find((r) => r.id === PEON)!;
      expect(after.mobile).toBe(FILLED);
      expect(after.designation_id).toBe("e2e_des_driver");
      expect(after.profile?.mobile).toBe(FILLED);
      await shots(page, testInfo, "office saved");
    } finally {
      // Put back: the designation (office) and the placeholder (a set number is the owner's).
      const owner = await ownerContext(browser);
      const now = (await rows(page)).find((r) => r.id === PEON)!;
      await owner.request.post("/api/data/sis.staff", {
        data: { ops: [{ op: "upsert", id: PEON, base: now.updated_at, row: { designation_id: "e2e_des_peon", profile: { designationId: "e2e_des_peon" } } }] },
      });
      const now2 = (await rows(page)).find((r) => r.id === PEON)!;
      const back = await owner.request.post("/api/data/sis.staff/sensitive", { data: { ops: [{ id: PEON, base: now2.updated_at, fields: { mobile: "0000000000" } }] } });
      expect(back.status(), `put back the mobile: ${(await back.text()).slice(0, 200)}`).toBe(200);
      await owner.close();
      await context.close();
    }
  });

  test("a refused save shows the server's reason, never 'Staff updated'", async ({ browser }, testInfo) => {
    const { context, page } = await openAs(browser, "office");
    try {
      const before = (await rows(page)).find((r) => r.id === SET_MOBILE)!;
      const notices: string[] = [];
      page.on("console", () => undefined);
      await page.goto(`/staff/${SET_MOBILE}/edit`);
      const mobile = page.locator("label", { hasText: "Mobile *" }).locator("input");
      await expect(mobile).toHaveValue(String(before.mobile), { timeout: 30_000 });
      await mobile.fill("9311000025");
      const posted = page.waitForResponse((r) => r.url().endsWith("/api/data/sis.staff") && r.request().method() === "POST", { timeout: 15_000 });
      await page.getByRole("button", { name: "Save profile" }).first().click();
      const res = await posted;
      expect(res.status(), "the office may not change a set mobile").toBe(403);
      const error = page.getByTestId("staff-save-error");
      await expect(error).toContainText("Not saved", { timeout: 15_000 });
      await expect(error).toContainText(/mobile/i);
      // Watch the notice for a while: it must never claim the save.
      for (let i = 0; i < 6; i++) {
        notices.push((await page.getByTestId("staff-save-notice").allTextContents()).join("|"));
        await page.waitForTimeout(250);
      }
      expect(notices.join(" "), "never 'Staff updated'").not.toContain("Staff updated");
      const after = (await rows(page)).find((r) => r.id === SET_MOBILE)!;
      expect(after.updated_at, "nothing written").toBe(before.updated_at);
      expect(after.mobile).toBe(before.mobile);
      await expect(mobile, "what was typed stays on screen").toHaveValue("9311000025");
      await shots(page, testInfo, "refused");
    } finally {
      await context.close();
    }
  });

  test("Remove → reload → gone (soft, who and when); Removed staff → Restore brings them back", async ({ browser }, testInfo) => {
    const { context, page } = await openAs(browser, "principal");
    try {
      const name = fx.staff.staff.find((s) => s.id === LEFT)!.fullName;
      page.on("dialog", (d) => void d.accept());
      await page.goto("/staff?tab=roster&status=inactive");
      const row = page.getByRole("row").filter({ hasText: name });
      await expect(row).toHaveCount(1, { timeout: 30_000 });
      const posted = page.waitForResponse((r) => r.url().endsWith("/api/data/sis.staff") && r.request().method() === "POST", { timeout: 15_000 });
      await row.getByRole("button", { name: "Remove", exact: true }).click();
      expect((await posted).status(), "the removal").toBe(200);
      await expect(page.getByText(/removed — restore it/)).toBeVisible({ timeout: 15_000 });

      await page.reload();
      await expect(page.getByRole("row").filter({ hasText: "E2E-034" }).or(page.getByText("No staff match these filters."))).not.toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByRole("row").filter({ hasText: name }), "gone after a reload").toHaveCount(0);
      const roster = (await (await page.request.get("/api/school-data/staff-roster")).json()) as { staff: { id: string }[] };
      expect(roster.staff.some((s) => s.id === LEFT), "not on the server's roster").toBe(false);
      const removed = (await (await page.request.get("/api/data/sis.staff?removed=1&limit=500")).json()) as { rows: Row[] };
      const gone = removed.rows.find((r) => r.id === LEFT);
      expect(gone?.deleted_at, "soft: the row is kept, marked removed").toBeTruthy();
      expect(gone?.deleted_by, "who removed it: the session").toBe(fx.sessions.principal.staffId);

      await page.getByRole("button", { name: "Show removed staff" }).click();
      const restoreBtn = page.getByRole("button", { name: new RegExp(`^Restore ${name}`) });
      await expect(restoreBtn).toBeVisible({ timeout: 15_000 });
      await shots(page, testInfo, "removed staff");
      await restoreBtn.click();
      await expect(page.getByText(`${name} (E2E-035) restored`)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(1, { timeout: 15_000 });
      const back = (await (await page.request.get("/api/school-data/staff-roster")).json()) as { staff: { id: string }[] };
      expect(back.staff.some((s) => s.id === LEFT), "restored on the server").toBe(true);
    } finally {
      await context.close();
    }
  });

  test("staff 0: a fee head saved while the roster's answer is held back writes no staff", async ({ browser }) => {
    const { context, page } = await openAs(browser, "principal");
    const before = await rows(page);
    const code = `Z${String(Date.now()).slice(-5)}`;
    try {
      const writes = staffWrites(page);
      // The roster's answer never comes (the 12 Oct "staff 0" shape).
      await page.route("**/api/school-data/staff-roster", () => undefined);
      await page.goto("/masters?tab=fee-heads");
      await page.locator("label", { hasText: "Code" }).locator("input").first().fill(code, { timeout: 30_000 });
      await page.locator("label", { hasText: "Name" }).locator("input").first().fill(`E2E staff-zero ${code}`);
      const saved = page.waitForResponse((r) => /\/api\/school-data\/masters-desk$/.test(r.url()) && r.request().method() === "POST", { timeout: 20_000 });
      await page.locator("form").filter({ has: page.locator("input[placeholder='SPORTS']") }).locator("button[type=submit]").first().click();
      expect((await saved).status(), "the fee head saved").toBe(200);
      await page.waitForTimeout(3_000);
      expect(writes.filter((w) => !/masters-desk/.test(w)), "no staff write of any kind").toEqual([]);
      const after = await rows(page);
      expect(after.length, "sis_staff count unchanged").toBe(before.length);
      const rev = (rs: Row[]) => Object.fromEntries(rs.map((r) => [r.id, r.updated_at]));
      expect(rev(after), "every staff revision unchanged").toEqual(rev(before));
    } finally {
      await page.unroute("**/api/school-data/staff-roster");
      // Put back: drop the fee head.
      const d = (await (await page.request.get("/api/school-data/masters-desk")).json()) as { feeHeads: { code: string }[]; sliceStamps?: Record<string, string> };
      if (d.feeHeads.some((f) => f.code === code)) {
        await page.request.post("/api/school-data/masters-desk", {
          data: { version: 2, feeHeads: d.feeHeads.filter((f) => f.code !== code), sliceBases: { feeHeads: d.sliceStamps?.feeHeads ?? "" } },
        });
      }
      await context.close();
    }
  });
});
