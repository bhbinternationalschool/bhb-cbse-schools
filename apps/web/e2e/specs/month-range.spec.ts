/**
 * month-range — the month box and From / To always describe one period
 * (lib/monthRange.ts, components/ui/month-range-filter.tsx).
 *
 * Director, 15 Oct 2026: "check wherever the month and date-range filters
 * are available — they are not respecting each other." Before this change
 * the report screens kept Month and From/To as two unrelated values and the
 * report read one or the other (or both, ANDed) — Month = October next to a
 * September range showed September (or nothing).
 *
 * Asserted, from the DOM and from downloaded files:
 *   - picking a month sets From / To to its first..last day;
 *   - editing From or To turns the month box to "Custom", and back to the
 *     month when the range is exactly one whole month again;
 *   - a month-only report snaps the boxes to the month it reads;
 *   - the period is remembered per browser and comes back consistent;
 *   - the list / totals / export read the range: Staff → Reports (leave
 *     rows and "Used" days from e2e/growingLists.ts) and Payroll → Reports
 *     (month summary Excel, runs from e2e/fixture.ts).
 *
 * Saves desktop-light and 375 px-dark screenshots to e2e/month-range-shots
 * (git-ignored; or MONTH_RANGE_SHOTS).
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { APP_URL, expect, signIn, test } from "../support";
import { istThisMonth, monthBounds, monthName } from "@/lib/monthRange";

// The screens open on "this month" by the real clock; derive it so the
// spec keeps passing after October 2026.
const THIS_MONTH = istThisMonth();
const LAST_MONTH = (() => {
  const [y, m] = THIS_MONTH.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
})();
const THIS_B = monthBounds(THIS_MONTH)!;
const LAST_B = monthBounds(LAST_MONTH)!;

const SHOTS = process.env.MONTH_RANGE_SHOTS || path.join(__dirname, "..", "month-range-shots");

async function openPrincipal(
  browser: Browser,
  opts: { width: number; height: number; dark?: boolean } = { width: 1440, height: 900 },
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  await signIn(context, "principal");
  await context.addCookies([{ name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL }]);
  return context.newPage();
}

/** "1 Sep 2026" as the screen prints it (en-IN; ICU may say "Sept"). */
function dayLabelRe(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]!;
  return `${d} ${mon}${mon === "Sep" ? "t?" : ""} ${y}`;
}

const box = (page: Page, prefix: string, part: "month" | "from" | "to" | "day") =>
  page.getByTestId(`${prefix}-${part}`);

async function setDate(page: Page, prefix: string, part: "from" | "to", iso: string) {
  const input = box(page, prefix, part);
  await input.fill(iso);
  await input.blur();
}

/** The month box shows this label (selected option text). */
async function expectMonthLabel(page: Page, prefix: string, label: string) {
  await expect
    .poll(async () => box(page, prefix, "month").evaluate((el) => {
      const s = el as HTMLSelectElement;
      return s.options[s.selectedIndex]?.text ?? "";
    }))
    .toBe(label);
}

async function expectRange(page: Page, prefix: string, from: string, to: string) {
  await expect(box(page, prefix, "from")).toHaveValue(from);
  await expect(box(page, prefix, "to")).toHaveValue(to);
}

async function openPayrollReports(page: Page) {
  await page.goto("/payroll");
  // The tab strip settles once the viewer's payroll rights resolve.
  await page.getByRole("tab", { name: /^Reports$/ }).first().click({ timeout: 60_000 });
}

// ── Staff → Reports (leave) ───────────────────────────────────────────

async function openStaffReports(page: Page) {
  await page.goto("/staff?tab=reports");
  await expect(page.getByRole("button", { name: "Month Wise Leave Report" })).toBeVisible({ timeout: 90_000 });
}

async function pickReport(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: label, exact: true })).toBeVisible();
}

async function previewRows(page: Page): Promise<string[][]> {
  await page.getByRole("button", { name: "Run report", exact: true }).click();
  const table = page.locator("table").last();
  await expect(table).toBeVisible();
  return table.locator("tbody tr").evaluateAll((trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim())),
  );
}

/** Sum of the "Used" column of Staff Wise Leave Summary. */
async function usedDays(page: Page): Promise<number> {
  const rows = await previewRows(page);
  const headers = await page.locator("table").last().locator("thead th").allTextContents();
  const col = headers.findIndex((h) => h.trim().startsWith("Used"));
  expect(col, `Used column in ${headers.join("|")}`).toBeGreaterThanOrEqual(0);
  return rows.reduce((n, r) => n + (Number(r[col]) || 0), 0);
}

