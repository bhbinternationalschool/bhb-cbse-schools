/**
 * transport-paid-month — a paid transport month stays paid when the child's
 * stop changes (production, 15 Oct 2026: Anvi Yadav).
 *
 * The exact shape, written through the app's own server write paths
 * (pushTransportDeskToDb — the transport-desk POST; pushFeeDeskToDb — the
 * fee-desk POST), for one fixture child no other spec pays for
 * (e2e/transportPaidCase.ts OFFICE_CASE; dues-screens-transport reads it too):
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
import { teachingMastersSubset } from "@/lib/mastersTeachingSubset";
// lib/transportAmend PAID_MONTHS_UNKNOWN_FOR_ROLE (not imported: it pulls lib/fees into the test runner).
const PAID_MONTHS_UNKNOWN_FOR_ROLE = /^Paid months cannot be checked for your role/;

/**
 * Answer GET views/masters the way the server answers someone without the
 * Masters grant (a transport in-charge): scope "teaching", the book cut to
 * TEACHING_MASTERS_KEYS — fee groups, heads, structure and concessions
 * withheld. The real answer is fetched and cut with the server's own
 * function (lib/mastersTeachingSubset), so only the scope differs.
 */
async function answerTeachingScope(page: Page): Promise<() => number> {
  let hits = 0;
  await page.route("**/api/data/views/masters", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { ok: boolean; data?: { scope: string; masters: Record<string, unknown> } };
    if (body.ok && body.data) {
      hits += 1;
      body.data = {
        scope: "teaching",
        masters: { version: body.data.masters.version, ...teachingMastersSubset(body.data.masters) },
      };
    }
    await route.fulfill({ response: res, json: body });
  });
  return () => hits;
}

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

/** The case is written under tsx, like the stack's own seed (see e2e/transportPaidCase.ts). */
function seed(step = ""): void {
  execFileSync("npx", ["--yes", "tsx", path.join(__dirname, "..", "..", "..", "..", "scripts", "e2e-seed-transport-paid.ts")], {
    cwd: path.join(__dirname, "..", ".."),
    stdio: "inherit",
    env: { ...process.env, TPM_STEP: step, TPM_CASE: "" },
  });
}

test.beforeAll(async () => {
  expect(CHILD, "fixture has a spare current-year child").toBeTruthy();
  // Through tsx, like the stack's own seed (see e2e/transportPaidCase.ts).
  seed();
  fs.mkdirSync(SHOTS, { recursive: true });
});

test("open dues on the server: October owing, September not", async ({ browser }) => {
  // fee_desk_open_dues — the table the parent app, pay links, reminders and
  // defaulter lists read — rebuilt by the app's own route. The route computes
  // from the server's school mirror, which re-reads the database on a 45 s
  // TTL; the seed wrote the receipts from another process, so the rebuild is
  // retried until the mirror has them (CI, 15 Oct: the first rebuild ran on
  // a mirror hydrated by earlier specs, before the seed).
  const page = await open(browser, { width: 1440, height: 900 });
  const sb = createServiceSupabase()!;
  await expect(async () => {
    const res = await page.request.post(`/api/fees/rebuild-open-dues?ay=${CHILD.academicYearCode}`);
    expect(res.status(), await res.text()).toBe(200);
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
  }).toPass({ timeout: 90_000, intervals: [5_000, 10_000, 15_000] });
  await page.context().close();
});

async function openFeeCounter(page: Page): Promise<void> {
  await page.goto(`/fees?tab=collect&q=${encodeURIComponent(CHILD.admissionNo || CHILD.fullName)}`);
  await page
    .getByRole("button", { name: new RegExp(CHILD.admissionNo || CHILD.fullName) })
    .first()
    .click({ timeout: 30_000 });
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
    await expect(card.getByText("Pending dues", { exact: true })).toBeVisible({ timeout: 30_000 });
    // The pending-dues table (the first one; the second is payment history,
    // which rightly lists the September receipt).
    const pending = card.locator("table").first();
    await expect(pending.getByText(/Transport · October 2026/)).toBeVisible();
    await expect(pending.getByText(/Transport · September 2026/)).toHaveCount(0);
    await expect(card.getByText("Outstanding").locator("..")).toContainText("₹500");
    // And the payment history still shows every receipt, September included.
    await expect(card.getByText("Paid ₹3,000")).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `student-card-${shot.name}.png`), fullPage: true });
    await page.context().close();
  }
});

