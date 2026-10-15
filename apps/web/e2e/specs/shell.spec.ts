/**
 * shell — the shell (sidebar, header search, account menu, staff chat, the AI
 * assistant) is on every page, so a render loop or a crash in it breaks every
 * page (data-layer step 2.1f).
 *
 * The 13 Oct 2026 loop on /students (React #185 "Maximum update depth
 * exceeded": syncSisIntoMasters → 'bhb-masters-updated' → ModuleDashboardHost
 * → useAccessData / ErpSidebar route effect) is the failure this guards
 * against. For each of the four fixture logins, at desktop width and at
 * 375 px, every main route is opened by URL in one tab (each a full page
 * load, the way the 13 Oct loop showed) and must:
 *
 *   - raise no uncaught exception (React crashes land in `pageerror`);
 *   - log no console error (React logs #185 and failed renders there);
 *   - leave the gate (no "Loading school data…") and draw the header's
 *     account menu (the shell rendered, not a blank page).
 *
 * A route a login may not open shows "Access restricted" — that is a correct
 * page, not an error.
 */
import type { Browser, ConsoleMessage, Page } from "@playwright/test";
import { APP_URL, expect, metric, signIn, test, type Who } from "../support";

const ROUTES = [
  "/home",
  "/students",
  "/staff",
  "/masters",
  "/attendance",
  "/fees",
  "/payroll",
  "/timetable",
  "/homework",
] as const;

const LOGINS: Who[] = ["office", "principal", "teacher", "timetableTeacher"];

const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false },
  { name: "phone-375", viewport: { width: 375, height: 812 }, isMobile: true },
] as const;

/** Settle: the gate is gone and no /api request has started for 1.5 s (max 20 s). */
async function settle(page: Page, inflight: () => number, lastStart: () => number): Promise<void> {
  await expect(page.getByText("Loading school data…")).toHaveCount(0, { timeout: 30_000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 20_000) {
    if (inflight() === 0 && Date.now() - lastStart() > 1_500) return;
    await page.waitForTimeout(200);
  }
}

async function sweep(browser: Browser, who: Who, vp: (typeof VIEWPORTS)[number]) {
  const context = await browser.newContext({ baseURL: APP_URL, viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.isMobile });
  await signIn(context, who);
  const page = await context.newPage();
  const problems: string[] = [];
  let route = "";
  page.on("pageerror", (e) => problems.push(`${route} pageerror: ${e.message.slice(0, 300)}`));
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") problems.push(`${route} console.error: ${m.text().slice(0, 300)}`);
  });
  let inflight = 0;
  let lastStart = Date.now();
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) {
      inflight += 1;
      lastStart = Date.now();
    }
  });
  const done = (r: { url: () => string }) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) inflight = Math.max(0, inflight - 1);
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);

  const seen: Record<string, string> = {};
  for (const path of ROUTES) {
    route = path;
    await page.goto(path);
    await settle(page, () => inflight, () => lastStart);
    // The shell drew (not a blank page).
    await expect(page.locator("header").first()).toBeVisible();
    const restricted = await page.getByText("Access restricted").count();
    seen[path] = restricted ? "restricted" : "open";
  }
  await context.close();
  return { problems, seen };
}

for (const who of LOGINS) {
  for (const vp of VIEWPORTS) {
    test(`${who} @ ${vp.name}: every main route renders with no crash, no console error, no React #185`, async ({ browser }, testInfo) => {
      test.setTimeout(300_000);
      const { problems, seen } = await sweep(browser, who, vp);
      await metric(testInfo, "shell-sweep", { who, viewport: vp.name, routes: seen, problems: problems.length });
      expect(problems.filter((p) => /#185|Maximum update depth/i.test(p)), "React #185 (render loop)").toEqual([]);
      expect(problems, "uncaught exceptions and console errors").toEqual([]);
    });
  }
}
