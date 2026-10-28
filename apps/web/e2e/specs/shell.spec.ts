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
 *   - log no console error from the page's code (React logs #185 and failed
 *     renders there). The browser's own "Failed to load resource: … 403/404"
 *     lines are network outcomes, not render errors: those requests are
 *     recorded (method, path, status) in the "shell-sweep" metric instead,
 *     and a 5xx among them fails the test;
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
  { name: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false, colorScheme: "light" },
  { name: "phone-375", viewport: { width: 375, height: 812 }, isMobile: true, colorScheme: "dark" },
] as const;

/** The browser's network-failure line — recorded per request instead (see header). */
const NETWORK_LINE = /^Failed to load resource: the server responded with a status of \d+/;

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
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: vp.viewport,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    colorScheme: vp.colorScheme,
  });
  await signIn(context, who);
  const page = await context.newPage();
  const problems: string[] = [];
  let route = "";
  page.on("pageerror", (e) => problems.push(`${route} pageerror: ${e.message.slice(0, 300)}`));
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error" && !NETWORK_LINE.test(m.text())) problems.push(`${route} console.error: ${m.text().slice(0, 300)}`);
  });
  const refused: string[] = [];
  page.on("response", (r) => {
    if (r.status() < 400) return;
    const u = new URL(r.url());
    const line = `${route} ${r.request().method()} ${u.pathname} ${r.status()}`;
    if (!refused.includes(line)) refused.push(line);
    if (r.status() >= 500) problems.push(`${line} (server error)`);
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
  const shots: { name: string; body: Buffer }[] = [];
  for (const path of ROUTES) {
    route = path;
    await page.goto(path);
    await settle(page, () => inflight, () => lastStart);
    // The shell drew (not a blank page).
    await expect(page.locator("header").first()).toBeVisible();
    const restricted = await page.getByText("Access restricted").count();
    seen[path] = restricted ? "restricted" : "open";
    if (path === "/home") shots.push({ name: `home-${who}-${vp.name}-${vp.colorScheme}.png`, body: await page.screenshot({ fullPage: false }) });
  }
  if (vp.name === "desktop") {
    // The header search, focused: module shortcuts this person may open.
    await page.goto("/home");
    await settle(page, () => inflight, () => lastStart);
    const search = page.getByPlaceholder("Search modules, students, staff…");
    if (await search.count()) {
      await search.click();
      await page.waitForTimeout(500);
      shots.push({ name: `search-${who}-${vp.name}.png`, body: await page.screenshot() });
    }
    // The account menu (profile link, roles) — the header's own button.
    const menu = page.locator('header button[aria-haspopup="menu"]').last();
    if (await menu.count()) {
      await page.keyboard.press("Escape");
      await menu.click();
      await page.waitForTimeout(300);
      shots.push({ name: `account-menu-${who}-${vp.name}.png`, body: await page.screenshot() });
    }
  }
  await context.close();
  return { problems, seen, refused, shots };
}

for (const who of LOGINS) {
  for (const vp of VIEWPORTS) {
    test(`${who} @ ${vp.name}: every main route renders with no crash, no console error, no React #185`, async ({ browser }, testInfo) => {
      test.setTimeout(300_000);
      const { problems, seen, refused, shots } = await sweep(browser, who, vp);
      for (const s of shots) await testInfo.attach(s.name, { body: s.body, contentType: "image/png" });
      await metric(testInfo, "shell-sweep", { who, viewport: vp.name, routes: seen, problems: problems.length, refused });
      expect(problems.filter((p) => /#185|Maximum update depth/i.test(p)), "React #185 (render loop)").toEqual([]);
      expect(problems, "uncaught exceptions and console errors").toEqual([]);
    });
  }
}