// 2.1i review: the amend dialog's paid-month floor is computed from the
// screen's Masters book. For a teaching-scope answer (fee lists withheld) it
// must refuse — on the old code it computed from the withheld book and
// offered "Applies from October" as if the floor were known.
for (const shot of [
  { name: "desktop-light", width: 1440, height: 900, dark: false },
  { name: "phone375-dark", width: 375, height: 812, dark: true },
]) {
  test(`amend dialog (${shot.name}): teaching-scope Masters refuses; full scope applies from Oct 2026`, async ({ browser }) => {
    const openDialog = async (page: Page) => {
      await page.goto("/transport?tab=riders");
      const row = page.locator("li").filter({ hasText: CHILD.fullName }).filter({ has: page.getByRole("button", { name: "Change", exact: true }) });
      await row.first().getByRole("button", { name: "Change", exact: true }).click({ timeout: 30_000 });
      // The amend popup (Base UI Dialog; its title names it).
      return page.locator("[aria-labelledby=\"transport-amend-title\"]");
    };
    // Teaching scope.
    const page = await open(browser, shot);
    const teachingHits = await answerTeachingScope(page);
    const dialog = await openDialog(page);
    await expect(dialog.getByText(PAID_MONTHS_UNKNOWN_FOR_ROLE)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(/^Applies from/)).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Apply change" })).toBeDisabled();
    // A backdated month is refused too (the refusal does not depend on it).
    await dialog.getByLabel("Apply from (optional)").fill("2026-09");
    await expect(dialog.getByText(PAID_MONTHS_UNKNOWN_FOR_ROLE)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Apply change" })).toBeDisabled();
    expect(teachingHits(), "the screen read the teaching answer").toBeGreaterThan(0);
    await page.screenshot({ path: path.join(SHOTS, `amend-teaching-${shot.name}.png`), fullPage: false });
    await page.context().close();
    // Full scope: the floor is known — Oct 2026, six paid months kept.
    const full = await open(browser, shot);
    const fullDialog = await openDialog(full);
    await expect(fullDialog.getByText(/^Applies from Oct 2026/)).toBeVisible({ timeout: 15_000 });
    await expect(fullDialog.getByText(/^6 paid months/)).toBeVisible();
    await expect(fullDialog.getByText(PAID_MONTHS_UNKNOWN_FOR_ROLE)).toHaveCount(0);
    await full.screenshot({ path: path.join(SHOTS, `amend-full-${shot.name}.png`), fullPage: false });
    await full.context().close();
  });
}

test("riders form: a backdated start over paid months says the payment carries over", async ({ browser }) => {
  seed("end-new");
  for (const shot of [
    { name: "desktop-light", width: 1440, height: 900, dark: false },
    { name: "phone375-dark", width: 375, height: 812, dark: true },
  ]) {
    const page = await open(browser, shot);
    await page.goto("/transport?tab=riders");
    await page.getByPlaceholder("Name, admission no, or mobile…").fill(CHILD.fullName);
    await page.getByRole("button", { name: new RegExp(CHILD.fullName) }).first().click({ timeout: 30_000 });
    await page.getByLabel("Effective from").fill("2026-09-01");
    const note = page.getByTestId("transport-paid-carry-over");
    await expect(note).toBeVisible({ timeout: 15_000 });
    await expect(note).toContainText("September 2026 is already paid");
    await expect(note).toContainText("carry over to the new stop");
    await note.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `riders-warning-${shot.name}.png`), fullPage: false });
    // A start after the paid months says nothing.
    await page.getByLabel("Effective from").fill("2026-10-01");
    await expect(note).toHaveCount(0);
    await page.context().close();
  }
});

test("riders form, teaching-scope Masters: dues and paid months say 'not shown', never ₹0 / nothing", async ({ browser }) => {
  // After "end-new" above: the child rides nothing, so the Riders form offers her.
  const page = await open(browser, { width: 1440, height: 900 });
  await answerTeachingScope(page);
  await page.goto("/transport?tab=riders");
  await page.getByPlaceholder("Name, admission no, or mobile…").fill(CHILD.fullName);
  const hit = page.getByRole("button", { name: new RegExp(CHILD.fullName) }).first();
  await expect(hit).toContainText("dues: not shown for your role", { timeout: 30_000 });
  await expect(hit).not.toContainText("open dues");
  await hit.click();
  await page.getByLabel("Effective from").fill("2026-09-01");
  await expect(page.getByTestId("transport-paid-unknown")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("transport-paid-carry-over")).toHaveCount(0);
  await page.getByTestId("transport-paid-unknown").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "riders-teaching-desktop-light.png"), fullPage: false });
  await page.context().close();
});
