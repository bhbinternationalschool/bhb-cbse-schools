/**
 * parent-web-dues — the website parent page (/parent) shows a real parent
 * their own family's dues, owing and paid, bus months included (15 Oct 2026).
 *
 * THE DEFECT. ParentFeesPortal computed the page in the browser from the
 * office's desks (fees vouchers, transport, SIS roster). Those refuse a parent
 * session, so every real parent saw "No household linked" and no dues at all
 * (found by PR #667/#668). The page now reads GET /api/payments/parent-dues:
 * computed on the server, for the session's household only.
 *
 * Fixture: the Anvi shape (e2e/transportPaidCase.ts) — Apr–Aug paid under an
 * assignment whose stop vanished, September paid under the old id and re-billed
 * under a backdated new stop, October ₹500 owing — signed in as THAT child's
 * parent, with a session minted the way the app's login mints one.
 *
 * Proved here: the dues and paid bus months on the page; another family's
 * household refused (403) and never in the answer; staff and signed-out
 * callers refused; a failed read says "Could not load" and offers Try again,
 * never "No household linked" or ₹0; Pay goes to the server pay-link flow.
 * Screenshots in e2e/parent-web-shots (git-ignored), desktop-light and
 * phone375-dark.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { DemoSession } from "@/lib/auth";
import { demoSessionCookieName } from "@/lib/auth";
import { APP_URL, expect, fx, test } from "../support";
import { mintSessionCookie } from "../session";
import { AY_CURRENT } from "../fixture";
import { APR_SEP, CHILD, MONTH_NAMES } from "../transportPaidCase";

const SHOTS = process.env.PARENT_WEB_SHOTS || path.join(__dirname, "..", "parent-web-shots");
const PATH = "/api/payments/parent-dues";
const SIZES = [
  { name: "desktop-light", width: 1440, height: 900, dark: false },
  { name: "phone375-dark", width: 375, height: 812, dark: true },
] as const;

function parentSession(householdId: string): DemoSession {
  const hh = fx.sis.households.find((h) => h.id === householdId)!;
  return {
    persona: "parent",
    fullName: hh.guardianName,
    roleCode: "parent",
    householdId,
    tenantSlug: fx.sessions.office.tenantSlug,
    academicYearCode: AY_CURRENT,
  };
}

const MY_HH = CHILD.householdId;
/** Another family with a current-year child — the one this parent must never see. */
const OTHER = fx.sis.students.find(
  (s) => s.academicYearCode === AY_CURRENT && s.status === "active" && s.householdId && s.householdId !== MY_HH,
)!;
const MY_CHILDREN = new Set(
  fx.sis.students.filter((s) => s.householdId === MY_HH && s.academicYearCode === AY_CURRENT && s.status === "active").map((s) => s.id),
);

async function contextAs(
  browser: Browser,
  session: DemoSession | null,
  opts: { width: number; height: number; dark?: boolean } = { width: 1440, height: 900 },
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  if (session) {
    await context.addCookies([
      { name: demoSessionCookieName(), value: mintSessionCookie(session), url: APP_URL, httpOnly: true, sameSite: "Lax" },
    ]);
  }
  await context.addCookies([{ name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL }]);
  // Nothing leaves the stack (a pay page or checkout on another origin).
  await context.route((u) => !u.href.startsWith(APP_URL), (r) => r.abort());
  return context;
}

type Line = { dueKey: string; kind: string; dueOn: string; paidPaise: number; balancePaise: number };
type View = { householdId: string; children: { student: { id: string }; dues: Line[] }[]; receipts: { householdId: string; id: string }[] };

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  expect(CHILD, "fixture has a spare current-year child").toBeTruthy();
  expect(OTHER, "fixture has a second family").toBeTruthy();
  // Through tsx, like the stack's own seed (see e2e/transportPaidCase.ts).
  execFileSync("npx", ["--yes", "tsx", path.join(__dirname, "..", "..", "..", "..", "scripts", "e2e-seed-transport-paid.ts")], {
    cwd: path.join(__dirname, "..", ".."),
    stdio: "inherit",
    env: { ...process.env, TPM_STEP: "" },
  });
  fs.mkdirSync(SHOTS, { recursive: true });
});

