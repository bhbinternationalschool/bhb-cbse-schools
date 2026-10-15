/**
 * payroll — data-layer 2.1e: the payroll screens read useScreenMasters()
 * (the server's Masters + the access copy's full staff records) instead of
 * the tab's page copy.
 *
 * Seeded here, through the app's own write paths, on top of the e2e fixture
 * (5 draft runs Aug–Oct, PR #650):
 *   - salary setup (POST /api/school-data/domain-blob, salary_setup_state):
 *     the default heads/structures + six staff links with every statutory
 *     cover, a basic override, an additional amount and a gross-up;
 *   - a NON-default statutory setup (POST /api/data/masters.statutory-config):
 *     EPF 10 % with no wage ceiling, ESIC ceiling ₹25,000 — so a screen that
 *     computed from a default or empty statutory setup would show different
 *     rupees than one reading the school's own.
 * Both are put back in afterAll.
 *
 * Every payroll tab's on-screen text is attached (payroll-<tab>.txt) so a
 * before/after diff of the numbers is a text diff of two CI runs; desktop
 * light and 375 px dark screenshots are saved under test-results.
 */
import type { APIRequestContext, Browser, Page, TestInfo } from "@playwright/test";
import { APP_URL, expect, signIn, test, type Who } from "../support";
import { defaultSalarySetupState } from "@/lib/salarySetup";

// Tab id → its label on the tab strip. The spec CLICKS the tab: on origin/main
// a ?tab= deep link was overridden by the access effect deciding while the
// roster was still unknown (see PayrollWorkspace), so a link would not
// compare like with like.
const TABS = [
  ["dashboard", /^Dashboard$/],
  ["runs", /^Runs$/],
  ["approvals", /^Approvals/],
  ["holds", /^June holds$/],
  ["govt", /^EPF\/ESIC Compliance$/],
  ["increment", /^Increment$/],
  ["advances", /^Advances$/],
  ["payslips", /^Payslips$/],
  ["print", /^Print payslips$/],
  ["reports", /^Reports$/],
  ["bank", /^Bank file$/],
  ["mine", /^My payslip$/],
  ["myAdvances", /^My advances$/],
] as const;

const STATUTORY_PATCH = { applyEpfWageCeiling: false, esicWageCeiling: 25000, epfContributionRatePct: 10 };

function salarySetup() {
  const s = defaultSalarySetupState();
  const [teach, nonTeach] = s.structures;
  const link = (staffId: string, structureId: string, extra: Record<string, unknown>) => ({
    staffId,
    structureId,
    basicOverride: 0,
    statutoryCover: "both",
    additionalAmount: 0,
    additionalLabel: "",
    statutoryGrossUp: false,
    effectiveFrom: "2026-04-01",
    salaryAccountNote: "",
    ...extra,
  });
  return {
    ...s,
    staffLinks: [
      link("e2e_stf_01", nonTeach!.id, { statutoryCover: "both" }),
      link("e2e_stf_02", nonTeach!.id, { statutoryCover: "pf_only", basicOverride: 12000 }),
      link("e2e_stf_03", teach!.id, { statutoryCover: "both", additionalAmount: 1500, additionalLabel: "Coordinator" }),
      link("e2e_stf_04", teach!.id, { statutoryCover: "esic_only", basicOverride: 9000 }),
      link("e2e_stf_05", teach!.id, { statutoryCover: "none" }),
      link("e2e_stf_06", teach!.id, { statutoryCover: "pf_only", statutoryGrossUp: true, basicOverride: 14000 }),
    ],
  };
}

type Saved = { statutory: unknown; statutoryRev: string; salary: unknown; salaryAt: string };

async function readStatutory(req: APIRequestContext) {
  const r = await req.get("/api/data/masters.statutory-config");
  expect(r.status(), "read statutory setup").toBe(200);
  const body = (await r.json()) as { rows?: { value?: unknown }[]; revision?: unknown };
  return { value: body.rows?.[0]?.value ?? null, revision: String(body.revision ?? "") };
}
async function writeStatutory(req: APIRequestContext, value: unknown, base: string) {
  const r = await req.post("/api/data/masters.statutory-config", {
    data: { ops: [{ op: "upsert", id: "statutoryConfig", base: base || null, row: value }] },
  });
  expect(r.status(), `write statutory setup: ${await r.text()}`).toBe(200);
}
async function readSalary(req: APIRequestContext) {
  const r = await req.get("/api/school-data/domain-blob?table=salary_setup_state");
  expect(r.status(), "read salary setup").toBe(200);
  const body = (await r.json()) as { state?: unknown; updatedAt?: string };
  return { state: body.state ?? null, at: body.updatedAt || "" };
}
async function writeSalary(req: APIRequestContext, state: unknown, base: string) {
  const r = await req.post("/api/school-data/domain-blob", {
    data: { table: "salary_setup_state", state, baseUpdatedAt: base || null },
  });
  expect(r.status(), `write salary setup: ${await r.text()}`).toBe(200);
}

