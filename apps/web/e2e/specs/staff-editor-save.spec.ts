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
 * Principal (staff.edit) opens one, changes the father's name, presses Save:
 * the roster POST must go out and succeed, and the server's record must carry
 * the new value (and the defaulted username). Writes, so it runs in the
 * writing project after every read-only spec (playwright.config.ts).
 *
 * (Data-layer 2.2b, director 21 Oct 2026: a SET registered mobile is a
 * sign-in link and is changed only by the owner — so this spec edits a plain
 * field; the mobile rule has its own checks in e2e/staff-kernel.acceptance.ts.)
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

  const next = `E2E Father ${String(Date.now()).slice(-6)}`;
  await page.goto(`/staff/${EDITED}/edit`);
  const mobile = page.locator("label", { hasText: "Mobile *" }).locator("input");
  await expect(mobile).toHaveValue(row.mobile, { timeout: 30_000 });
  const father = page.locator("label", { hasText: "Father's name" }).locator("input");
  await father.fill(next);

  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/data/sis.staff") && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Save profile" }).first().click();
  await expect(page.getByText("Fix the highlighted fields before saving"), "Save refused the profile").toHaveCount(0);
  const res = await posted;
  expect(res.status(), "POST sis.staff").toBe(200);
  expect(((await res.json()) as { ok?: boolean }).ok, "POST sis.staff ok").toBe(true);
  await expect(page.getByTestId("staff-save-notice")).toHaveText("Staff updated", { timeout: 15_000 });

  const after = (await (await context.request.get("/api/school-data/staff-roster")).json()) as Roster;
  const saved = after.staff.find((s) => s.id === EDITED);
  expect(saved?.fatherName, "server father's name").toBe(next);
  expect(saved?.mobile, "the mobile unchanged").toBe(row.mobile);
  expect(saved?.loginUsername, "server username defaulted from the emp code").toBe(row.empCode.toLowerCase());
  await context.close();
});
