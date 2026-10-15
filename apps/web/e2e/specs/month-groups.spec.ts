/**
 * month-groups — growing lists fold by month (components/ui/month-grouped-rows.tsx).
 *
 * The fixture seeds payroll runs over October, September and August 2026 and
 * automation runs over October, September and August 2026 (e2e/fixture.ts),
 * one of them at 20:00Z on 30 Sep — 01:30 on 1 Oct in India, so October.
 *
 * Asserted, from the DOM:
 *   - the newest month is open and older months are folded (aria-expanded,
 *     and the folded rows are not visible);
 *   - a month header toggles by click and by keyboard (Enter / Space);
 *   - "Export data" on Payroll runs carries EVERY run, folded months
 *     included — read from the downloaded CSV, not from the screen;
 *   - the IST boundary run is counted in October.
 *
 * Also saves desktop / 375 px, light / dark screenshots of both screens to
 * e2e/month-groups-shots (git-ignored; or MONTH_GROUPS_SHOTS). Not inside
 * test-results, which Playwright empties at the start of every run.
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { APP_URL, expect, fx, signIn, test } from "../support";
import { formatInr as formatPaise } from "@/lib/masters";
import * as XLSX from "xlsx";

// with-env.mjs passes only an allowlist of variables, so the default is a
// git-ignored folder beside the specs.
const SHOTS = process.env.MONTH_GROUPS_SHOTS || path.join(__dirname, "..", "month-groups-shots");

async function openPrincipal(
  browser: Browser,
  opts: { width: number; height: number; dark?: boolean },
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  await signIn(context, "principal");
  await context.addCookies([
    { name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL },
  ]);
  return context.newPage();
}

function monthHeader(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(`^${label}\\b`) });
}

async function openPayrollRuns(page: Page) {
  await page.goto("/payroll");
  // The tab strip settles once the viewer's payroll rights resolve.
  await page.getByRole("tab", { name: /^Runs$/ }).first().click({ timeout: 30_000 });
  await expect(monthHeader(page, "October 2026")).toBeVisible({ timeout: 30_000 });
}

async function openAutomationRuns(page: Page) {
  await page.goto("/masters?tab=automation");
  await page.getByRole("button", { name: /^Runs \(\d+\)/ }).click({ timeout: 30_000 });
  await expect(monthHeader(page, "October 2026")).toBeVisible({ timeout: 30_000 });
}

test.describe("month-grouped lists", () => {
  test("payroll runs: newest month open, older folded, toggles by click and keyboard", async ({ browser }) => {
    const page = await openPrincipal(browser, { width: 1440, height: 900 });
    await openPayrollRuns(page);

    const oct = monthHeader(page, "October 2026");
    const sep = monthHeader(page, "September 2026");
    const aug = monthHeader(page, "August 2026");
    await expect(oct).toHaveAttribute("aria-expanded", "true");
    await expect(sep).toHaveAttribute("aria-expanded", "false");
    await expect(aug).toHaveAttribute("aria-expanded", "false");
    await expect(oct).toContainText("2 runs");
    await expect(sep).toContainText("2 runs");
    await expect(aug).toContainText("1 run");

    // October's rows show; September's are in the DOM but folded.
    const octBody = page.locator(`[id="${await oct.getAttribute("aria-controls")}"]`);
    const sepBody = page.locator(`[id="${await sep.getAttribute("aria-controls")}"]`);
    await expect(octBody.locator("tr")).toHaveCount(2);
    await expect(octBody).toBeVisible();
    await expect(sepBody).toBeHidden();

    await sep.click();
    await expect(sep).toHaveAttribute("aria-expanded", "true");
    await expect(sepBody).toBeVisible();
    await expect(sepBody.locator("tr")).toHaveCount(2);

    await sep.focus();
    await page.keyboard.press("Enter");
    await expect(sep).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(sep).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect(sep).toHaveAttribute("aria-expanded", "false");

    // The row menu still works inside a group.
    await page.getByRole("button", { name: "Actions for run 2026-10" }).first().click();
    await expect(page.getByRole("menuitem", { name: "Open run" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.context().close();
  });

  test("payroll runs: Export data carries folded months too", async ({ browser }) => {
    const page = await openPrincipal(browser, { width: 1440, height: 900 });
    await openPayrollRuns(page);
    await expect(monthHeader(page, "August 2026")).toHaveAttribute("aria-expanded", "false");

    await page.getByRole("button", { name: "Export data" }).first().click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: /CSV/ }).click(),
    ]);
    const csv = fs.readFileSync(await download.path(), "utf8");
    const lines = csv.split(/\r?\n/).filter((l) => /2026-(08|09|10)/.test(l));
    expect(lines.length, `every run exported, folded or not:\n${csv}`).toBe(fx.payroll.runs.length);
    for (const m of ["2026-10", "2026-09", "2026-08"]) {
      expect(lines.filter((l) => l.includes(m)).length).toBe(fx.payroll.runs.filter((r) => r.month === m).length);
    }
    // No month header leaked into the export as a row.
    expect(csv).not.toMatch(/October 2026|September 2026|August 2026/);
    // And folding was put back after the read.
    await expect(monthHeader(page, "August 2026")).toHaveAttribute("aria-expanded", "false");
    const augBody = page.locator(`[id="${await monthHeader(page, "August 2026").getAttribute("aria-controls")}"]`);
    await expect(augBody).toBeHidden();
    await page.context().close();
  });

  test("automation runs: grouped by IST month, boundary run in October", async ({ browser }) => {
    const page = await openPrincipal(browser, { width: 1440, height: 900 });
    await openAutomationRuns(page);
    const oct = monthHeader(page, "October 2026");
    const sep = monthHeader(page, "September 2026");
    await expect(oct).toHaveAttribute("aria-expanded", "true");
    // 12 Oct, 5 Oct, and 20:00Z on 30 Sep (= 1 Oct 01:30 IST).
    await expect(oct).toContainText("3 runs");
    await expect(sep).toContainText("2 runs");
    await expect(sep).toHaveAttribute("aria-expanded", "false");
    await expect(monthHeader(page, "August 2026")).toContainText("1 run");
    await page.context().close();
  });

  test("screenshots: desktop and 375 px, light and dark", async ({ browser }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const dark of [false, true]) {
      for (const [w, h, tag] of [
        [1440, 900, "desktop"],
        [375, 812, "phone375"],
      ] as const) {
        const page = await openPrincipal(browser, { width: w, height: h, dark });
        const theme = dark ? "dark" : "light";
        await openPayrollRuns(page);
        await monthHeader(page, "October 2026").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `payroll-runs-${tag}-${theme}.png`), fullPage: true });
        // No sideways page scroll at phone width.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(1);
        await openAutomationRuns(page);
        await page.screenshot({ path: path.join(SHOTS, `automation-runs-${tag}-${theme}.png`), fullPage: true });
        await page.context().close();
      }
    }
  });
});

// ── Every other converted screen, on the seeded rows (e2e/growingLists.ts) ──

type Screen = {
  name: string;
  open: (page: Page) => Promise<void>;
  /** The first row menu inside the open month, when the screen has one. */
  rowMenu?: RegExp;
};

