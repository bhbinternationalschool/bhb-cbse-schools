/**
 * masters-push-gone — data-layer 2.2f: the screens that used to save (or
 * re-save) the whole Masters book through the old push still save, and none
 * of them sends POST /api/school-data/masters-desk (which answers 410 now).
 * Each is SEEN on the local stack, desktop-light and phone375-dark.
 *
 *   Masters      Classes & sections → Sections → rename V-A (an element write),
 *                then back.
 *   Staff        Masters → Leave setup → Attendance rules → "+ New rule" →
 *   attendance   "Create rule" (the rules store; before 2.2f opening this panel
 *   rules        could copy a legacy timing into Masters and push the book), then
 *                the rule removed.
 *   SIS          the roster and a student's profile open (before 2.2f a SIS
 *                read could save the whole Masters book: ensureStudentClassLinks,
 *                the fee-discount seed import). The form's own Save is the SIS
 *                whole-roster push, refused on this fixture before and after
 *                2.2f (Phase 3), so it is not exercised here.
 *   Fee Take     the counter opens on a child and reads its dues (the seed
 *                import and a mirror push of Masters ran on every Fee Take open
 *                before 2.2f). The counter's own saves (collect, discount,
 *                void) are fee-writes.spec.
 *
 * Writes to the stack, so it runs in the "propagation" project, and puts
 * everything back.
 */
import type { Browser, Page, Request } from "@playwright/test";
import { APP_URL, collectPageErrors, expect, fx, signIn, test } from "../support";

const SHOTS = [
  { name: "desktop-light", width: 1440, height: 900, dark: false },
  { name: "phone375-dark", width: 375, height: 812, dark: true },
] as const;
type Shot = (typeof SHOTS)[number];

const CLASS_V = "e2e_cls_08";

async function open(browser: Browser, shot: Shot): Promise<{ page: Page; masterPosts: string[]; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: shot.width, height: shot.height },
    colorScheme: shot.dark ? "dark" : "light",
  });
  await signIn(context, "principal");
  await context.addCookies([{ name: "bhb_theme", value: shot.dark ? "dark" : "light", url: APP_URL }]);
  const page = await context.newPage();
  const masterPosts: string[] = [];
  page.on("request", (q: Request) => {
    if (q.method() === "POST" && q.url().includes("/api/school-data/masters-desk")) masterPosts.push(q.url());
  });
  return { page, masterPosts, close: () => context.close() };
}

const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: false });

test.describe.configure({ mode: "serial" });

