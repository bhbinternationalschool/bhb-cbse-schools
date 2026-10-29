/**
 * shell-no-shift — nothing the shell loads late moves a screen that is
 * already up (29 Oct 2026).
 *
 * Since data-layer 2.3a a screen is shown as soon as the masters view (and
 * the roles and roster) have answered; the school's notices strip in the
 * sticky header comes from the comms desk, which waits its turn in the
 * hydration queue behind the boot hydrates. On CI it landed ~1 s after the
 * screen and pushed everything down ~40 px — between a tap's press and its
 * release: the press on a step tab, the release on the card above it, so the
 * tap did nothing (Masters → "3 · Subjects by class", Timetable → "Subject
 * rules", Attendance → "Month register": the propagation, masters-element-
 * writes and staff-month-register failures of 28–29 Oct). A staff member on a
 * slow phone loses the same first tap.
 *
 * Here the comms desk is held back until the screen is up, then let through:
 * the screen must not move when the strip arrives (the strip's bar is drawn,
 * empty, from the first paint — components/shell/CommsRunningStrip), and a tap
 * pressed while it arrives must still land.
 */
import type { Browser, Page } from "@playwright/test";
import { AY_CURRENT } from "../fixture";
import { APP_URL, collectPageErrors, expect, signIn, test } from "../support";

/** Hold GET school-comms-desk until `release()`; the screen comes up meanwhile. */
async function openWithCommsHeld(browser: Browser, path: string): Promise<{ page: Page; release: () => void; errors: string[] }> {
  // No service worker: it claims the page ~0.5 s in, and Playwright cannot
  // route the requests of a page the worker controls.
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await signIn(context, "office");
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/school-data/school-comms-desk**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as { notices?: unknown[] };
    await held;
    // The fixture seeds no notice (parent-web-tabs adds one later in the
    // run — on CI every write project after it has the strip): one here.
    return route.fulfill({ response: res, json: { ...body, notices: [NOTICE, ...(body.notices ?? [])] } });
  });
  await page.goto(path);
  return { page, release, errors };
}

const NOW = new Date().toISOString();
const NOTICE = {
  id: "e2e_shift_notice",
  title: "E2E staff-only notice",
  body: "E2E staff-only notice — details.",
  audience: "staff",
  status: "published",
  pinned: false,
  academicYearCode: AY_CURRENT,
  publishedAt: NOW,
  scheduledPublishAt: "",
  createdAt: NOW,
  createdBy: "E2E",
  updatedAt: NOW,
};

const strip = (p: Page) => p.getByRole("region", { name: "School announcements" });