async function goAndWait(page: Page, url: string, then?: (page: Page) => Promise<void>) {
  await page.goto(url);
  if (then) await then(page);
  // This machine runs several builds at once; a cold screen can take a while.
  await expect(monthHeader(page, "October 2026")).toBeVisible({ timeout: 90_000 });
}

/**
 * Staff → Leave / Outdoor duty, reloaded until the history has loaded.
 *
 * KNOWN DEFECT, not this change's (15 Oct 2026): on a cold load these panels
 * often show "No leave requests for this year" / "No outdoor duty records
 * yet" although the desk holds the rows — 5 of 6 fresh loads of Leave in a
 * row did, for 30 s each. Both panels read the desk once on mount and re-read
 * only if THEIR ensure*Hydrated call did the hydration; when something else
 * hydrated the desk first, the panel never re-reads. That is loading code
 * under the data-layer freeze, so it is reported, not patched; this helper
 * retries so the grouping itself can be seen.
 */
const openStaffHistory = (url: string) => async (page: Page) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.goto(url);
    try {
      await expect(monthHeader(page, "October 2026")).toBeVisible({ timeout: 15_000 });
      return;
    } catch {
      /* the race above — load again */
    }
  }
  await expect(monthHeader(page, "October 2026")).toBeVisible({ timeout: 30_000 });
};
const openLeaveHistory = openStaffHistory("/staff?tab=leave");

const storeSection = (label: string) => async (page: Page) => {
  await page.getByRole("button", { name: label, exact: true }).click({ timeout: 30_000 });
};