for (const s of SHOTS) {
  test(`${s.name}: Masters section rename saves as an element, never the book`, async ({ browser }) => {
    const { page, masterPosts, close } = await open(browser, s);
    const errors = collectPageErrors(page);
    const sectionsOfV = async () =>
      ((await (await page.request.get("/api/data/masters.sections?limit=1000")).json()) as { rows: { id: string; classId: string; name: string; _rev?: number }[] }).rows.filter(
        (x) => x.classId === CLASS_V,
      );
    const [sec] = await sectionsOfV();
    expect(sec, "class V has a section").toBeTruthy();
    const original = sec.name;
    const renamed = `Q${Date.now().toString(36).slice(-3).toUpperCase()}`;
    try {
      await page.goto("/masters?tab=classes");
      await page.getByRole("button", { name: "V 1 section", exact: true }).click({ timeout: 30_000 });
      await page.getByRole("tab", { name: "2 · Sections" }).click();
      const row = page.getByRole("listitem").filter({ hasText: new RegExp(`^V-${original}`) });
      await row.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("textbox", { name: "Rename section" }).fill(renamed);
      const saved = page.waitForResponse((r) => /\/api\/data\/masters(\.sections|\/batch)$/.test(r.url()) && r.request().method() === "POST", { timeout: 20_000 });
      await page.getByRole("button", { name: "Update", exact: true }).click();
      expect((await saved).status(), "the element write").toBe(200);
      await expect.poll(async () => (await sectionsOfV())[0]?.name, { timeout: 15_000 }).toBe(renamed);
      await expect(page.getByText(new RegExp(`V-${renamed}`)).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/^Not saved/)).toHaveCount(0);
      await shot(page, `masters-section-${s.name}`);
      expect(masterPosts, "never the masters-desk book").toEqual([]);
    } finally {
      const [now] = await sectionsOfV();
      if (now && now.name !== original) {
        await page.request.post("/api/data/masters.sections", { data: { ops: [{ op: "upsert", id: now.id, base: String(now._rev ?? 0), row: { name: original } }] } });
      }
      await close();
    }
    expect(errors, "no page errors").toEqual([]);
  });

  test(`${s.name}: Staff attendance rules — a rule is created and removed, Masters is never pushed`, async ({ browser }) => {
    const { page, masterPosts, close } = await open(browser, s);
    const errors = collectPageErrors(page);
    const code = `E2E${Date.now().toString(36).slice(-4).toUpperCase()}`;
    try {
      await page.goto("/masters?tab=leave");
      await page.getByRole("tab", { name: /Attendance rules/ }).click({ timeout: 30_000 });
      await page.getByRole("button", { name: "+ New rule" }).click({ timeout: 30_000 });
      await page.getByPlaceholder("Code", { exact: true }).fill(code);
      await page.getByPlaceholder("Name", { exact: true }).fill("E2E 2.2f rule");
      await page.getByRole("button", { name: "Create rule", exact: true }).click();
      await expect(page.getByText(`Created ${code}`)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("listitem").filter({ hasText: code })).toHaveCount(1);
      await shot(page, `attendance-rule-created-${s.name}`);
      // Reload: the rule came back from the server's store, not the tab.
      await page.reload();
      await page.getByRole("tab", { name: /Attendance rules/ }).click({ timeout: 30_000 });
      await expect(page.getByRole("listitem").filter({ hasText: code })).toHaveCount(1, { timeout: 30_000 });
      expect(masterPosts, "never the masters-desk book").toEqual([]);
    } finally {
      const item = page.getByRole("listitem").filter({ hasText: code });
      if ((await item.count()) > 0) {
        page.once("dialog", (d) => void d.accept()); // RemoveControl confirms with window.confirm
        await item.getByRole("button", { name: /Remove/ }).first().click();
        await expect(page.getByText("Rule removed")).toBeVisible({ timeout: 15_000 });
      }
      await close();
    }
    expect(errors, "no page errors").toEqual([]);
  });

  test(`${s.name}: SIS — the roster and a student's profile open (loadSis runs), Masters is never pushed`, async ({ browser }) => {
    // Not a save: the student form's Save (the whole-roster SIS push) is
    // refused on this fixture on origin/main too ("duplicate key …
    // sis_students_tenant_admission_ay_uidx" — Phase 3's path, not Masters).
    // What 2.2f changed here is the READ: loadSis no longer saves the Masters
    // book (ensureStudentClassLinks, the fee-discount seed import).
    const { page, masterPosts, close } = await open(browser, s);
    const errors = collectPageErrors(page);
    const child = fx.sis.students.filter((x) => x.status === "active" && x.academicYearCode === fx.sessions.principal.academicYearCode)[3]!;
    try {
      await page.goto("/students");
      await expect(page.getByText(/active/).first()).toBeVisible({ timeout: 30_000 });
      await page.goto(`/students/${child.id}/edit`);
      await expect(page.locator("label", { hasText: "Notes" }).first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(3_000);
      await shot(page, `sis-profile-${s.name}`);
      expect(masterPosts, "never the masters-desk book").toEqual([]);
    } finally {
      await close();
    }
    expect(errors, "no page errors").toEqual([]);
  });

  test(`${s.name}: Fee Take — the counter opens on a child, Masters is never pushed`, async ({ browser }) => {
    const { page, masterPosts, close } = await open(browser, s);
    const errors = collectPageErrors(page);
    const child = fx.sis.students.filter((x) => x.status === "active" && x.academicYearCode === fx.sessions.principal.academicYearCode)[0]!;
    try {
      await page.goto(`/fees?tab=collect&q=${encodeURIComponent(child.admissionNo)}`);
      await page.getByRole("button", { name: new RegExp(child.admissionNo) }).first().click({ timeout: 30_000 });
      await page.waitForTimeout(4_000);
      await shot(page, `fee-take-${s.name}`);
      expect(masterPosts, "never the masters-desk book").toEqual([]);
    } finally {
      await close();
    }
    expect(errors, "no page errors").toEqual([]);
  });
}