test("the server answers with this family's dues: Apr–Sep bus months paid, October owing", async ({ browser }) => {
  const context = await contextAs(browser, parentSession(MY_HH));
  // The server's school mirror re-reads the database on a TTL; the seed wrote
  // from another process, so ask until the receipts are in.
  await expect(async () => {
    const res = await context.request.get(PATH);
    expect(res.status(), await res.text()).toBe(200);
    const { data } = (await res.json()) as { data: View };
    expect(data.householdId).toBe(MY_HH);
    // Only this family's children, and every receipt is this family's.
    for (const c of data.children) expect(MY_CHILDREN.has(c.student.id), c.student.id).toBe(true);
    expect(data.children.map((c) => c.student.id)).toContain(CHILD.id);
    for (const r of data.receipts) expect(r.householdId).toBe(MY_HH);
    expect(data.receipts.filter((r) => r.id.startsWith("e2e_tpm_rcv_"))).toHaveLength(6);

    const bus = data.children.find((c) => c.student.id === CHILD.id)!.dues.filter((d) => d.kind === "transport");
    const month = (ym: string) => bus.filter((d) => d.dueKey.endsWith(`:${ym}`));
    for (const ym of APR_SEP) {
      const lines = month(ym);
      expect(lines.length, `${ym} listed`).toBeGreaterThan(0);
      expect(lines.reduce((s, d) => s + d.balancePaise, 0), `${ym} owes nothing`).toBe(0);
      expect(lines.reduce((s, d) => s + d.paidPaise, 0), `${ym} shows the ₹500 paid`).toBe(50000);
    }
    expect(month("2026-10").reduce((s, d) => s + d.balancePaise, 0), "October owes ₹500").toBe(50000);
  }).toPass({ timeout: 90_000, intervals: [5_000, 10_000, 15_000] });
  await context.close();
});

test("another family's data is refused, and so is anyone who is not a parent", async ({ browser }) => {
  const mine = await contextAs(browser, parentSession(MY_HH));
  // Asking for another household by id: refused, whatever the id.
  const other = await mine.request.get(`${PATH}?householdId=${encodeURIComponent(OTHER.householdId)}`);
  expect(other.status()).toBe(403);
  expect(await other.text()).not.toContain(OTHER.fullName);
  // The office's desk the old page read still refuses a parent (unchanged).
  expect([401, 403]).toContain((await mine.request.get("/api/school-data/sis-roster")).status());
  await mine.close();

  // The other family's own session never sees this family.
  const theirs = await contextAs(browser, parentSession(OTHER.householdId));
  const res = await theirs.request.get(PATH);
  expect(res.status(), await res.text()).toBe(200);
  const { data } = (await res.json()) as { data: View };
  expect(data.householdId).toBe(OTHER.householdId);
  expect(data.children.map((c) => c.student.id)).not.toContain(CHILD.id);
  expect(JSON.stringify(data)).not.toContain(CHILD.id);
  await theirs.close();

  // A staff session is not a parent; no session at all is not signed in.
  const staff = await contextAs(browser, fx.sessions.principal);
  expect((await staff.request.get(PATH)).status()).toBe(403);
  await staff.close();
  const nobody = await contextAs(browser, null);
  expect((await nobody.request.get(PATH)).status()).toBe(401);
  await nobody.close();
});

async function openParentPage(page: Page): Promise<void> {
  await page.goto("/parent");
  await expect(page.getByText("Loading your fees…")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/No household linked/)).toHaveCount(0);
  const chip = page.locator(`button[data-student-id="${CHILD.id}"]`);
  if (await chip.count()) await chip.click();
}