const SCREENS: Screen[] = [
  { name: "fee-receipts", open: (p) => goAndWait(p, "/fees?tab=receipts") },
  { name: "charge-vouchers", open: (p) => goAndWait(p, "/fees?tab=vouchers") },
  { name: "fee-adjustments", open: (p) => goAndWait(p, "/fees?tab=adjustments") },
  { name: "staff-leave", open: openLeaveHistory, rowMenu: /Staff actions/ },
  { name: "outdoor-duty", open: openStaffHistory("/staff?tab=outdoor_duty"), rowMenu: /Staff actions/ },
  { name: "store-orders", open: (p) => goAndWait(p, "/inventory?tab=purchase", storeSection("Orders")), rowMenu: /Purchase order actions/ },
  { name: "store-receipts", open: (p) => goAndWait(p, "/inventory?tab=purchase", storeSection("Receive goods")) },
  { name: "store-bills", open: (p) => goAndWait(p, "/inventory?tab=purchase", storeSection("Bills to pay")) },
  { name: "store-returns", open: (p) => goAndWait(p, "/inventory?tab=purchase", storeSection("Returns")) },
  { name: "certificates", open: (p) => goAndWait(p, "/certificates") },
  {
    name: "payroll-audit",
    open: (p) =>
      goAndWait(p, "/payroll", async (page) => {
        await page.getByRole("tab", { name: /^Audit$/ }).first().click({ timeout: 30_000 });
      }),
  },
];

test.describe("month-grouped lists — every converted screen", () => {
  test.setTimeout(420_000);
  for (const sc of SCREENS) {
    test(`${sc.name}: newest month open, older folded; desktop-light + 375-dark`, async ({ browser }) => {
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const v of [
        { w: 1440, h: 900, dark: false, tag: "desktop-light" },
        { w: 375, h: 812, dark: true, tag: "phone375-dark" },
      ]) {
        const page = await openPrincipal(browser, { width: v.w, height: v.h, dark: v.dark });
        await sc.open(page);
        await expect(monthHeader(page, "October 2026")).toHaveAttribute("aria-expanded", "true");
        // Every older month is folded — unless it holds work still to do,
        // which its header says ("N need action").
        const heads = page.getByRole("button", { name: /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/ });
        const n = await heads.count();
        expect(n, "at least two months").toBeGreaterThan(1);
        for (let i = 1; i < n; i += 1) {
          const h = heads.nth(i);
          const needs = /need action/.test(await h.innerText());
          await expect(h).toHaveAttribute("aria-expanded", needs ? "true" : "false");
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(1);
        if (sc.rowMenu) {
          const octBody = page.locator(`[id="${await monthHeader(page, "October 2026").getAttribute("aria-controls")}"]`);
          await octBody.getByRole("button", { name: sc.rowMenu }).first().click();
          await expect(page.getByRole("menuitem").first()).toBeVisible();
          await page.keyboard.press("Escape");
        }
        // The app scrolls an inner pane; centre the list in it, then let any
        // smooth scroll settle before the picture.
        await monthHeader(page, "October 2026").evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SHOTS, `${sc.name}-${v.tag}.png`) });
        await page.context().close();
      }
    });
  }
});

