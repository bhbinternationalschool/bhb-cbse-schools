/**
 * staff-followups — the data-layer 2.2d review's follow-ups (PR #713), each
 * on the real screen or the real route of the local stack:
 *
 *  1. me/docs (security): a member submitting their own document may give
 *     only the school's own upload path for THIS member and THIS document.
 *     An external URL (and another member's path) → 400, nothing written; on
 *     main the external URL became the member's photoUrl.
 *  2. Doc verify: the principal approves that pending photo on Staff → Doc
 *     verify → one sis.staff write, the record says verified.
 *  3. Masters → Staff setup: a department and a designation added on the
 *     panel are rows (sis.departments / sis.designations), stored.
 *  4. Allocate teaching: a refused save keeps the ticked subjects (main
 *     cleared them before the answer); a saved one clears them; ONE roster
 *     re-read per save (main read the ~136 KB roster twice).
 *  5. Import as the office (no "Bank, ID & pay details"): the rows save and
 *     the panel says "N staff saved; bank/ID/pay details for M were not
 *     changed — they need the accountant/owner" (main: "The import was not
 *     saved" over rows that were saved).
 *  6. Import as the owner: 51 new members with bank details — the details go
 *     in two requests (50 + 1; main sent 51 in one, which the route refuses),
 *     every one stored.
 *  7. A holder's profile save that needs both writes: the owner changes the
 *     father's name and the account number → POST sis.staff, then POST
 *     sis.staff/sensitive, both stored, "Staff updated".
 *
 * Writes staff records, so it runs in the staff-sensitive project (after
 * every reader) and puts each record back.
 */
import type { Browser, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { demoSessionCookieName, type DemoSession } from "@/lib/auth";
import { mintSessionCookie } from "../session";
import { staffDocDriveReceipt } from "@/lib/staffDocReceipt.server";
import { classId, staffId } from "../fixture";
import { APP_URL, expect, fx, openAs, test } from "../support";

type Row = {
  id: string;
  updated_at: string;
  emp_code?: string;
  full_name?: string;
  deleted_at?: string | null;
  profile?: Record<string, unknown>;
};

const ME = fx.sessions.teacher.staffId!; // staff 4, the class teacher
const OTHER = staffId(5);
const ALLOC = staffId(24); // a PGT with two subject links
const IMPORT_A = staffId(28);
const IMPORT_B = staffId(29);
const HOLDER_EDIT = staffId(30);

async function ownerContext(browser: Browser): Promise<BrowserContext> {
  const session: DemoSession = { ...fx.sessions.office, staffId: undefined, roleCode: "owner", fullName: "Director", email: "director@bhbinternational.school" };
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: demoSessionCookieName(), value: mintSessionCookie(session), url: APP_URL, httpOnly: true, sameSite: "Lax" }]);
  return context;
}

async function rows(ctx: { request: Page["request"] }): Promise<Row[]> {
  const res = await ctx.request.get("/api/data/sis.staff?limit=500");
  expect(res.status(), "GET sis.staff").toBe(200);
  return ((await res.json()) as { rows: Row[] }).rows;
}
const one = async (ctx: { request: Page["request"] }, id: string) => (await rows(ctx)).find((r) => r.id === id)!;

async function putProfile(ctx: { request: Page["request"] }, id: string, profile: Record<string, unknown>) {
  const now = await one(ctx, id);
  const r = await ctx.request.post("/api/data/sis.staff", { data: { ops: [{ op: "upsert", id, base: now.updated_at, row: { profile } }] } });
  expect(r.status(), `put back ${id}: ${(await r.text()).slice(0, 200)}`).toBe(200);
}

