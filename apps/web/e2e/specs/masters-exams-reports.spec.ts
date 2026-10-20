/**
 * masters-exams-reports — data-layer 2.1h: Masters, Exams, Reports, Events
 * and the Field app read Masters through the query kernel (useScreenMasters /
 * useMasters) and the staff directory (useStaffList) — never a page copy read
 * once at mount. Masters' SAVES are unchanged (2.2): the propagation spec's
 * editor cases still drive them, and /masters is now one of its observers.
 *
 *   1. Seen: every converted screen, desktop-light and 375 dark, as the
 *      person who uses it (office; principal for Roles and Exams; the class
 *      teacher for Exams and her Teaching report), with the school's counts:
 *      15 classes, 34 active staff. No page error.
 *   2. Failed read: views/masters (or views/staff-list) answering 503 makes the
 *      screen say "could not load" + Try again and draw no list; Try again
 *      brings it back. On origin/main these screens never ask the views.
 */
import type { Browser, Page } from "@playwright/test";
import { APP_URL, collectPageErrors, expect, fx, metric, signIn, test, type Who } from "../support";

const FAILED_READ = JSON.stringify({ ok: false, error: "Could not read the school setup — please try again." });
const CLASSES = fx.expected.classes;
const ACTIVE_STAFF = fx.expected.activeStaff;
const CLASS_NAME = /^(Nursery|LKG|UKG|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/;

async function failView(page: Page, name: "masters" | "staff-list"): Promise<() => Promise<void>> {
  const pattern = `**/api/data/views/${name}`;
  let hits = 0;
  await page.route(pattern, (route) => {
    hits += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: FAILED_READ });
  });
  return async () => {
    expect(hits, `the page asked views/${name} at least once`).toBeGreaterThan(0);
    await page.unroute(pattern);
  };
}

async function contextPage(browser: Browser, who: Who, phone: boolean): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: phone ? { width: 375, height: 812 } : { width: 1440, height: 900 },
    colorScheme: phone ? "dark" : "light",
  });
  await signIn(context, who);
  return context.newPage();
}

const staffCodeLabels = (page: Page) => page.locator("label").filter({ hasText: /E2E-\d{3}$/ });
const fieldClassSelect = (page: Page) => page.locator("select").filter({ has: page.locator("option", { hasText: /^Nursery$/ }) }).first();

type Screen = { name: string; who: Who; open: (page: Page) => Promise<void> };

