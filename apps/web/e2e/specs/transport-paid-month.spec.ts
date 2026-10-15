/**
 * transport-paid-month — a paid transport month stays paid when the child's
 * stop changes (production, 15 Oct 2026: Anvi Yadav).
 *
 * The exact shape, written through the app's own server write paths
 * (pushTransportDeskToDb — the transport-desk POST; pushFeeDeskToDb — the
 * fee-desk POST), for one fixture child no other spec touches:
 *
 *   old assignment  Apr–Aug, stop id that NO LONGER EXISTS on the route, no
 *                   fee of its own (stop-id churn) → the engine bills it ₹0
 *   new assignment  from 1 Sep (backdated over the paid September), ₹500
 *   receipts        Apr–Aug ₹500 each under the OLD id; September ₹500
 *                   under the OLD id, collected 10 Sep
 *
 * Asserted from the DOM, on the fee counter (Fee Take) and on the student's
 * fee card: April–September PAID, October owing ₹500, nothing else owing on
 * transport. On the old code September showed ₹500 owing and April–August
 * were missing altogether.
 *
 * Writes to the stack, so it runs in its own project after the readers.
 * Screenshots: e2e/transport-paid-shots (git-ignored), desktop-light and
 * phone-375-dark.
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { APP_URL, expect, signIn, test } from "../support";
import { execFileSync } from "node:child_process";
import { createServiceSupabase } from "@/lib/supabase/server";
import { CHILD, NEW, MONTH_NAMES, APR_SEP } from "../transportPaidCase";

const SHOTS = process.env.TRANSPORT_PAID_SHOTS || path.join(__dirname, "..", "transport-paid-shots");

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

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  expect(CHILD, "fixture has a spare current-year child").toBeTruthy();
  // Through tsx, like the stack's own seed (see e2e/transportPaidCase.ts).
  execFileSync("npx", ["--yes", "tsx", path.join(__dirname, "..", "..", "..", "..", "scripts", "e2e-seed-transport-paid.ts")], {
    cwd: path.join(__dirname, "..", ".."),
    stdio: "inherit",
    env: process.env,
  });
  fs.mkdirSync(SHOTS, { recursive: true });
});

test("open dues on the server: October owing, September not", async ({ browser }) => {
  // fee_desk_open_dues — the table the parent app, pay links, reminders and
  // defaulter lists read — rebuilt by the app's own route.
  const page = await open(browser, { width: 1440, height: 900 });
  const res = await page.request.post(`/api/fees/rebuild-open-dues?ay=${CHILD.academicYearCode}`);
  expect(res.status(), await res.text()).toBe(200);
  await page.context().close();
  const sb = createServiceSupabase()!;
  const { data, error } = await sb
    .from("fee_desk_open_dues")
    .select("due_key, balance_paise")
    .eq("student_id", CHILD.id)
    .like("due_key", "transport:%");
  expect(error).toBeNull();
  const rows = (data ?? []).map((r) => ({ key: String(r.due_key), bal: Number(r.balance_paise) }));
  expect(rows.filter((r) => r.key.endsWith(":2026-09"))).toEqual([]);
  expect(rows.filter((r) => r.key.endsWith(":2026-10"))).toEqual([
    { key: `transport:${CHILD.id}:${NEW}:2026-10`, bal: 50000 },
  ]);
});


async function openFeeCounter(page: Page): Promise<void> {
  await page.goto(`/fees?q=${encodeURIComponent(CHILD.admissionNo || CHILD.fullName)}`);
  await page.getByText(CHILD.fullName, { exact: false }).first().click({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^October 2026/ })).toBeVisible({ timeout: 30_000 });
}

for (const shot of [
  { name: "desktop-light", width: 1440, height: 900, dark: false },
  { name: "phone375-dark", width: 375, height: 812, dark: true },
]) {
  test(`fee counter (${shot.name}): April–September paid, October owing`, async ({ browser }) => {
    const page = await open(browser, shot);
    await openFeeCounter(page);
    // Every paid month is listed as paid — September under the new stop,
    // April–August from the receipts of an assignment that bills nothing now.
    for (const ym of APR_SEP) {
      const label = `${MONTH_NAMES[ym]} 2026`;
      await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
      await expect(
        page.getByRole("checkbox", { name: `Transport · ${label} paid` }),
        `${label} transport shows as paid`,
      ).toBeVisible();
    }
    // October is the one transport month owing.
    await expect(page.getByRole("checkbox", { name: "Transport · October 2026 paid" })).toHaveCount(0);
    await expect(page.getByText("Transport · October 2026").first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `fee-counter-${shot.name}.png`), fullPage: true });
    await page.context().close();
  });
}

test("student fee card: October transport owing, September not", async ({ browser }) => {
  for (const shot of [
    { name: "desktop-light", width: 1440, height: 900, dark: false },
    { name: "phone375-dark", width: 375, height: 812, dark: true },
  ]) {
    const page = await open(browser, shot);
    await page.goto(`/students/${CHILD.id}/edit`);
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Fees" }) });
    await expect(card.getByText("Pending dues")).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText(/Transport · October 2026/)).toBeVisible();
    await expect(card.getByText(/Transport · September 2026/)).toHaveCount(0);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `student-card-${shot.name}.png`), fullPage: true });
    await page.context().close();
  }
});
