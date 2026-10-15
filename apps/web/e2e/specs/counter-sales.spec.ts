/**
 * counter-sales — Store → Counter → Sales pages through the server.
 *
 * Until 15 Oct 2026 the list asked for page 1 (50 sales) and had no way to
 * the next page: every older sale was reachable only by search. The fixture
 * posts 62 walk-in sales through the counter's own posting function
 * (e2e/seed.ts → postSale → inv_post_sale), one a day from 1 Aug 2026, every
 * tenth left unpaid (e2e/growingLists.ts STORE_PLAN.counterSales).
 *
 * Asserted, from the DOM:
 *   - page 1 shows the newest 50 and says "1–50 of 62";
 *   - "Older sales" reaches the other 12 — every seeded sale is on screen
 *     exactly once across the pages;
 *   - the "Outstanding" tile counts ALL unpaid sales, including the ones
 *     only on page 2 (it is a server total, not a sum of the loaded page);
 *   - the Unpaid list carries every unpaid sale.
 *
 * Saves desktop-light + 375-dark screenshots to e2e/counter-sales-shots
 * (git-ignored; or COUNTER_SALES_SHOTS).
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { APP_URL, expect, signIn, test } from "../support";
import { formatPaise } from "@/lib/inventory/types";
import { STORE_PLAN } from "../growingLists";

const SHOTS = process.env.COUNTER_SALES_SHOTS || path.join(__dirname, "..", "counter-sales-shots");
const SALES = STORE_PLAN.counterSales;
const UNPAID = SALES.filter((s) => s.paidPaise === 0);

async function openPrincipal(browser: Browser, opts: { width: number; height: number; dark?: boolean }): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  await signIn(context, "principal");
  await context.addCookies([{ name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL }]);
  return context.newPage();
}

async function openSales(page: Page, which: "Sales" | "Unpaid" = "Sales") {
  await page.goto("/inventory?tab=counter");
  await page.getByRole("button", { name: which, exact: true }).click({ timeout: 90_000 });
  await expect(page.getByTestId("sales-range")).toBeVisible({ timeout: 60_000 });
}

/** Buyer names on the current page, read from the table. */
async function buyersOnScreen(page: Page): Promise<string[]> {
  const cells = page.locator("tbody tr td:nth-child(2) > div:first-child");
  return (await cells.allInnerTexts()).map((t) => t.trim());
}

test.describe("counter sales — server paging", () => {
  test.setTimeout(300_000);

  test("every sale is reachable; Outstanding counts the sales not on page 1", async ({ browser }) => {
    const page = await openPrincipal(browser, { width: 1440, height: 900 });
    await openSales(page);

    const range = page.getByTestId("sales-range");
    await expect(range).toContainText(`1–50 of ${SALES.length} sales`);
    const first = await buyersOnScreen(page);
    expect(first).toHaveLength(50);
    expect(first[0], "newest first").toBe(SALES[SALES.length - 1]!.buyerName);

    await page.getByRole("button", { name: "Older sales" }).click();
    await expect(range).toContainText(`51–${SALES.length} of ${SALES.length} sales`);
    await expect(page.getByRole("button", { name: "Older sales" })).toBeDisabled();
    const second = await buyersOnScreen(page);
    expect(second).toHaveLength(SALES.length - 50);
    expect(second[second.length - 1], "the oldest sale is on the last page").toBe(SALES[0]!.buyerName);

    const seen = [...first, ...second];
    expect(new Set(seen).size, "no sale shown twice").toBe(seen.length);
    expect([...seen].sort()).toEqual(SALES.map((s) => s.buyerName).sort());

    // Back to the newest page.
    await page.getByRole("button", { name: "Newer sales" }).click();
    await expect(range).toContainText(`1–50 of ${SALES.length} sales`);

    // The Outstanding tile: every unpaid sale, wherever it sits in the list.
    const owed = UNPAID.reduce((t, s) => t + s.unitPricePaise, 0);
    const onPageOne = new Set(first);
    expect(UNPAID.some((s) => !onPageOne.has(s.buyerName)), "the fixture puts unpaid sales beyond page 1").toBe(true);
    const tile = page.locator("div.rounded-xl", { has: page.getByText("Outstanding", { exact: true }) }).first();
    await expect(tile).toContainText(formatPaise(owed));
    await expect(tile).toContainText(`${UNPAID.length} unpaid`);

    // The Unpaid list holds every one of them.
    await page.getByRole("button", { name: "Unpaid", exact: true }).click();
    await expect(page.getByTestId("sales-range")).toContainText(`${UNPAID.length} unpaid sales`);
    expect((await buyersOnScreen(page)).sort()).toEqual(UNPAID.map((s) => s.buyerName).sort());
    await page.context().close();
  });

  test("screens: desktop-light + 375-dark", async ({ browser }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const v of [
      { w: 1440, h: 900, dark: false, tag: "desktop-light" },
      { w: 375, h: 812, dark: true, tag: "phone375-dark" },
    ]) {
      const page = await openPrincipal(browser, { width: v.w, height: v.h, dark: v.dark });
      await openSales(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(SHOTS, `counter-sales-top-${v.tag}.png`) });
      await page.getByTestId("sales-range").evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(SHOTS, `counter-sales-pager-${v.tag}.png`) });
      await page.context().close();
    }
  });
});
