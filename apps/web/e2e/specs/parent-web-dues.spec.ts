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
 * Fixture: the Anvi shape (e2e/transportPaidCase.ts, its PARENT case — a
 * child of its own, in a family no other spec seeds or pays for) — Apr–Aug paid under an
 * assignment whose stop vanished, September paid under the old id and re-billed
 * under a backdated new stop, October ₹500 owing — signed in as THAT child's
 * parent, with a session minted the way the app's login mints one.
 *
 * "Due now" is the pay link's definition (owing up to the running month —
 * directDues, the same as /pay/due, the reminders and the app's summary); the
 * months after it are "Rest of the year", shown apart, never in the amount to
 * pay and never selectable. The expectations are computed from today's date
 * below, so the spec passes in any month: on 15 Oct 2026 due now is the
 * October bus month (₹500) for this child, and November–March are the rest.
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
import { APR_SEP, MONTH_NAMES, PARENT_CASE } from "../transportPaidCase";

const CHILD = PARENT_CASE.child;

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
type View = {
  householdId: string;
  children: { student: { id: string }; dues: Line[] }[];
  receipts: { householdId: string; id: string }[];
  dueNowKeys: string[];
  dueNowPaise: number;
  restOfYearPaise: number;
};

/** The child's owing bus months, October 2026 – March 2027. */
const OWING = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"];
/**
 * Is `ym` due now, today? An independent oracle for the engine's rule: a line
 * is due once its month is not after the running month in session order
 * (April first), judged on the school's (IST) calendar.
 */
function dueNowToday(ym: string): boolean {
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);
  const idx = (m: number) => (m + 8) % 12; // April = 0 … March = 11
  return idx(Number(ym.slice(5, 7))) <= idx(Number(today.slice(5, 7)));
}
const rupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

async function readView(context: BrowserContext): Promise<View> {
  const res = await context.request.get(PATH);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { data: View }).data;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  expect(CHILD, "fixture has a spare current-year child").toBeTruthy();
  expect(OTHER, "fixture has a second family").toBeTruthy();
  // Through tsx, like the stack's own seed (see e2e/transportPaidCase.ts).
  execFileSync("npx", ["--yes", "tsx", path.join(__dirname, "..", "..", "..", "..", "scripts", "e2e-seed-transport-paid.ts")], {
    cwd: path.join(__dirname, "..", ".."),
    stdio: "inherit",
    env: { ...process.env, TPM_STEP: "", TPM_CASE: "parent" },
  });
  fs.mkdirSync(SHOTS, { recursive: true });
});