async function open(browser: Browser, who: Who, opts: { width: number; height: number; dark?: boolean }) {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  await signIn(context, who);
  await context.addCookies([{ name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL }]);
  return { context, page: await context.newPage() };
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
}

async function openTab(page: Page, tab: string, label: RegExp, opts: { deepLink?: boolean } = {}) {
  // A teacher may open only the self-service tabs, so the route guard needs
  // the ?tab= link ("Access restricted" on bare /payroll).
  await page.goto(opts.deepLink ? `/payroll?tab=${tab}` : "/payroll");
  await expect(page.getByText(/Loading payroll…/)).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("tab", { name: label }).first().click({ timeout: 30_000 });
  await settle(page);
  // Pick the same thing on every run so the numbers are comparable.
  const pick = async (value: string) => {
    const sel = page.locator("select").filter({ has: page.locator(`option[value="${value}"]`) }).first();
    if (await sel.count()) await sel.selectOption(value);
  };
  if (tab === "increment") await pick("e2e_stf_03");
  if (tab === "print" || tab === "payslips" || tab === "bank") await pick("2026-10");
  await settle(page);
}

async function grab(page: Page, testInfo: TestInfo, name: string): Promise<string> {
  const text = await page.locator("main").first().innerText();
  await testInfo.attach(`payroll-${name}.txt`, { body: text, contentType: "text/plain" });
  return text;
}

let saved: Saved | null = null;

test.describe("payroll screens (2.1e)", () => {
  test.beforeAll(async ({ browser }) => {
    const { context, page } = await open(browser, "principal", { width: 1440, height: 900 });
    const st = await readStatutory(page.request);
    const sal = await readSalary(page.request);
    saved = { statutory: st.value, statutoryRev: st.revision, salary: sal.state, salaryAt: sal.at };
    await writeStatutory(page.request, { ...(st.value as object), ...STATUTORY_PATCH }, st.revision);
    await writeSalary(page.request, salarySetup(), sal.at);
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!saved) return;
    const { context, page } = await open(browser, "principal", { width: 1440, height: 900 });
    const st = await readStatutory(page.request);
    await writeStatutory(page.request, saved.statutory, st.revision);
    const sal = await readSalary(page.request);
    if (saved.salary) await writeSalary(page.request, saved.salary, sal.at);
    await context.close();
  });

  test("principal: every payroll tab and each run's salary-setup review render from the server's Masters", async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    const { context, page } = await open(browser, "principal", { width: 1440, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    for (const [tab, label] of TABS) {
      await openTab(page, tab, label);
      const text = await grab(page, testInfo, tab);
      expect(text, `${tab}: no failed Masters read`).not.toMatch(/Could not load/);
      await page.screenshot({ path: testInfo.outputPath(`payroll-${tab}-desktop-light.png`), fullPage: true });
    }
    // Each run's detail, with the salary-setup review open: these lines are
    // rebuilt from Masters (statutory setup) + the staff records + salary setup.
    for (const [m, n] of [["2026-10", 2], ["2026-09", 2], ["2026-08", 1]] as const) {
      for (let i = 0; i < n; i++) {
        await openTab(page, "runs", /^Runs$/);
        for (const hdr of ["September 2026", "August 2026"]) {
          const h = page.getByRole("button", { name: new RegExp(`^${hdr}\\b`) });
          if ((await h.count()) && (await h.getAttribute("aria-expanded")) === "false") await h.click();
        }
        await page.getByRole("button", { name: `Actions for run ${m}` }).nth(i).click();
        await page.getByRole("menuitem", { name: "Open run" }).click();
        await settle(page);
        const review = page.getByRole("button", { name: "Review salary setup" });
        if (await review.count()) await review.first().click();
        await settle(page);
        await grab(page, testInfo, `detail-${m}-${i}`);
        await page.screenshot({ path: testInfo.outputPath(`payroll-detail-${m}-${i}-desktop-light.png`), fullPage: true });
      }
    }
    expect(errors, "no page errors").toEqual([]);
    await context.close();
  });

  test("principal on a 375 px phone, dark: every payroll tab renders", async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    const { context, page } = await open(browser, "principal", { width: 375, height: 812, dark: true });
    for (const [tab, label] of TABS) {
      await openTab(page, tab, label);
      await expect(page.locator("main").first()).not.toContainText("Could not load");
      await page.screenshot({ path: testInfo.outputPath(`payroll-${tab}-phone375-dark.png`), fullPage: true });
    }
    await context.close();
  });

  test("teacher: My salary renders (self-service, letterhead from the teaching answer)", async ({ browser }, testInfo) => {
    const { context, page } = await open(browser, "teacher", { width: 1440, height: 900 });
    for (const [tab, label] of [["mine", /^My payslip$/], ["myAdvances", /^My advances$/]] as const) {
      await openTab(page, tab, label, { deepLink: true });
      const text = await grab(page, testInfo, `teacher-${tab}`);
      expect(text).not.toMatch(/Could not load/);
      await page.screenshot({ path: testInfo.outputPath(`payroll-teacher-${tab}-desktop-light.png`), fullPage: true });
    }
    await context.close();
  });
});
