/**
 * admissions-comms — data-layer 2.1g: the Admissions and Communication screens
 * read Masters from the query kernel (useScreenMasters / useMasters) and the
 * departments from the staff directory (useStaffList) — never a page copy read
 * once at mount.
 *
 *   1. Seen: every converted screen, office, desktop-light and 375 px dark —
 *      each class list carries the school's 15 classes, the WhatsApp staff
 *      picker its departments, and no page error is thrown.
 *   2. Failed read: GET /api/data/views/masters answering 503 makes
 *      /admissions, its Reports tab and the WhatsApp "Send message" tab say
 *      "could not load" + Try again and draw no class list (an empty list is
 *      the old failure: a read error shown as "this school has no classes");
 *      Try again brings all 15 back without a reload.
 *      On origin/main these screens never ask the view (hits = 0) and draw
 *      their lists from the page copy.
 */
import type { Browser, Page } from "@playwright/test";
import { APP_URL, collectPageErrors, expect, fx, metric, signIn, test } from "../support";

const FAILED_READ = JSON.stringify({ ok: false, error: "Could not read the school setup — please try again." });
const N = fx.expected.classes;

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

/** The "Class sought" filter on Admissions → Report: "All classes" + one per class. */
const reportClassSought = (page: Page) =>
  page.locator("label", { hasText: /^Class sought/ }).locator("select").first();

/** WhatsApp → Send message → Parents: one toggle button per active class. */
const waClassButtons = (page: Page) =>
  page.getByRole("button", { name: /^(Nursery|LKG|UKG|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/ });

async function openWaSend(page: Page): Promise<void> {
  await page.goto("/comms?tab=whatsapp");
  await expect(page.getByRole("tab", { name: "Send message" }).first()).toBeVisible({ timeout: 20_000 });
}

type Screen = { name: string; open: (page: Page) => Promise<void> };

const SCREENS: Screen[] = [
  {
    name: "admissions-dashboard",
    open: async (p) => {
      await p.goto("/admissions");
      await expect(p.getByRole("tab", { name: "Walk-in enquiry" }).first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "admissions-enquiry",
    open: async (p) => {
      await p.goto("/admissions?tab=enquiry");
      await expect(p.getByText("Household", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "admissions-referrals",
    open: async (p) => {
      await p.goto("/admissions?tab=referrals");
      await expect(p.getByText("Referral reward policy")).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "admissions-reports",
    open: async (p) => {
      await p.goto("/admissions?tab=reports");
      await expect(reportClassSought(p).locator("option")).toHaveCount(N + 1, { timeout: 20_000 });
    },
  },
  {
    name: "wa-send-parents",
    open: async (p) => {
      await openWaSend(p);
      await expect(waClassButtons(p)).toHaveCount(N, { timeout: 20_000 });
    },
  },
  {
    name: "wa-send-staff",
    open: async (p) => {
      await openWaSend(p);
      await p.getByRole("button", { name: "Staff", exact: true }).click();
      const dept = p.locator("label", { hasText: /^Department/ }).locator("select");
      await expect(dept.locator("option").first()).toHaveText("Any department", { timeout: 20_000 });
      expect(await dept.locator("option").count(), "departments listed").toBeGreaterThan(1);
    },
  },
  {
    name: "wa-send-students",
    open: async (p) => {
      await openWaSend(p);
      await p.getByRole("button", { name: "Pick students", exact: true }).click();
      const cls = p.locator("label", { hasText: /^Class/ }).locator("select").first();
      await expect(cls.locator("option")).toHaveCount(N + 1, { timeout: 20_000 });
    },
  },
  {
    name: "wa-chats",
    open: async (p) => {
      await p.goto("/comms?tab=whatsapp");
      await p.getByRole("tab", { name: "Chats", exact: true }).click({ timeout: 20_000 });
      await expect(p.getByText("Received · by category")).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "wa-class-groups",
    open: async (p) => {
      await p.goto("/comms?tab=whatsapp");
      await p.getByRole("tab", { name: "Class groups", exact: true }).click({ timeout: 20_000 });
      await p.waitForLoadState("networkidle").catch(() => undefined);
    },
  },
  {
    name: "app-popups-classes",
    open: async (p) => {
      await p.goto("/comms?tab=popups");
      await p.getByRole("button", { name: "New pop-up", exact: true }).click({ timeout: 20_000 });
      await p.locator("label", { hasText: /^Who sees it/ }).locator("select").selectOption("classes");
      await expect(p.getByRole("checkbox", { name: /^(Nursery|LKG|UKG|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/ })).toHaveCount(N, { timeout: 20_000 });
    },
  },
];

async function phoneDark(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 375, height: 812 }, colorScheme: "dark" });
  await signIn(context, "office");
  return context.newPage();
}

test.describe("seen: office, desktop-light and 375 dark", () => {
  for (const s of SCREENS) {
    test(`office ${s.name}: drawn from the Masters view, no page error`, async ({ page, browser }, testInfo) => {
      const errors = collectPageErrors(page);
      await s.open(page);
      await page.screenshot({ path: testInfo.outputPath(`${s.name}-desktop-light.png`), fullPage: true });
      const phone = await phoneDark(browser);
      const phoneErrors = collectPageErrors(phone);
      await s.open(phone);
      await phone.screenshot({ path: testInfo.outputPath(`${s.name}-phone375-dark.png`), fullPage: true });
      await phone.context().close();
      expect([...errors, ...phoneErrors], "page errors").toEqual([]);
    });
  }
});

test.describe("views/masters 503 = could not load, never an empty class list", () => {
  test(`office /admissions: "could not load" + Try again, no tabs; Try again recovers`, async ({ page }, testInfo) => {
    const lift = await failView(page, "masters");
    const t0 = Date.now();
    await page.goto("/admissions?tab=reports");
    await expect(page.getByText(/could not load/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    const shownAfterMs = Date.now() - t0;
    await expect(page.getByRole("tab", { name: "Walk-in enquiry" })).toHaveCount(0);
    await expect(reportClassSought(page)).toHaveCount(0);
    await lift();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(reportClassSought(page).locator("option")).toHaveCount(N + 1, { timeout: 15_000 });
    await metric(testInfo, "error", { page: "/admissions?tab=reports", read: "views/masters", failureShownAfterMs: shownAfterMs });
  });

  test(`office WhatsApp Send: "could not load the school's classes", no class buttons; Try again recovers`, async ({ page }, testInfo) => {
    const lift = await failView(page, "masters");
    await openWaSend(page);
    await expect(page.getByText(/could not load/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(waClassButtons(page)).toHaveCount(0);
    await lift();
    await page.getByRole("button", { name: "Try again" }).first().click();
    await expect(waClassButtons(page)).toHaveCount(N, { timeout: 15_000 });
    await metric(testInfo, "error", { page: "/comms?tab=whatsapp", read: "views/masters" });
  });
});