test("the server answers with this family's dues: Apr–Sep bus months paid, Oct–Mar owing, split into due now and the rest of the year", async ({ browser }) => {
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
    expect(data.receipts.filter((r) => r.id.startsWith(PARENT_CASE.receiptIdPrefix))).toHaveLength(6);

    const bus = data.children.find((c) => c.student.id === CHILD.id)!.dues.filter((d) => d.kind === "transport");
    const month = (ym: string) => bus.filter((d) => d.dueKey.endsWith(`:${ym}`));
    for (const ym of APR_SEP) {
      const lines = month(ym);
      expect(lines.length, `${ym} listed`).toBeGreaterThan(0);
      expect(lines.reduce((s, d) => s + d.balancePaise, 0), `${ym} owes nothing`).toBe(0);
      expect(lines.reduce((s, d) => s + d.paidPaise, 0), `${ym} shows the ₹500 paid`).toBe(50000);
    }
    for (const ym of OWING) {
      expect(month(ym).reduce((s, d) => s + d.balancePaise, 0), `${ym} owes ₹500`).toBe(50000);
      // Due now or the rest of the year, by today's date.
      const now = month(ym).every((d) => data.dueNowKeys.includes(d.dueKey));
      expect(now, `${ym} due now?`).toBe(dueNowToday(ym));
    }
    // Due now and rest of the year add up exactly, and never overlap.
    const open = data.children.flatMap((c) => c.dues).filter((d) => d.balancePaise > 0);
    const keys = new Set(data.dueNowKeys);
    expect(data.dueNowPaise).toBe(open.filter((d) => keys.has(d.dueKey)).reduce((s, d) => s + d.balancePaise, 0));
    expect(data.restOfYearPaise).toBe(open.filter((d) => !keys.has(d.dueKey)).reduce((s, d) => s + d.balancePaise, 0));
    for (const k of keys) expect(open.some((d) => d.dueKey === k), `due-now key ${k} is an owing line`).toBe(true);
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
  await showChild(page);
}

/** The page has loaded; switch to the seeded child when the family has several. */
async function showChild(page: Page): Promise<void> {
  await expect(page.getByTestId("parent-due-now")).toBeVisible({ timeout: 30_000 });
  if (MY_CHILDREN.size > 1) {
    const chip = page.locator(`button[data-student-id="${CHILD.id}"]`);
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByRole("heading", { name: CHILD.fullName })).toBeVisible();
}

for (const size of SIZES) {
  test(`/parent (${size.name}): bus months paid, due now apart from the rest of the year`, async ({ browser }) => {
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
    for (const ym of OWING) {
      const line = page.locator(`li[data-due-kind="transport"][data-due-month="${ym}"]`);
      await expect(line).toHaveCount(1);
      await expect(line).toHaveAttribute("data-paid", "0");
      await expect(line).toContainText("₹500");
      if (dueNowToday(ym)) {
        await expect(line, `${ym} due now`).toHaveAttribute("data-due-now", "1");
        await expect(line.getByRole("checkbox")).toBeEnabled();
      } else {
        await expect(line, `${ym} rest of the year`).toHaveAttribute("data-due-now", "0");
        await expect(page.getByTestId("parent-rest-of-year-list").locator(`li[data-due-month="${ym}"]`)).toHaveCount(1);
        await expect(line.getByRole("checkbox")).toBeDisabled();
      }
    }
    // The tiles: "Due now" is the server's due-now figure, the rest apart.
    const view = await readView(context);
    await expect(page.getByTestId("parent-due-now")).toHaveText(rupees(view.dueNowPaise));
    await expect(page.getByTestId("parent-rest-of-year")).toHaveText(rupees(view.restOfYearPaise));
    await page.screenshot({ path: path.join(SHOTS, `parent-dues-${size.name}.png`), fullPage: true });

    // Receipts: the family's six bus receipts.
    await page.getByRole("tab", { name: "Receipts" }).or(page.getByRole("button", { name: "Receipts" })).first().click();
    for (let i = 1; i <= 6; i++) {
      await expect(page.getByText(`${PARENT_CASE.receiptNoPrefix}${String(i).padStart(4, "0")}`)).toBeVisible();
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
    await showChild(page);
    await expect(page.locator('li[data-due-kind="transport"][data-due-month="2026-10"]')).toContainText("₹500");
    await context.close();
  }
});

test("Pay sends only the due-now keys to the server checkout and goes to the pay-link", async ({ browser }) => {
  const context = await contextAs(browser, parentSession(MY_HH));
  const view = await readView(context);
  const mine = view.children.find((c) => c.student.id === CHILD.id)!.dues.map((d) => d.dueKey);
  const dueNowMine = view.dueNowKeys.filter((k) => mine.includes(k));
  expect(dueNowMine.length, "this child owes something now").toBeGreaterThan(0);
  const page = await context.newPage();
  await openParentPage(page);
  await page.getByRole("button", { name: "Select all due now" }).click();
  // The page leaves for the pay page as soon as the answer lands, so the
  // answer is captured on its way through rather than read afterwards.
  let sent: { dueKeys: string[]; studentId: string } | null = null;
  let answer: { status: number; body: { ok: boolean; amountPaise: number; checkoutUrl: string | null; shareUrl: string } } | null = null;
  await page.route("**/api/payments/parent-checkout", async (route) => {
    sent = route.request().postDataJSON() as { dueKeys: string[]; studentId: string };
    const r = await route.fetch();
    answer = { status: r.status(), body: await r.json() };
    await route.fulfill({ response: r });
  });
  await page.getByRole("button", { name: /Pay with/ }).click();
  await expect.poll(() => answer?.status ?? 0, { timeout: 30_000 }).toBe(200);
  expect(Object.keys(sent!).sort()).toEqual(["dueKeys", "studentId"]);
  // Exactly this child's due-now lines — nothing from the rest of the year.
  expect([...sent!.dueKeys].sort()).toEqual([...dueNowMine].sort());
  const body = answer!.body;
  expect(body.ok).toBe(true);
  const owed = view.children
    .find((c) => c.student.id === CHILD.id)!
    .dues.filter((d) => dueNowMine.includes(d.dueKey))
    .reduce((s, d) => s + d.balancePaise, 0);
  expect(body.amountPaise).toBe(owed);
  expect(body.checkoutUrl || body.shareUrl).toMatch(/\/pay\//);
  await context.close();
});