for (const size of SIZES) {
  test(`/parent (${size.name}): the bus months paid, October owing`, async ({ browser }) => {
    const context = await contextAs(browser, parentSession(MY_HH), size);
    const page = await context.newPage();
    await openParentPage(page);
    await expect(page.getByRole("heading", { name: CHILD.fullName })).toBeVisible();
    for (const ym of APR_SEP) {
      const line = page.locator(`li[data-due-kind="transport"][data-due-month="${ym}"]`);
      await expect(line, `${MONTH_NAMES[ym]} transport listed`).toHaveCount(1);
      await expect(line, `${MONTH_NAMES[ym]} transport paid`).toHaveAttribute("data-paid", "1");
      await expect(line).toContainText("Paid");
    }
    const oct = page.locator('li[data-due-kind="transport"][data-due-month="2026-10"]');
    await expect(oct).toHaveCount(1);
    await expect(oct).toHaveAttribute("data-paid", "0");
    await expect(oct).toContainText("₹500");
    await page.screenshot({ path: path.join(SHOTS, `parent-dues-${size.name}.png`), fullPage: true });

    // Receipts: the family's six bus receipts.
    await page.getByRole("tab", { name: "Receipts" }).or(page.getByRole("button", { name: "Receipts" })).first().click();
    for (let i = 1; i <= 6; i++) {
      await expect(page.getByText(`E2E-TPM-${String(i).padStart(4, "0")}`)).toBeVisible();
    }
    await page.screenshot({ path: path.join(SHOTS, `parent-receipts-${size.name}.png`), fullPage: true });
    await context.close();
  });
}

test("a failed read says so and offers Try again — never 'No household linked' or ₹0", async ({ browser }) => {
  for (const size of SIZES) {
    const context = await contextAs(browser, parentSession(MY_HH), size);
    const page = await context.newPage();
    let fail = true;
    await page.route(`**${PATH}*`, (r) =>
      fail
        ? r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "server_error", message: "School records are unavailable right now" } }) })
        : r.continue(),
    );
    await page.goto("/parent");
    const err = page.getByTestId("parent-fees-error");
    await expect(err).toBeVisible({ timeout: 30_000 });
    await expect(err).toContainText("Could not load your fees");
    await expect(page.getByText(/No household linked/)).toHaveCount(0);
    await expect(page.getByText("₹0")).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, `parent-failed-read-${size.name}.png`), fullPage: true });
    fail = false;
    await err.getByRole("button", { name: "Try again" }).click();
    await expect(err).toHaveCount(0, { timeout: 30_000 });
    const chip = page.locator(`button[data-student-id="${CHILD.id}"]`);
    if (await chip.count()) await chip.click();
    await expect(page.locator('li[data-due-kind="transport"][data-due-month="2026-10"]')).toContainText("₹500");
    await context.close();
  }
});

test("Pay sends only due keys to the server checkout and goes to the pay-link", async ({ browser }) => {
  const context = await contextAs(browser, parentSession(MY_HH));
  const page = await context.newPage();
  await openParentPage(page);
  const oct = page.locator('li[data-due-kind="transport"][data-due-month="2026-10"]');
  await oct.getByRole("checkbox").check();
  const [req, res] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/payments/parent-checkout") && r.method() === "POST"),
    page.waitForResponse((r) => r.url().endsWith("/api/payments/parent-checkout")),
    page.getByRole("button", { name: /Pay with/ }).click(),
  ]);
  const sent = req.postDataJSON() as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual(["dueKeys", "studentId"]);
  expect(sent.dueKeys).toEqual([expect.stringMatching(new RegExp(`^transport:${CHILD.id}:[^:]+:2026-10$`))]);
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { ok: boolean; amountPaise: number; checkoutUrl: string | null; shareUrl: string };
  expect(body.ok).toBe(true);
  expect(body.amountPaise).toBe(50000);
  expect(body.checkoutUrl || body.shareUrl).toMatch(/\/pay\//);
  await context.close();
});
