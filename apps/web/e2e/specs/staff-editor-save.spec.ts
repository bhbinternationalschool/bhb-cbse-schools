/**
 * staff-editor-save — the old staff editor's Save reaches the server
 * (21 Oct 2026, hotfix/staff-editor-save).
 *
 * Production: office edits to staff (phone, designation, …) "did not stick".
 * 29 of 35 staff have "Portal / app login enabled" (the default) and no
 * username; validateStaffProfile refused them with "Username required when
 * login is enabled" — though Save fills the username from the employee code
 * and the field says "Defaults to emp code" — so StaffProfileForm returned
 * before saveMasters and no POST /api/school-data/staff-roster was ever sent.
 *
 * The fixture's staff are the same shape (login on, no username). The
 * Principal (staff.edit) opens one, changes the mobile, presses Save: the
 * roster POST must go out and succeed, and the server's record must carry
 * the new mobile (and the defaulted username). Writes, so it runs in the
 * writing project after every read-only spec (playwright.config.ts).
 */
import type { StaffRecord } from "@/lib/foundationMasters";
import { staffId } from "../fixture";
import { expect, openAs, test } from "../support";

const EDITED = staffId(22);

type Roster = { ok: boolean; staff: StaffRecord[] };

test("staff editor: Save sends the change and the server record changes", async ({ browser }) => {
  const { context, page } = await openAs(browser, "principal");
  const before = (await (await context.request.get("/api/school-data/staff-roster")).json()) as Roster;
  const row = before.staff.find((s) => s.id === EDITED);
  if (!row) throw new Error(`${EDITED} not in the roster`);
  // The production shape the defect needs: login on, no username typed.
  expect(row.loginEnabled, "fixture: login enabled").toBe(true);
  expect(row.loginUsername, "fixture: no username").toBe("");

  const next = `98${String(Date.now()).slice(-8)}`;
  await page.goto(`/staff/${EDITED}/edit`);
  const mobile = page.locator("label", { hasText: "Mobile *" }).locator("input");
  await expect(mobile).toHaveValue(row.mobile, { timeout: 30_000 });
  await mobile.fill(next);

  const posted = page.waitForResponse(
    (r) => r.url().includes("/api/school-data/staff-roster") && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Save profile" }).first().click();
  await expect(page.getByText("Fix the highlighted fields before saving"), "Save refused the profile").toHaveCount(0);
  const res = await posted;
  expect(res.status(), "POST staff-roster").toBe(200);
  expect(((await res.json()) as { ok?: boolean }).ok, "POST staff-roster ok").toBe(true);

  const after = (await (await context.request.get("/api/school-data/staff-roster")).json()) as Roster;
  const saved = after.staff.find((s) => s.id === EDITED);
  expect(saved?.mobile, "server mobile").toBe(next);
  expect(saved?.loginUsername, "server username defaulted from the emp code").toBe(row.empCode.toLowerCase());
  await context.close();
});