/** Desktop light and phone 375 dark, each with `focus` (what the test is about) scrolled into view. */
async function shots(page: Page, testInfo: TestInfo, label: string, focus?: Locator) {
  if (focus) await focus.first().scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
  await testInfo.attach(`${label} desktop-light`, { body: await page.screenshot(), contentType: "image/png" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(400);
  if (focus) await focus.first().scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
  await testInfo.attach(`${label} phone-375-dark`, { body: await page.screenshot(), contentType: "image/png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
}

function csv(lines: string[][]): string {
  return lines.map((l) => l.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";
}

async function importFile(page: Page, name: string, text: string) {
  await page.goto("/staff?tab=roster");
  const panel = page.locator("#staff-import");
  await expect(panel.getByText("Import staff").first()).toBeVisible({ timeout: 30_000 });
  await panel.locator("input[type=file]").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
  await expect(panel.getByText(/Will create/)).toBeVisible({ timeout: 15_000 });
  return panel;
}

test.describe("2.2d follow-ups", () => {
  let photoBefore: { photoUrl: unknown; docs: unknown } | null = null;

  test("me/docs: an external URL is refused, the member's own upload path is taken", async ({ browser }) => {
    const { context, page } = await openAs(browser, "teacher");
    try {
      const owner = await ownerContext(browser);
      const before = await one(owner, ME);
      await owner.close();
      photoBefore = { photoUrl: before.profile?.photoUrl ?? "", docs: before.profile?.docs ?? {} };
      const submit = (fileUrl: string, docKey = "photo") =>
        page.request.post("/api/v1/staff/me/docs", { data: { docKey, file: { fileUrl, fileName: "p.png", mimeType: "image/png", size: 10 } } });

      for (const bad of [
        "https://evil.example/pixel.png",
        "//evil.example/api/documents/staff/" + ME + "/photo",
        `/api/documents/staff/${OTHER}/photo`,
        `/api/documents/staff/${ME}/aadhaar`,
        `/api/documents/staff/${ME}/photo?u=https://evil.example`,
      ]) {
        const r = await submit(bad);
        expect(r.status(), `refused: ${bad}`).toBe(400);
      }
      const owner2 = await ownerContext(browser);
      const after = await one(owner2, ME);
      await owner2.close();
      expect(after.updated_at, "nothing written by a refused reference").toBe(before.updated_at);
      expect(after.profile?.photoUrl ?? "").toBe(before.profile?.photoUrl ?? "");

      const own = `/api/documents/staff/${ME}/photo`;
      const ok = await submit(own);
      expect(ok.status(), `own upload path: ${(await ok.text()).slice(0, 200)}`).toBe(200);
      const owner3 = await ownerContext(browser);
      const stored = await one(owner3, ME);
      await owner3.close();
      expect(stored.profile?.photoUrl).toBe(own);
      expect((stored.profile?.docs as Record<string, { status?: string; fileUrl?: string }>)?.photo?.status).toBe("pending");

      // A Drive id is kept only with the upload route's receipt for THIS member and THIS document.
      const withDrive = (driveFileId: string, driveReceipt?: string | null) =>
        page.request.post("/api/v1/staff/me/docs", {
          data: { docKey: "photo", file: { fileUrl: own, fileName: "p.png", mimeType: "image/png", size: 10, driveFileId, ...(driveReceipt ? { driveReceipt } : {}) } },
        });
      const owner4 = await ownerContext(browser);
      const pre = await one(owner4, ME);
      for (const [label, r] of [
        ["no receipt", await withDrive("drive_other_member_file")],
        ["another member's receipt", await withDrive("drive_other_member_file", staffDocDriveReceipt(OTHER, "photo", "drive_other_member_file"))],
        ["another document's receipt", await withDrive("drive_mine_aadhaar", staffDocDriveReceipt(ME, "aadhaar", "drive_mine_aadhaar"))],
      ] as const) {
        expect(r.status(), `refused: ${label}`).toBe(400);
      }
      expect((await one(owner4, ME)).updated_at, "nothing written by a refused Drive id").toBe(pre.updated_at);
      const mine = await withDrive("drive_my_photo", staffDocDriveReceipt(ME, "photo", "drive_my_photo"));
      expect(mine.status(), `own receipt: ${(await mine.text()).slice(0, 200)}`).toBe(200);
      const kept = (await one(owner4, ME)).profile?.docs as Record<string, Record<string, unknown>>;
      expect(kept?.photo?.driveFileId).toBe("drive_my_photo");
      expect(kept?.photo?.driveReceipt, "the receipt is never stored").toBeUndefined();
      await owner4.close();
    } finally {
      await context.close();
    }
  });

  test("Doc verify: the principal approves the pending photo on the screen — one staff write, verified", async ({ browser }, testInfo) => {
    const { context, page } = await openAs(browser, "principal");
    const name = fx.staff.staff.find((s) => s.id === ME)!.fullName;
    try {
      await page.goto("/staff?tab=doc_verify");
      const item = page.locator("li").filter({ hasText: name }).filter({ hasText: "Approve (correct)" });
      await expect(item).toHaveCount(1, { timeout: 30_000 });
      await shots(page, testInfo, "doc verify pending", item);
      const posted = page.waitForResponse((r) => r.url().endsWith("/api/data/sis.staff") && r.request().method() === "POST", { timeout: 15_000 });
      await item.getByRole("button", { name: "Approve (correct)" }).click();
      const res = await posted;
      expect(res.status(), `approve: ${(await res.text()).slice(0, 200)}`).toBe(200);
      await expect(page.getByText("Marked verified")).toBeVisible({ timeout: 15_000 });
      const stored = await one(page, ME);
      const photo = (stored.profile?.docs as Record<string, { status?: string; reviewedBy?: string }>)?.photo;
      expect(photo?.status).toBe("verified");
      expect(photo?.reviewedBy).toBeTruthy();
    } finally {
      if (photoBefore) await putProfile(page, ME, { photoUrl: photoBefore.photoUrl, docs: photoBefore.docs });
      await context.close();
    }
  });

  test("Masters → Staff setup: a department and a designation are saved as rows", async ({ browser }, testInfo) => {
    const { context, page } = await openAs(browser, "principal");
    const tag = String(Date.now()).slice(-5);
    const owner = await ownerContext(browser);
    try {
      const posts: string[] = [];
      page.on("request", (q) => {
        if (q.method() === "POST" && /\/api\/(data|school-data)\//.test(q.url())) posts.push(new URL(q.url()).pathname);
      });
      await page.goto("/masters?tab=staff");
      const card = (title: string) =>
        page.getByText(title, { exact: true }).locator("xpath=ancestor::*[.//input[@placeholder='Code']][1]");
      const dep = card("Add department");
      await dep.getByPlaceholder("Code").fill(`ZD${tag}`, { timeout: 30_000 });
      await dep.getByPlaceholder("Name").fill(`E2E dept ${tag}`);
      // A refused save keeps what was typed (main cleared the fields before the answer).
      await page.route("**/api/data/sis.departments", (route) =>
        route.request().method() === "POST"
          ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, kind: "unavailable", message: "e2e: the server is busy", conflicts: [] }) })
          : route.continue(),
      );
      const depRefused = page.waitForResponse((r) => r.url().endsWith("/api/data/sis.departments") && r.request().method() === "POST", { timeout: 15_000 });
      await dep.getByRole("button", { name: "Add" }).click();
      expect((await depRefused).status()).toBe(503);
      await page.waitForTimeout(1_000);
      await expect(dep.getByPlaceholder("Code"), "a refused save keeps the typing").toHaveValue(`ZD${tag}`);
      await expect(dep.getByPlaceholder("Name")).toHaveValue(`E2E dept ${tag}`);
      await page.unroute("**/api/data/sis.departments");
      const depSaved = page.waitForResponse((r) => r.url().endsWith("/api/data/sis.departments") && r.request().method() === "POST", { timeout: 15_000 });
      await dep.getByRole("button", { name: "Add" }).click();
      expect((await depSaved).status(), "department").toBe(200);
      await expect(dep.getByPlaceholder("Code"), "cleared once saved").toHaveValue("", { timeout: 15_000 });
      const deps = ((await (await page.request.get("/api/data/sis.departments?limit=500")).json()) as { rows: { id: string; code: string; name: string }[] }).rows;
      const madeDep = deps.find((d) => d.code === `ZD${tag}`);
      expect(madeDep?.name).toBe(`E2E dept ${tag}`);

      const des = card("Add designation");
      await des.getByPlaceholder("Code").fill(`ZG${tag}`);
      await des.getByPlaceholder("Name").fill(`E2E desig ${tag}`);
      await expect(des.locator("select option", { hasText: `E2E dept ${tag}` })).toHaveCount(1, { timeout: 15_000 });
      await des.locator("select").selectOption({ label: `E2E dept ${tag}` });
      const desSaved = page.waitForResponse((r) => r.url().endsWith("/api/data/sis.designations") && r.request().method() === "POST", { timeout: 15_000 });
      await des.getByRole("button", { name: "Add" }).click();
      expect((await desSaved).status(), "designation").toBe(200);
      const dess = ((await (await page.request.get("/api/data/sis.designations?limit=500")).json()) as { rows: { id: string; code: string; department_id: string | null }[] }).rows;
      const madeDes = dess.find((d) => d.code === `ZG${tag}`);
      expect(madeDes?.department_id, "the designation's department").toBe(madeDep?.id);
      expect(posts.filter((p) => /masters-desk|staff-roster/.test(p)), "never the whole-book or old roster save").toEqual([]);
      await expect(page.getByRole("cell", { name: `E2E desig ${tag}` })).toBeVisible({ timeout: 15_000 });
      await shots(page, testInfo, "staff setup saved", page.getByRole("cell", { name: `E2E desig ${tag}` }));
    } finally {
      // Put back: the designation, then the department (hard deletes; owner).
      const dess = ((await (await owner.request.get("/api/data/sis.designations?limit=500")).json()) as { rows: Row[] & { code?: string }[] }).rows as (Row & { code?: string })[];
      for (const d of dess.filter((x) => x.code === `ZG${tag}`)) {
        await owner.request.post("/api/data/sis.designations", { data: { ops: [{ op: "delete", id: d.id, base: d.updated_at }] } });
      }
      const deps = ((await (await owner.request.get("/api/data/sis.departments?limit=500")).json()) as { rows: (Row & { code?: string })[] }).rows;
      for (const d of deps.filter((x) => x.code === `ZD${tag}`)) {
        await owner.request.post("/api/data/sis.departments", { data: { ops: [{ op: "delete", id: d.id, base: d.updated_at }] } });
      }
      await owner.close();
      await context.close();
    }
  });

  test("Allocate teaching: a refused save keeps the ticks; a saved one clears them; one roster read per save", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const { context, page } = await openAs(browser, "principal");
    const teacher = fx.staff.staff.find((s) => s.id === ALLOC)!;
    // Start from the fixture's links (a cut-off earlier run may have left one).
    await putProfile(page, ALLOC, { subjectTeachingLinks: teacher.subjectTeachingLinks });
    const before = await one(page, ALLOC);
    const className = fx.masters.classes.find((c) => c.id === classId(1))!.name;
    try {
      await page.goto("/staff?tab=allocate");
      await page.locator("select").filter({ has: page.locator("option", { hasText: "Select a teacher…" }) }).selectOption({ label: `${teacher.fullName} (${teacher.empCode})` }, { timeout: 30_000 });
      await page.locator("label", { hasText: /^Class/ }).locator("select").first().selectOption({ label: className });
      const box = page.locator("label").filter({ has: page.locator("input[type=checkbox]") }).first();
      await box.locator("input[type=checkbox]").check();
      await expect(box.locator("input[type=checkbox]")).toBeChecked();

      // 1) The server refuses (a 503 for this one request): the tick stays.
      await page.route("**/api/data/sis.staff", (route) =>
        route.request().method() === "POST"
          ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, kind: "unavailable", message: "e2e: the server is busy", conflicts: [] }) })
          : route.continue(),
      );
      const refused = page.waitForResponse((r) => r.url().endsWith("/api/data/sis.staff") && r.request().method() === "POST", { timeout: 15_000 });
      await page.getByRole("button", { name: /^Add 1 subject/ }).click();
      expect((await refused).status()).toBe(503);
      await expect(page.getByText(/Not saved/).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1_000);
      await expect(box.locator("input[type=checkbox]"), "a refused save keeps the choice").toBeChecked();
      await page.unroute("**/api/data/sis.staff");

      // 2) Saved: the tick clears only after the answer; the roster is re-read ONCE.
      const rosterReads: number[] = [];
      page.on("request", (q) => {
        if (q.method() === "GET" && /\/api\/school-data\/staff-roster/.test(q.url())) rosterReads.push(Date.now());
      });
      const saved = page.waitForResponse((r) => r.url().endsWith("/api/data/sis.staff") && r.request().method() === "POST", { timeout: 15_000 });
      const clickedAt = Date.now();
      await page.getByRole("button", { name: /^Add 1 subject/ }).click();
      expect((await saved).status(), "the allocation").toBe(200);
      await expect(box.locator("input[type=checkbox]")).not.toBeChecked({ timeout: 15_000 });
      await expect(page.getByText(/subject assigned to/).first()).toBeVisible({ timeout: 15_000 });
      // Past one versions poll (20 s) — the poll must not cause a second read either.
      await page.waitForTimeout(25_000);
      const reads = rosterReads.filter((t) => t >= clickedAt).length;
      expect(reads, "one roster re-read per save").toBe(1);
      const after = await one(page, ALLOC);
      expect(((after.profile?.subjectTeachingLinks as unknown[]) ?? []).length).toBe(((before.profile?.subjectTeachingLinks as unknown[]) ?? []).length + 1);
      await shots(page, testInfo, "allocate saved", page.getByText("Step 3 · Subjects taught"));
    } finally {
      await page.unroute("**/api/data/sis.staff").catch(() => undefined);
      await putProfile(page, ALLOC, { subjectTeachingLinks: teacher.subjectTeachingLinks });
      await context.close();
    }
  });

  test("Import as the office: the rows save; the panel says which details need the accountant/owner", async ({ browser }, testInfo) => {
    const { context, page } = await openAs(browser, "office");
    const owner = await ownerContext(browser);
    const a0 = await one(owner, IMPORT_A);
    const b0 = await one(owner, IMPORT_B);
    try {
      const members = [IMPORT_A, IMPORT_B].map((id) => fx.staff.staff.find((s) => s.id === id)!);
      const text = csv([
        ["emp_code", "full_name", "stream", "category", "status", "religion", "bank_account"],
        ...members.map((m, i) => [m.empCode, m.fullName, m.stream, m.category, m.status, "E2E-Import-Religion", `55500000${i}`]),
      ]);
      const panel = await importFile(page, "office.csv", text);
      const posts: string[] = [];
      page.on("request", (q) => {
        if (q.method() === "POST" && /\/api\/(data|school-data)\//.test(q.url())) posts.push(new URL(q.url()).pathname);
      });
      const refused = page.waitForResponse((r) => r.url().endsWith("/api/data/sis.staff/sensitive"), { timeout: 20_000 });
      await panel.getByRole("button", { name: "Import staff" }).click();
      expect((await refused).status(), "the office has no Bank, ID & pay details").toBe(403);
      await expect(panel.getByTestId("staff-import-error")).toHaveText(
        "2 staff saved; bank/ID/pay details for 2 were not changed — they need the accountant/owner.",
        { timeout: 15_000 },
      );
      await expect(panel.getByText("The import was not saved")).toHaveCount(0);
      expect(posts, "the rows, then the details; never the old saves").toEqual(["/api/data/sis.staff", "/api/data/sis.staff/sensitive"]);
      const a1 = await one(owner, IMPORT_A);
      const b1 = await one(owner, IMPORT_B);
      expect(a1.profile?.religion).toBe("E2E-Import-Religion");
      expect(b1.profile?.religion).toBe("E2E-Import-Religion");
      expect(a1.profile?.bankAccountNo ?? "", "the bank detail unchanged").toBe(a0.profile?.bankAccountNo ?? "");
      expect(b1.profile?.bankAccountNo ?? "").toBe(b0.profile?.bankAccountNo ?? "");
      await shots(page, testInfo, "office import", panel.getByTestId("staff-import-error"));
    } finally {
      for (const [id, r0] of [[IMPORT_A, a0], [IMPORT_B, b0]] as const) {
        await putProfile(owner, id, { religion: r0.profile?.religion ?? "" });
      }
      await owner.close();
      await context.close();
    }
  });

  test("Import as the owner: 51 new members — their bank details in two requests (50 + 1), every one stored", async ({ browser }) => {
    const owner = await ownerContext(browser);
    const page = await owner.newPage();
    const tag = String(Date.now()).slice(-4);
    const code = (i: number) => `ZI${tag}-${String(i).padStart(2, "0")}`;
    try {
      const text = csv([
        ["emp_code", "full_name", "stream", "status", "bank_account"],
        ...Array.from({ length: 51 }, (_, i) => [code(i), `E2E Import ${tag} ${i}`, "non_teaching", "inactive", `7770${tag}${String(i).padStart(2, "0")}`]),
      ]);
      const panel = await importFile(page, "owner.csv", text);
      const sizes: { path: string; n: number }[] = [];
      page.on("request", (q) => {
        if (q.method() !== "POST" || !/\/api\/data\/sis\.staff/.test(q.url())) return;
        sizes.push({ path: new URL(q.url()).pathname, n: ((q.postDataJSON() as { ops?: unknown[] })?.ops ?? []).length });
      });
      await panel.getByRole("button", { name: "Import staff" }).click();
      await expect(page.getByText(/Imported 51 new/).first()).toBeVisible({ timeout: 30_000 });
      await expect(panel.getByTestId("staff-import-error")).toHaveCount(0);
      expect(sizes).toEqual([
        { path: "/api/data/sis.staff", n: 51 },
        { path: "/api/data/sis.staff/sensitive", n: 50 },
        { path: "/api/data/sis.staff/sensitive", n: 1 },
      ]);
      const made = (await rows(owner)).filter((r) => String(r.emp_code ?? "").startsWith(`ZI${tag}-`));
      expect(made.length).toBe(51);
      for (const r of made) {
        const i = Number(String(r.emp_code).slice(-2));
        expect(r.profile?.bankAccountNo, String(r.emp_code)).toBe(`7770${tag}${String(i).padStart(2, "0")}`);
      }
    } finally {
      // Put back: soft-remove the imported members (hidden everywhere).
      const made = (await rows(owner)).filter((r) => String(r.emp_code ?? "").startsWith(`ZI${tag}-`));
      for (const r of made) {
        await owner.request.post("/api/data/sis.staff", { data: { ops: [{ op: "delete", id: r.id, base: r.updated_at }] } });
      }
      await owner.close();
    }
  });

  test("a holder's save that needs both writes: the row, then the bank detail — both stored", async ({ browser }, testInfo) => {
    const owner = await ownerContext(browser);
    const page = await owner.newPage();
    const before = await one(owner, HOLDER_EDIT);
    try {
      const posts: string[] = [];
      page.on("request", (q) => {
        if (q.method() === "POST" && /\/api\/(data|school-data)\//.test(q.url())) posts.push(new URL(q.url()).pathname);
      });
      await page.goto(`/staff/${HOLDER_EDIT}/edit`);
      const father = page.locator("label", { hasText: "Father's name" }).locator("input");
      await father.fill("E2E Father", { timeout: 30_000 });
      await page.locator('[aria-label="Staff profile sections"]').getByText("Bank", { exact: true }).first().click();
      await page.locator("label", { hasText: "Account number" }).locator("input").fill("888800003000");
      const sens = page.waitForResponse((r) => r.url().endsWith("/api/data/sis.staff/sensitive"), { timeout: 20_000 });
      await page.getByRole("button", { name: "Save profile" }).first().click();
      expect((await sens).status(), "the bank detail").toBe(200);
      await expect(page.getByTestId("staff-save-notice")).toHaveText("Staff updated", { timeout: 15_000 });
      expect(posts, "the row write, then the sensitive write").toEqual(["/api/data/sis.staff", "/api/data/sis.staff/sensitive"]);
      const after = await one(owner, HOLDER_EDIT);
      expect(after.profile?.fatherName).toBe("E2E Father");
      expect(after.profile?.bankAccountNo).toBe("888800003000");
      await shots(page, testInfo, "holder saved", page.getByLabel("Account number").or(page.locator("label", { hasText: "Account number" })));
    } finally {
      await putProfile(owner, HOLDER_EDIT, { fatherName: before.profile?.fatherName ?? "" });
      const now = await one(owner, HOLDER_EDIT);
      await owner.request.post("/api/data/sis.staff/sensitive", {
        data: { ops: [{ id: HOLDER_EDIT, base: now.updated_at, fields: { bankAccountNo: before.profile?.bankAccountNo ?? "" } }] },
      });
      await owner.close();
    }
  });

  test("Removed staff says who removed them by name", async ({ browser }, testInfo) => {
    const { context, page } = await openAs(browser, "principal");
    const left = staffId(35); // inactive, no links: removable
    const name = fx.staff.staff.find((s) => s.id === left)!.fullName;
    const principal = fx.staff.staff.find((s) => s.id === fx.sessions.principal.staffId)!.fullName;
    try {
      const now = await one(page, left);
      const del = await page.request.post("/api/data/sis.staff", { data: { ops: [{ op: "delete", id: left, base: now.updated_at }] } });
      expect(del.status(), `remove: ${(await del.text()).slice(0, 200)}`).toBe(200);
      await page.goto("/staff?tab=roster");
      await page.getByRole("button", { name: "Show removed staff" }).click({ timeout: 30_000 });
      const entry = page.getByTestId("removed-staff").locator("li").filter({ hasText: name });
      await expect(entry).toContainText(`by ${principal}`, { timeout: 15_000 });
      await expect(entry).not.toContainText(String(fx.sessions.principal.staffId));
      await shots(page, testInfo, "removed staff by name", entry);
      await entry.getByRole("button", { name: /^Restore/ }).click();
      await expect(page.getByText(`${name} (E2E-035) restored`)).toBeVisible({ timeout: 15_000 });
    } finally {
      const r = (await (await page.request.get("/api/data/sis.staff?removed=1&limit=500")).json()) as { rows: Row[] };
      const gone = r.rows.find((x) => x.id === left);
      if (gone) await page.request.post("/api/data/sis.staff", { data: { ops: [{ op: "upsert", id: left, base: gone.updated_at, row: { deleted_at: null } }] } });
      await context.close();
    }
  });
});
