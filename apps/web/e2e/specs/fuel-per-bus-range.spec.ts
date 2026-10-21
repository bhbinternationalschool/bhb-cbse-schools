/**
 * fuel-per-bus-range — Transport → Fuel: the per-bus totals cover exactly the
 * period the fill list shows (21 Oct 2026).
 *
 * Before: a date range inside one month listed only the range's fills, but
 * the "Per bus" table (fills, quantity, ₹, km, ₹/km, km per unit) and its
 * Excel/PDF export were the WHOLE month's — 8–20 Sep listed 2 fills and
 * totalled 4.
 *
 * The case (e2e/fuelRangeCase.ts, seeded through the app's own write paths):
 * one CNG bus, fills on 3, 9, 16 and 24 Sep 2026 with odometer readings.
 * Asserted from the DOM and from the downloaded Excel:
 *   - 8–20 Sep: per-bus fills / kg / ₹ / km equal the sum of the visible
 *     list rows for that bus (2 fills, 15 kg, ₹1,350.50, 400 km);
 *   - the per-bus Excel says the same;
 *   - the whole of September: 4 fills, the month named in the heading.
 *
 * Saves desktop-light and 375 px-dark screenshots to e2e/fuel-range-shots
 * (git-ignored; or FUEL_RANGE_SHOTS).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Browser, Locator, Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { APP_URL, expect, signIn, test } from "../support";
import { FUEL_BUS, FUEL_FILLS, FUEL_RANGE } from "../fuelRangeCase";

const SHOTS = process.env.FUEL_RANGE_SHOTS || path.join(__dirname, "..", "fuel-range-shots");

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // Through tsx, like the stack's own seed (see e2e/fuelRangeCase.ts).
  execFileSync("npx", ["--yes", "tsx", path.join(__dirname, "..", "..", "..", "..", "scripts", "e2e-seed-fuel-range.ts")], {
    cwd: path.join(__dirname, "..", ".."),
    stdio: "inherit",
    env: process.env,
  });
});

async function open(browser: Browser, opts: { width: number; height: number; dark?: boolean }): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  await signIn(context, "principal");
  await context.addCookies([{ name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL }]);
  return context.newPage();
}

async function setDate(page: Page, part: "from" | "to", iso: string) {
  const input = page.getByTestId(`fuel-period-${part}`);
  await input.fill(iso);
  await input.blur();
}

/** The table's rows as { header: cell text }, for the rows naming the bus. */
async function busRows(section: Locator): Promise<Record<string, string>[]> {
  return section.locator("table").first().evaluate((table, reg) => {
    const heads = [...table.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
    return [...table.querySelectorAll("tbody tr")]
      .filter((tr) => (tr.textContent ?? "").includes(reg))
      .map((tr) => {
        const out: Record<string, string> = {};
        [...tr.querySelectorAll("td")].forEach((td, i) => {
          out[heads[i] ?? String(i)] = (td.textContent ?? "").trim();
        });
        return out;
      });
  }, FUEL_BUS.registrationNo);
}

const paiseOf = (s: string) => Math.round(Number(s.replace(/[^0-9.]/g, "")) * 100);
const leadingNumber = (s: string) => Number((/[\d,.]+/.exec(s)?.[0] ?? "").replace(/,/g, ""));

/** Pick From..To and wait until the list shows the bus (the server's desk read may lag the seed). */
async function showPeriod(page: Page, from: string, to: string, expectedFills: number) {
  await page.goto("/transport?tab=fuel");
  await expect(page.getByTestId("fuel-period-month")).toBeVisible({ timeout: 90_000 });
  // From first only when it is not after the current To (both stay valid).
  await setDate(page, "from", from);
  await setDate(page, "to", to);
  await expect(page.getByTestId("fuel-period-from")).toHaveValue(from);
  await expect(page.getByTestId("fuel-period-to")).toHaveValue(to);
  await expect(async () => {
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    expect(await busRows(page.getByTestId("fuel-log"))).toHaveLength(expectedFills);
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
}

test("a range inside a month: per-bus totals = the visible rows", async ({ browser }) => {
  const page = await open(browser, { width: 1440, height: 900 });
  const inRange = FUEL_FILLS.filter((f) => f.fillDate >= FUEL_RANGE.from && f.fillDate <= FUEL_RANGE.to);
  expect(inRange.map((f) => f.id)).toEqual(["e2e_fuelr_2", "e2e_fuelr_3"]);
  await showPeriod(page, FUEL_RANGE.from, FUEL_RANGE.to, inRange.length);

  const listed = await busRows(page.getByTestId("fuel-log"));
  const listedPaise = listed.reduce((s, r) => s + paiseOf(r["Amount"] ?? ""), 0);
  const listedKg = listed.reduce((s, r) => s + leadingNumber(r["Quantity"] ?? ""), 0);
  const listedKm = listed.reduce((s, r) => s + leadingNumber(r["Km since last"] ?? ""), 0);
  expect(listedPaise).toBe(135_050);
  expect(listedKg).toBe(15);
  expect(listedKm).toBe(400);

  const perBus = page.getByTestId("fuel-per-bus");
  await expect(page.getByTestId("fuel-per-bus-heading")).toHaveText(/^Per bus — 8 Sept? 2026 → 20 Sept? 2026$/);
  await expect.poll(async () => (await busRows(perBus)).length).toBe(1);
  const [bus] = await busRows(perBus);
  expect(Number(bus!["Fills"]), "per-bus fills = visible rows").toBe(listed.length);
  expect(leadingNumber(bus!["Quantity"] ?? ""), "per-bus kg = visible rows").toBe(listedKg);
  expect(paiseOf(bus!["₹"] ?? ""), "per-bus ₹ = visible rows").toBe(listedPaise);
  expect(leadingNumber(bus!["Km"] ?? ""), "per-bus km = visible rows' km since last").toBe(listedKm);
  expect(bus!["Km per unit"]).toBe("26.67 km/kg");

  // The per-bus Excel is the same period.
  await perBus.getByRole("button", { name: "Export data" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /Excel/ }).click(),
  ]);
  expect(download.suggestedFilename()).toContain(`${FUEL_RANGE.from}-${FUEL_RANGE.to}`);
  const wb = XLSX.readFile(await download.path());
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true });
  const head = aoa.findIndex((r) => r.map(String).includes("Fills"));
  expect(head, "Excel has the per-bus header").toBeGreaterThanOrEqual(0);
  const cols = aoa[head]!.map(String);
  const row = aoa.slice(head + 1).find((r) => r.map(String).some((c) => c.includes(FUEL_BUS.registrationNo)));
  expect(row, "Excel has the bus").toBeTruthy();
  expect(Number(row![cols.indexOf("Fills")])).toBe(2);
  expect(Number(row![cols.indexOf("₹")])).toBe(135_050);
  await page.context().close();
});