test.describe("month ↔ range filters", () => {
  test("staff leave reports: month sets the range, range edits read Custom, lists follow the range", async ({ browser }) => {
    const page = await openPrincipal(browser);
    await openStaffReports(page);
    const P = "month-range";

    // A month-only report: September → 1 leave (22–24 Sep), October → 2.
    await pickReport(page, "Month Wise Leave Report");
    await box(page, P, "month").selectOption("2026-09");
    let rows = await previewRows(page);
    expect(rows.filter((r) => r.some((c) => c.includes("2026-09-22")))).toHaveLength(1);
    expect(rows.filter((r) => r.length > 1)).toHaveLength(1);
    await box(page, P, "month").selectOption("2026-10");
    rows = await previewRows(page);
    expect(rows.filter((r) => r.length > 1)).toHaveLength(2);

    // A range report opens on the SAME period the month box held.
    await pickReport(page, "Staff Wise Leave Summary");
    await expectMonthLabel(page, P, "October 2026");
    await expectRange(page, P, "2026-10-01", "2026-10-31");
    expect(await usedDays(page), "October: 2 + 1 approved days").toBe(3);

    // Month → range.
    await box(page, P, "month").selectOption("2026-09");
    await expectRange(page, P, "2026-09-01", "2026-09-30");
    expect(await usedDays(page), "September: 3 approved days").toBe(3);

    // Range → "Custom": From 1 Sep, To 31 Oct spans two months.
    await setDate(page, P, "to", "2026-10-31");
    await expectMonthLabel(page, P, "Custom");
    expect(await usedDays(page), "1 Sep – 31 Oct: 3 + 3 days").toBe(6);

    // Range back to exactly one month → the month again.
    await setDate(page, P, "from", "2026-10-01");
    await expectMonthLabel(page, P, "October 2026");
    expect(await usedDays(page)).toBe(3);

    // A From after To moves To with it (never an inverted range).
    await setDate(page, P, "from", "2026-11-05");
    await expectRange(page, P, "2026-11-05", "2026-11-05");
    await expectMonthLabel(page, P, "Custom");

    // A custom range, then a month-only report: the boxes snap to the month
    // the report reads (the month the range ends in).
    await setDate(page, P, "from", "2026-09-15");
    await setDate(page, P, "to", "2026-10-10");
    await expectMonthLabel(page, P, "Custom");
    await pickReport(page, "Month Wise Leave Report");
    await expectMonthLabel(page, P, "October 2026");

    // Remembered per browser, and restored consistent.
    await box(page, P, "month").selectOption("2026-08");
    await page.reload();
    await expect(page.getByRole("button", { name: "Month Wise Leave Report" })).toBeVisible({ timeout: 90_000 });
    await pickReport(page, "Staff Wise Leave Summary");
    await expectMonthLabel(page, P, "August 2026");
    await expectRange(page, P, "2026-08-01", "2026-08-31");
    await page.context().close();
  });

  test("student attendance reports: one period across reports, bounded by the session", async ({ browser }) => {
    const page = await openPrincipal(browser);
    await page.goto("/attendance?tab=student-reports");
    await expect(page.getByRole("button", { name: "Student Wise Attendance Report" })).toBeVisible({ timeout: 90_000 });
    const P = "month-range";

    // Range report: opens on the session to date, which is not one month.
    await pickReport(page, "Student Absent Report");
    await expect(box(page, P, "from")).toHaveValue("2026-04-01");
    await expectMonthLabel(page, P, "Custom");
    // The old separate Date box (ignored whenever From/To were set) is gone.
    await expect(box(page, P, "day")).toHaveCount(0);

    await box(page, P, "month").selectOption("2026-10");
    await expectRange(page, P, "2026-10-01", "2026-10-31");
    await setDate(page, P, "from", "2026-09-01");
    await expectMonthLabel(page, P, "Custom");

    // The session (2026-27) bounds the range: 1 Mar 2026 is clipped to 1 Apr.
    await setDate(page, P, "from", "2026-03-01");
    await expect(box(page, P, "from")).toHaveValue("2026-04-01");
    const months = await box(page, P, "month").locator("option").allTextContents();
    expect(months).toContain("April 2026");
    expect(months).toContain("March 2027");
    expect(months).not.toContain("March 2026");

    // Date-or-month report: a day sets From = To, a month clears the day.
    await pickReport(page, "Class / Section Wise Attendance Report");
    // Snapped from the custom range to the month it ends in.
    await expectMonthLabel(page, P, "October 2026");
    const day = box(page, P, "day");
    await day.fill("2026-10-07");
    await day.blur();
    await expectMonthLabel(page, P, "Custom");
    await box(page, P, "month").selectOption("2026-09");
    await expect(day).toHaveValue("");
    await page.getByRole("button", { name: "Run report", exact: true }).click();
    await expect(page.getByText("Class / Section Attendance — 2026-09")).toBeVisible();
    await page.context().close();
  });

  test("payroll reports: whole-month range, single month reads Custom, export follows the range", async ({ browser }) => {
    const page = await openPrincipal(browser);
    await openPayrollReports(page);
    await expect(page.getByRole("heading", { name: "Payroll reports" })).toBeVisible({ timeout: 90_000 });
    const P = "month-range";
    await page.getByLabel("Run status").selectOption("all");

    const exportSummary = async (): Promise<string[]> => {
      const card = page.locator('[data-report-id="month_summary"]');
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        card.getByRole("button", { name: "Excel" }).click(),
      ]);
      const wb = XLSX.readFile(await download.path());
      const sheet = wb.Sheets[wb.SheetNames[0]!]!;
      const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false });
      return aoa.map((r) => String(r[0] ?? "")).filter((c) => /^2026-\d{2}$/.test(c));
    };

    await box(page, P, "month").selectOption("2026-09");
    await expect(box(page, P, "from")).toHaveValue("2026-09");
    await expect(box(page, P, "to")).toHaveValue("2026-09");
    expect((await exportSummary()).sort()).toEqual(["2026-09", "2026-09"]);

    await box(page, P, "to").selectOption("2026-10");
    await expectMonthLabel(page, P, "Custom");
    expect((await exportSummary()).sort()).toEqual(["2026-09", "2026-09", "2026-10", "2026-10"]);

    // To before From moves From with it.
    await box(page, P, "to").selectOption("2026-08");
    await expect(box(page, P, "from")).toHaveValue("2026-08");
    await expectMonthLabel(page, P, "August 2026");
    expect(await exportSummary()).toEqual(["2026-08"]);
    await page.context().close();
  });

  test("fuel register: month and range in step, per-bus totals for the same dates", async ({ browser }) => {
    const page = await openPrincipal(browser);
    await page.goto("/transport?tab=fuel");
    const P = "fuel-period";
    await expect(box(page, P, "month")).toBeVisible({ timeout: 90_000 });
    await expectMonthLabel(page, P, monthName(THIS_MONTH));
    await expectRange(page, P, THIS_B.from, THIS_B.to);

    await page.getByRole("button", { name: "Last month" }).click();
    await expectMonthLabel(page, P, monthName(LAST_MONTH));
    await expectRange(page, P, LAST_B.from, LAST_B.to);
    await expect(page.getByTestId("fuel-per-bus-heading")).toHaveText(`Per bus — ${monthName(LAST_MONTH)}`, { timeout: 30_000 });

    // A range across two months: Custom, and the per-bus table covers the
    // same dates (21 Oct 2026 — it used to stay on one whole month; the sums
    // are proven in fuel-per-bus-range.spec.ts).
    await setDate(page, P, "to", `${THIS_MONTH}-10`);
    await expectMonthLabel(page, P, "Custom");
    await expect(page.getByTestId("fuel-per-bus-heading")).toHaveText(
      new RegExp(`^Per bus — ${dayLabelRe(LAST_B.from)} → ${dayLabelRe(`${THIS_MONTH}-10`)}$`),
      { timeout: 30_000 },
    );
    await box(page, P, "month").selectOption(THIS_MONTH);
    await expectRange(page, P, THIS_B.from, THIS_B.to);
    await expect(page.getByTestId("fuel-per-bus-heading")).toHaveText(`Per bus — ${monthName(THIS_MONTH)}`, { timeout: 30_000 });
    await page.context().close();
  });

  test("screenshots: desktop light and 375 px dark", async ({ browser }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [w, h, dark, tag] of [
      [1440, 900, false, "desktop-light"],
      [375, 812, true, "phone375-dark"],
    ] as const) {
      const page = await openPrincipal(browser, { width: w, height: h, dark });
      await openStaffReports(page);
      await pickReport(page, "Staff Wise Leave Summary");
      await setDate(page, "month-range", "from", "2026-09-01");
      await setDate(page, "month-range", "to", "2026-10-31");
      await expectMonthLabel(page, "month-range", "Custom");
      await page.getByRole("button", { name: "Run report", exact: true }).click();
      await page.screenshot({ path: path.join(SHOTS, `staff-leave-reports-${tag}.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(1);

      await openPayrollReports(page);
      await expect(page.getByRole("heading", { name: "Payroll reports" })).toBeVisible({ timeout: 90_000 });
      await box(page, "month-range", "month").selectOption("2026-09");
      await expect(box(page, "month-range", "from")).toHaveValue("2026-09");
      await page.screenshot({ path: path.join(SHOTS, `payroll-reports-${tag}.png`), fullPage: true });

      await page.goto("/transport?tab=fuel");
      await expect(box(page, "fuel-period", "month")).toBeVisible({ timeout: 90_000 });
      await page.getByRole("button", { name: "Last month" }).click();
      await expectRange(page, "fuel-period", LAST_B.from, LAST_B.to);
      await expect(page.getByTestId("fuel-per-bus-heading")).toHaveText(`Per bus — ${monthName(LAST_MONTH)}`, { timeout: 30_000 });
      await page.screenshot({ path: path.join(SHOTS, `fuel-register-${tag}.png`), fullPage: true });

      await page.goto("/attendance?tab=student-reports");
      await expect(page.getByRole("button", { name: "Student Absent Report" })).toBeVisible({ timeout: 90_000 });
      await pickReport(page, "Student Absent Report");
      await page.screenshot({ path: path.join(SHOTS, `student-attendance-reports-${tag}.png`), fullPage: true });
      await page.context().close();
    }
  });
});