const SCREENS: Screen[] = [
  {
    name: "masters-overview",
    who: "office",
    open: async (p) => {
      await p.goto("/masters");
      await expect(p.getByRole("button", { name: `${CLASSES} Classes`, exact: true })).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "masters-subjects",
    who: "office",
    open: async (p) => {
      await p.goto("/masters?tab=subjects");
      await p.getByRole("tab", { name: "3 · Subjects by class" }).click({ timeout: 20_000 });
      await p.getByRole("combobox", { name: "Class", exact: true }).first().selectOption({ label: "V" });
      await expect(p.getByRole("row", { name: /\bMATH Mathematics\b/ })).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "masters-attendance-settings",
    who: "office",
    open: async (p) => {
      await p.goto("/masters?tab=leave");
      await p.getByText("3 · Attendance settings", { exact: true }).click({ timeout: 20_000 });
      await expect(staffCodeLabels(p)).toHaveCount(ACTIVE_STAFF, { timeout: 20_000 });
    },
  },
  {
    name: "masters-attendance-rules",
    who: "office",
    open: async (p) => {
      await p.goto("/masters?tab=leave");
      await p.getByText("4 · Attendance rules", { exact: true }).click({ timeout: 20_000 });
      await expect(p.getByRole("row").filter({ hasText: /E2E-\d{3} · / })).toHaveCount(ACTIVE_STAFF, { timeout: 20_000 });
    },
  },
  {
    name: "masters-salary",
    who: "office",
    open: async (p) => {
      await p.goto("/masters?tab=salary");
      await expect(p.getByText(/Completeness:/)).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "masters-roles",
    who: "principal",
    open: async (p) => {
      await p.goto("/masters?tab=roles");
      await expect(p.getByRole("region", { name: "Roles and permissions" }).or(p.locator('[aria-label="Roles and permissions"]')).first()).toBeVisible({ timeout: 20_000 });
      await expect(p.getByText(/Super Admin \/ Principal \/ Admin only/)).toHaveCount(0);
    },
  },
  {
    name: "exams-marks",
    who: "principal",
    open: async (p) => {
      await p.goto("/exams");
      await p.getByRole("tab", { name: "Mark entry", exact: true }).click({ timeout: 20_000 });
      const cls = p.locator("select").filter({ has: p.locator("option", { hasText: /^Select class$/ }) }).first();
      await expect(cls.locator("option")).toHaveCount(CLASSES + 1, { timeout: 20_000 });
    },
  },
  {
    name: "exams-remarks",
    who: "principal",
    open: async (p) => {
      await p.goto("/exams");
      await p.getByRole("tab", { name: "Remarks", exact: true }).click({ timeout: 20_000 });
      await expect(p.getByText(/could not load/i)).toHaveCount(0);
    },
  },
  {
    name: "exams-teacher",
    who: "teacher",
    open: async (p) => {
      await p.goto("/exams");
      await expect(p.getByRole("tab", { name: "Mark entry", exact: true }).or(p.getByText(/Access restricted/i)).first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "reports-center",
    who: "office",
    open: async (p) => {
      await p.goto("/reports");
      await expect(p.getByRole("tab", { name: "Teaching", exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(p.getByText(/no module export access/i)).toHaveCount(0);
    },
  },
  {
    name: "reports-teaching",
    who: "office",
    open: async (p) => {
      await p.goto("/reports?module=teaching");
      const cls = p.locator("select").filter({ has: p.locator("option", { hasText: /^Nursery$/ }) }).first();
      await expect(cls.locator("option", { hasText: CLASS_NAME })).toHaveCount(CLASSES, { timeout: 20_000 });
    },
  },
  {
    name: "reports-teacher",
    who: "teacher",
    open: async (p) => {
      await p.goto("/reports");
      await expect(p.getByText(/Reports Center/).first()).toBeVisible({ timeout: 20_000 });
      await expect(p.getByText(/could not load/i)).toHaveCount(0);
    },
  },
  {
    name: "events-dashboard",
    who: "office",
    open: async (p) => {
      await p.goto("/events");
      await expect(p.getByText("Upcoming events").first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "events-interschool",
    who: "office",
    open: async (p) => {
      await p.goto("/events");
      await p.getByRole("tab", { name: "Inter-school", exact: true }).click({ timeout: 20_000 });
      await p.waitForLoadState("networkidle").catch(() => undefined);
    },
  },
  {
    name: "field-capture",
    who: "office",
    open: async (p) => {
      await p.goto("/field/capture");
      await expect(fieldClassSelect(p).locator("option", { hasText: CLASS_NAME })).toHaveCount(CLASSES, { timeout: 20_000 });
    },
  },
  {
    name: "field-register",
    who: "office",
    open: async (p) => {
      await p.goto("/field/register");
      await expect(fieldClassSelect(p).locator("option", { hasText: CLASS_NAME })).toHaveCount(CLASSES, { timeout: 20_000 });
    },
  },
];

test.describe("seen: desktop-light and 375 dark", () => {
  for (const s of SCREENS) {
    test(`${s.who} ${s.name}: drawn from the kernel's reads, no page error`, async ({ browser }, testInfo) => {
      test.setTimeout(120_000);
      for (const phone of [false, true]) {
        const page = await contextPage(browser, s.who, phone);
        const errors = collectPageErrors(page);
        await s.open(page);
        await page.screenshot({ path: testInfo.outputPath(`${s.name}-${phone ? "phone375-dark" : "desktop-light"}.png`), fullPage: true });
        await testInfo.attach(`${s.name}-${phone ? "phone" : "desktop"}-text`, { body: (await page.locator("body").innerText()).slice(0, 4000), contentType: "text/plain" });
        await page.context().close();
        expect(errors, `page errors (${phone ? "phone" : "desktop"})`).toEqual([]);
      }
    });
  }
});

type Fail = { name: string; who: Who; view: "masters" | "staff-list"; open: (p: Page) => Promise<void>; absent: (p: Page) => ReturnType<Page["locator"]>; recovered: (p: Page) => Promise<void> };

const FAILS: Fail[] = [
  {
    name: "/exams Mark entry",
    who: "principal",
    view: "masters",
    open: async (p) => { await p.goto("/exams"); },
    absent: (p) => p.getByRole("tab", { name: "Mark entry", exact: true }),
    recovered: async (p) => { await expect(p.getByRole("tab", { name: "Mark entry", exact: true })).toBeVisible({ timeout: 15_000 }); },
  },
  {
    name: "/reports",
    who: "office",
    view: "masters",
    open: async (p) => { await p.goto("/reports"); },
    absent: (p) => p.getByText(/no module export access/i),
    recovered: async (p) => { await expect(p.getByRole("tab", { name: "Teaching", exact: true })).toBeVisible({ timeout: 15_000 }); },
  },
  {
    name: "/events",
    who: "office",
    view: "masters",
    open: async (p) => { await p.goto("/events"); },
    absent: (p) => p.getByRole("tab", { name: "Inter-school", exact: true }),
    recovered: async (p) => { await expect(p.getByRole("tab", { name: "Inter-school", exact: true })).toBeVisible({ timeout: 15_000 }); },
  },
  {
    name: "/masters Salary setup",
    who: "office",
    view: "masters",
    open: async (p) => { await p.goto("/masters?tab=salary"); },
    absent: (p) => p.getByText(/Completeness:/),
    recovered: async (p) => { await expect(p.getByText(/Completeness:/)).toBeVisible({ timeout: 15_000 }); },
  },
  {
    name: "/masters Attendance rules (staff list)",
    who: "office",
    view: "staff-list",
    open: async (p) => {
      await p.goto("/masters?tab=leave");
      await p.getByText("4 · Attendance rules", { exact: true }).click({ timeout: 20_000 });
    },
    absent: (p) => p.getByText(/No active staff/),
    recovered: async (p) => { await expect(p.getByRole("row").filter({ hasText: /E2E-\d{3} · / })).toHaveCount(ACTIVE_STAFF, { timeout: 15_000 }); },
  },
];

test.describe("a failed read is shown as a failure, never as an empty list", () => {
  for (const f of FAILS) {
    test(`${f.who} ${f.name}: views/${f.view} 503 → "could not load" + Try again; Try again recovers`, async ({ browser }, testInfo) => {
      const page = await contextPage(browser, f.who, false);
      const lift = await failView(page, f.view);
      const t0 = Date.now();
      await f.open(page);
      await expect(page.getByText(/could not load/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();
      const shownAfterMs = Date.now() - t0;
      await expect(f.absent(page)).toHaveCount(0);
      await lift();
      await page.getByRole("button", { name: "Try again" }).first().click();
      await f.recovered(page);
      await metric(testInfo, "error", { page: f.name, read: `views/${f.view}`, failureShownAfterMs: shownAfterMs });
      await page.context().close();
    });
  }
});