test.describe("fee receipts and staff leave, on screen", () => {
  test.setTimeout(300_000);
  const receipts = fx.growing.receipts;
  const byMonth = new Map<string, { count: number; collected: number }>();
  for (const v of receipts) {
    const k = v.collectionDate.slice(0, 7);
    const m = byMonth.get(k) ?? { count: 0, collected: 0 };
    m.count += 1;
    if (!v.voidedAt) m.collected += v.totalPaise;
    byMonth.set(k, m);
  }
  const label = (k: string) =>
    `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;
  const rupeesIn = (t: string) => Number((/₹\s?([\d,]+(?:\.\d+)?)/.exec(t)?.[1] ?? "NaN").replace(/,/g, ""));

  test("receipts: header totals equal the receipts of that month", async ({ browser }) => {
    const page = await openPrincipal(browser, { width: 1440, height: 900 });
    await goAndWait(page, "/fees?tab=receipts");
    for (const [k, m] of byMonth) {
      const head = monthHeader(page, label(k));
      // From the fixture: count of receipts, ₹ collected without the voided one.
      await expect(head).toContainText(`${m.count} ${m.count === 1 ? "receipt" : "receipts"}`);
      await expect(head).toContainText(`${formatPaise(m.collected)} collected`);
      // From the screen: open the month and add up the amounts it lists.
      if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
      const list = page.locator(`[id="${await head.getAttribute("aria-controls")}"]`);
      const items = list.locator(":scope > li");
      await expect(items).toHaveCount(m.count);
      let sum = 0;
      for (let i = 0; i < m.count; i += 1) {
        const li = items.nth(i);
        const summary = li.locator("button").first();
        const text = (await summary.innerText()).replace(/\s+/g, " ");
        // A voided receipt still shows its amount, but it is not money collected.
        if ((await summary.getByText("Void", { exact: true }).count()) > 0) continue;
        sum += rupeesIn(text.slice(text.lastIndexOf("₹")));
      }
      expect(sum * 100, `${label(k)}: rows on screen add up to the header`).toBe(m.collected);
    }
    await page.context().close();
  });

  test("receipts: Export carries the folded months (CSV rows = filtered count)", async ({ browser }) => {
    const page = await openPrincipal(browser, { width: 1440, height: 900 });
    await goAndWait(page, "/fees?tab=receipts");
    await expect(monthHeader(page, "September 2026")).toHaveAttribute("aria-expanded", "false");
    await expect(monthHeader(page, "August 2026")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText(`Showing ${receipts.length} of ${receipts.length} receipts`)).toBeVisible();
    // The receipts screen's "Excel" button writes a real .xlsx workbook.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download Excel (CSV) of current filter" }).click(),
    ]);
    const book = XLSX.read(fs.readFileSync(await download.path()));
    const sheet = book.Sheets[book.SheetNames[0]!]!;
    const cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }).map((r) => r.map(String).join(" | "));
    const rows = cells.filter((l) => /E2E-R-\d{4}/.test(l));
    expect(rows.length, cells.join("\n")).toBe(receipts.length);
    for (const v of receipts) expect(rows.some((r) => r.includes(v.receiptNo)), v.receiptNo).toBe(true);
    // Exactly the folded months' receipts are in it too.
    for (const v of receipts.filter((x) => !x.collectionDate.startsWith("2026-10"))) {
      expect(rows.some((r) => r.includes(v.receiptNo))).toBe(true);
    }
    await page.context().close();
  });

  test("receipts: a search that matches a row in a folded month opens that month", async ({ browser }) => {
    const page = await openPrincipal(browser, { width: 1440, height: 900 });
    await goAndWait(page, "/fees?tab=receipts");
    const child = fx.growing.receiptSearchChild;
    const only = receipts.filter((v) => v.lines.some((l) => l.studentId === child.id));
    expect(only.map((v) => v.collectionDate.slice(0, 7))).toEqual(["2026-08"]);
    await expect(monthHeader(page, "August 2026")).toHaveAttribute("aria-expanded", "false");

    await page.getByPlaceholder("Name or adm no.").fill(child.fullName);
    const aug = monthHeader(page, "August 2026");
    await expect(aug).toHaveAttribute("aria-expanded", "true");
    await expect(aug).toContainText("1 receipt");
    await expect(monthHeader(page, "October 2026")).toHaveCount(0);
    const list = page.locator(`[id="${await aug.getAttribute("aria-controls")}"]`);
    await expect(list).toBeVisible();
    await expect(list.getByText(only[0]!.receiptNo)).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "fee-receipts-search-desktop-light.png") });

    // Clearing the search folds August again (the default: newest month only).
    await page.getByPlaceholder("Name or adm no.").fill("");
    await expect(monthHeader(page, "August 2026")).toHaveAttribute("aria-expanded", "false");
    await page.context().close();
  });

  test("staff leave: a pending leave keeps its older month open, with \"1 need action\"", async ({ browser }) => {
    const pending = fx.growing.staffHr.leaveRequests.filter((r) => r.status === "pending" || r.status === "pending_l2");
    expect(pending.map((r) => r.fromDate.slice(0, 7))).toEqual(["2026-08"]);
    const page = await openPrincipal(browser, { width: 1440, height: 900 });
    await openLeaveHistory(page);
    const aug = monthHeader(page, "August 2026");
    await expect(aug).toHaveAttribute("aria-expanded", "true");
    await expect(aug).toContainText("1 need action");
    // The header counts approved days only (Aug's are pending + rejected).
    await expect(aug).toContainText("0 days approved");
    await expect(monthHeader(page, "October 2026")).toContainText("3 days approved");
    await expect(monthHeader(page, "September 2026")).toHaveAttribute("aria-expanded", "false");
    await expect(monthHeader(page, "September 2026")).not.toContainText("need action");
    await aug.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "staff-leave-pending-desktop-light.png") });
    await page.context().close();
  });
});