test("the whole month: per-bus totals = the month's rows, month named", async ({ browser }) => {
  const page = await open(browser, { width: 1440, height: 900 });
  await showPeriod(page, "2026-09-01", "2026-09-30", FUEL_FILLS.length);
  await expect(page.getByTestId("fuel-per-bus-heading")).toHaveText("Per bus — September 2026");
  const [bus] = await busRows(page.getByTestId("fuel-per-bus"));
  expect(Number(bus!["Fills"])).toBe(4);
  expect(paiseOf(bus!["₹"] ?? "")).toBe(FUEL_FILLS.reduce((s, f) => s + f.amountPaise, 0));
  await page.context().close();
});

test("screenshots: desktop light and 375 px dark", async ({ browser }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h, dark, tag] of [
    [1440, 900, false, "desktop-light"],
    [375, 812, true, "phone375-dark"],
  ] as const) {
    const page = await open(browser, { width: w, height: h, dark });
    await showPeriod(page, FUEL_RANGE.from, FUEL_RANGE.to, 2);
    await expect(page.getByTestId("fuel-per-bus-heading")).toHaveText(/^Per bus — 8 Sept? 2026 → 20 Sept? 2026$/);
    await page.screenshot({ path: path.join(SHOTS, `fuel-per-bus-range-${tag}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(1);
    await page.context().close();
  }
});