test("the notices strip landing late does not move the screen (Masters → Subjects)", async ({ browser }) => {
  const { page, release, errors } = await openWithCommsHeld(browser, "/masters?tab=subjects");
  try {
    const tab = page.getByRole("tab", { name: "3 · Subjects by class" });
    await expect(tab).toBeVisible({ timeout: 30_000 });
    await expect(strip(page), "the strip is still held back").toHaveCount(0);
    const before = await tab.boundingBox();
    release();
    await expect(strip(page).getByText("E2E staff-only notice").first()).toBeAttached({ timeout: 20_000 });
    const after = await tab.boundingBox();
    expect(after?.y, `the step tab moved from y=${before?.y} to y=${after?.y} when the strip arrived`).toBe(before?.y);
    await page.screenshot({ path: test.info().outputPath("strip-landed.png") });
  } finally {
    release();
    await page.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

test("a tap pressed while the notices strip arrives still lands (Masters → Subjects by class)", async ({ browser }) => {
  const { page, release, errors } = await openWithCommsHeld(browser, "/masters?tab=subjects");
  try {
    const tab = page.getByRole("tab", { name: "3 · Subjects by class" });
    await expect(tab).toBeVisible({ timeout: 30_000 });
    const box = (await tab.boundingBox())!;
    // Press, let the strip in, release where the finger is — as on CI, where
    // the strip landed between Playwright's press and its release.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    release();
    await expect(strip(page).getByText("E2E staff-only notice").first()).toBeAttached({ timeout: 20_000 });
    await page.mouse.up();
    await expect(tab, "the tap selected the step").toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("combobox", { name: "Class", exact: true }).first().locator("option", { hasText: /^V$/ })).toHaveCount(1);
  } finally {
    release();
    await page.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

test("with no notices, the comms desk answering late does not move the screen either", async ({ browser }) => {
  // The seeded school has no notice. An empty bar drawn while the desk was
  // unknown and dropped when it answered "none" moved every screen UP by the
  // same 41 px (PR #742's first cut: admissions-comms, masters-exams-reports
  // and month-groups lost their taps on CI). The shell waits for this read,
  // so the screen appears with the strip already decided.
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await signIn(context, "office");
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  await page.route("**/api/school-data/school-comms-desk**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 1_500));
    return route.fulfill({ response: res, json: { ...body, notices: [], news: [] } });
  });
  try {
    await page.goto("/masters?tab=subjects");
    const tab = page.getByRole("tab", { name: "3 · Subjects by class" });
    await expect(tab).toBeVisible({ timeout: 30_000 });
    const before = await tab.boundingBox();
    const stripAtShow = await strip(page).count();
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").some((e) => e.name.includes("school-comms-desk")))).toBe(true);
    await page.waitForTimeout(1_000);
    const after = await tab.boundingBox();
    expect(after?.y, `the step tab moved from y=${before?.y} to y=${after?.y} after the comms desk answered`).toBe(before?.y);
    await expect(page.getByTestId("comms-strip-pending"), "no empty bar left behind").toHaveCount(0);
    // On a fresh stack there is no strip at all; after the write projects a
    // notice may come from the school's older comms copy — either way the
    // strip the screen first showed with is the strip it keeps.
    await expect(strip(page), "the strip as the screen first showed it").toHaveCount(stripAtShow);
  } finally {
    await context.close();
  }
  expect(errors, "no page errors").toEqual([]);
});

/**
 * Masters → Subjects: the teachers' subject-requests card (components/masters/
 * SubjectRequestsCard) sits above the subjects panel and is drawn only when a
 * request exists. Its read answered after the step tabs were up and pushed
 * them down ~96 px — after subject-request-approval writes requests, the
 * same lost taps as the notices strip. Here the read is slowed and answers
 * with a waiting request: the tabs must be where they first showed, and a tap
 * pressed while the card arrives must still land.
 */
const REQUEST = {
  id: "e2e_shift_request",
  staffId: "e2e_staff",
  staffName: "E2E Teacher",
  classId: "e2e_class",
  className: "V",
  action: "add",
  subjectId: "",
  subjectName: "E2E Shift Subject",
  reason: "E2E — a late request card.",
  status: "pending",
  decidedBy: "",
  decidedAt: "",
  decisionNote: "",
  createdAt: NOW,
};

async function openWithSlowRequests(browser: Browser): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await signIn(context, "office");
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  await page.route("**/api/masters/subject-requests**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((r) => setTimeout(r, 2_000));
    return route.fulfill({ json: { ok: true, pending: [REQUEST], recent: [] } });
  });
  await page.goto("/masters?tab=subjects");
  return { page, errors };
}

const requestsCard = (p: Page) => p.getByRole("region", { name: "Teachers' subject requests" });

test("the subject-requests card landing late does not move the step tabs (Masters → Subjects)", async ({ browser }) => {
  const { page, errors } = await openWithSlowRequests(browser);
  try {
    const tab = page.getByRole("tab", { name: "3 · Subjects by class" });
    await expect(tab).toBeVisible({ timeout: 30_000 });
    const before = await tab.boundingBox();
    await expect(requestsCard(page).getByText("E2E Shift Subject").first()).toBeVisible({ timeout: 20_000 });
    const after = await tab.boundingBox();
    expect(after?.y, `the step tab moved from y=${before?.y} to y=${after?.y} when the requests card arrived`).toBe(before?.y);
    await page.screenshot({ path: test.info().outputPath("requests-landed.png") });
  } finally {
    await page.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

test("a tap pressed while the subject-requests card arrives still lands (Masters → Subjects by class)", async ({ browser }) => {
  const { page, errors } = await openWithSlowRequests(browser);
  try {
    const tab = page.getByRole("tab", { name: "3 · Subjects by class" });
    await expect(tab).toBeVisible({ timeout: 30_000 });
    const box = (await tab.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(requestsCard(page).getByText("E2E Shift Subject").first()).toBeVisible({ timeout: 20_000 });
    await page.mouse.up();
    await expect(tab, "the tap selected the step").toHaveAttribute("aria-selected", "true");
  } finally {
    await page.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});
