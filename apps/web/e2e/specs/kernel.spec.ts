/**
 * kernel — the client query kernel and the reference views (data-layer 1.4),
 * on the running app.
 *
 *  - The four views and the versions route answer by who is asking: no
 *    session 401, a parent 403, staff 200 — the masters view as the teaching
 *    subset or in full by permission, the staff list as a directory only.
 *  - The versions poll runs while a page holds a desk query — since 20 Oct
 *    2026 that is every staff page, because the header bell reads desk
 *    "erp_notifications" — ONE poll per tab whatever else is mounted, at the
 *    20 s cadence and never in a burst; none for a family (/parent polls its
 *    own bell, not versions). A 403 stops it for good, a 503 keeps the
 *    screen as it was.
 *  - A failed view read is "Could not load … / Try again" (one <QueryError>),
 *    never an empty list, and Try again recovers without a reload.
 *
 * Read-only: runs in the desktop project, before propagation writes.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import type { DemoSession } from "@/lib/auth";
import { demoSessionCookieName } from "@/lib/auth";
import type { MastersView, RbacView, StaffListView } from "@/lib/data/viewTypes";
import { AY_CURRENT, E2E_TENANT_SLUG } from "../fixture";
import { mintSessionCookie, sessionCookieHeader } from "../session";
import { APP_URL, expect, fx, metric, openAs, test } from "../support";

const VIEWS = [
  "/api/data/views/masters",
  "/api/data/views/staff-list",
  "/api/data/views/rbac",
  "/api/data/views/module-registry",
] as const;
const VERSIONS = "/api/data/views/versions";

const PARENT: DemoSession = {
  persona: "parent",
  fullName: "E2E Parent",
  roleCode: "parent",
  householdId: fx.sis.households[0]!.id,
  tenantSlug: E2E_TENANT_SLUG,
  academicYearCode: AY_CURRENT,
};

async function api(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, session: DemoSession | null) {
  return playwright.request.newContext({
    baseURL: APP_URL,
    extraHTTPHeaders: session ? { cookie: sessionCookieHeader(session) } : {},
  });
}

type ViewBody<T> = { ok: boolean; data: T; versions: Record<string, unknown> | null; stale: boolean };

async function getView<T>(req: APIRequestContext, path: string): Promise<{ status: number; body: ViewBody<T>; cacheControl: string | undefined }> {
  const res = await req.get(path);
  return { status: res.status(), body: (await res.json()) as ViewBody<T>, cacheControl: res.headers()["cache-control"] };
}

/** Count GETs of the versions route a page makes. */
function countVersionPolls(page: Page): () => number {
  let n = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === VERSIONS) n += 1;
  });
  return () => n;
}

/** When each versions GET left the page (ms since the epoch). */
function versionPollTimes(page: Page): number[] {
  const at: number[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === VERSIONS) at.push(Date.now());
  });
  return at;
}

/** The smallest gap between two consecutive polls; Infinity with fewer than two. */
function minGap(at: readonly number[]): number {
  let g = Infinity;
  for (let i = 1; i < at.length; i += 1) g = Math.min(g, at[i]! - at[i - 1]!);
  return g;
}

test("views + versions: no session 401, a parent 403", async ({ playwright }) => {
  const anon = await api(playwright, null);
  const parent = await api(playwright, PARENT);
  try {
    for (const path of [...VIEWS, VERSIONS]) {
      expect((await anon.get(path)).status(), `${path} without a session`).toBe(401);
      expect((await parent.get(path)).status(), `${path} as a parent`).toBe(403);
    }
  } finally {
    await anon.dispose();
    await parent.dispose();
  }
});

test("views: office reads Masters in full; the staff list is a directory; no browser caching", async ({ playwright }, testInfo) => {
  const office = await api(playwright, fx.sessions.office);
  try {
    const m = await getView<MastersView>(office, "/api/data/views/masters");
    expect(m.status).toBe(200);
    expect(m.cacheControl).toBe("private, no-store");
    expect(m.body.data.scope).toBe("full");
    expect(m.body.data.masters.classes).toHaveLength(fx.expected.classes);
    expect(m.body.data.masters.sections).toHaveLength(fx.expected.sections);
    expect(m.body.data.masters.subjects).toHaveLength(fx.expected.subjects);
    expect(m.body.data.masters.classSubjects).toHaveLength(fx.expected.classSubjects);
    expect(Object.keys(m.body.data.masters)).not.toContain("staff");
    expect(m.body.versions && typeof m.body.versions === "object", "the view says what it was built from").toBe(true);
    expect(Object.keys(m.body.versions ?? {})).toContain("masters");

    const s = await getView<StaffListView>(office, "/api/data/views/staff-list");
    expect(s.status).toBe(200);
    expect(s.body.data.staff).toHaveLength(fx.expected.staff);
    const allowed = [
      "classTeacherLinks", "departmentId", "departmentName", "designationId", "designationName", "dutyLinks",
      "empCode", "fullName", "id", "status", "stream", "subjectTeachingLinks", "vehicleLinks",
    ];
    for (const row of s.body.data.staff) expect(Object.keys(row).sort()).toEqual(allowed);
    const text = JSON.stringify(s.body);
    for (const leak of ["mobile", "aadhaar", "loginPassword", "basicPay", "bankAccount", "panNo", "90000000"]) {
      expect(text, `staff-list must not carry ${leak}`).not.toContain(leak);
    }
    expect(s.body.data.departments.length).toBe(fx.staff.departments.length);
    expect(s.body.data.designations.length).toBe(fx.staff.designations.length);

    const r = await getView<RbacView>(office, "/api/data/views/rbac");
    expect(r.status).toBe(200);
    expect(r.body.data.known).toBe(true);
    expect(r.body.data.rbac.roles.length).toBeGreaterThan(0);

    const reg = await getView<{ version: number; enabled: Record<string, boolean> }>(office, "/api/data/views/module-registry");
    expect(reg.status).toBe(200);
    expect(reg.body.data.version).toBe(1);
    await metric(testInfo, "views", { rbacOwnOnly: r.body.data.ownOnly, registryKeys: Object.keys(reg.body.data.enabled).length });
  } finally {
    await office.dispose();
  }
});

test("views: a teacher's rbac is her own rows only", async ({ playwright }) => {
  const teacher = await api(playwright, fx.sessions.teacher);
  try {
    const r = await getView<RbacView>(teacher, "/api/data/views/rbac");
    expect(r.status).toBe(200);
    expect(r.body.data.ownOnly).toBe(true);
    expect(r.body.data.rbac.audit).toEqual([]);
    for (const a of r.body.data.rbac.assignments) expect(a.staffId).toBe(fx.sessions.teacher.staffId);
    expect((await teacher.get("/api/data/views/staff-list")).status()).toBe(200);
    expect((await teacher.get("/api/data/views/module-registry")).status()).toBe(200);
  } finally {
    await teacher.dispose();
  }
});

test("versions poll: one per tab at the 20 s cadence on every staff page (the bell), never a burst; none for a family", async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const { context, page } = await openAs(browser, "office");
  try {
    // /masters mounts no kernel query of its own: the header bell
    // (desk erp_notifications) is what runs the poll here.
    const onMastersAt = versionPollTimes(page);
    await page.goto("/masters");
    await expect(page.getByRole("button", { name: `${fx.expected.classes} Classes`, exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("notification-bell")).toBeVisible();
    await page.waitForTimeout(25_000);
    const onMasters = onMastersAt.length;
    expect(onMasters, "the bell's poll runs on a staff page").toBeGreaterThanOrEqual(1);
    expect(onMasters, "at the 20 s cadence: the first + at most one in 25 s").toBeLessThanOrEqual(2);
    expect(minGap(onMastersAt), "never a burst").toBeGreaterThanOrEqual(15_000);

    // /__kernel adds the four reference views to the bell: still ONE poll.
    const polls = countVersionPolls(page);
    const kernelAt = versionPollTimes(page);
    await page.goto("/__kernel");
    await expect(page.getByRole("list", { name: "Classes", exact: true }).getByRole("listitem").filter({ has: page.locator("strong") })).toHaveCount(fx.expected.classes, { timeout: 20_000 });
    const atOpen = polls();
    await page.waitForTimeout(22_000);
    const after22s = polls();
    expect(atOpen, "the poll runs as soon as a desk query is mounted").toBeGreaterThanOrEqual(1);
    expect(after22s - atOpen, "and again 20 s later").toBeGreaterThanOrEqual(1);
    expect(after22s, "the bell and the views share one poll: not more than once per 20 s (+ the first)").toBeLessThanOrEqual(3);
    expect(minGap(kernelAt), "one poll per tab, never a burst").toBeGreaterThanOrEqual(15_000);
    await metric(testInfo, "poll", { onMasters25s: onMasters, kernelAtOpen: atOpen, kernelAfter22s: after22s, kernelMinGapMs: minGap(kernelAt) });
  } finally {
    await context.close();
  }

  // A family's portal: no versions poll at all (its bell re-asks its own list).
  const family = await browser.newContext({ baseURL: APP_URL });
  try {
    await family.addCookies([{ name: demoSessionCookieName(), value: mintSessionCookie(PARENT), url: APP_URL, httpOnly: true, sameSite: "Lax" }]);
    const page = await family.newPage();
    const polls = countVersionPolls(page);
    await page.goto("/parent");
    await page.waitForTimeout(22_000);
    expect(polls(), "a family never polls versions").toBe(0);
  } finally {
    await family.close();
  }
});

test("versions poll: a 403 stops it quietly; a 503 keeps the list on screen", async ({ browser }, testInfo) => {
  const { context, page } = await openAs(browser, "office");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  try {
    let status = 403;
    await page.route(`**${VERSIONS}`, (r) =>
      r.fulfill({ status, contentType: "application/json", body: JSON.stringify({ ok: false, error: status === 403 ? "Staff only" : "unavailable" }) }),
    );
    const polls = countVersionPolls(page);
    const classes = page.getByRole("list", { name: "Classes", exact: true }).getByRole("listitem").filter({ has: page.locator("strong") });

    await page.goto("/__kernel");
    await expect(classes).toHaveCount(fx.expected.classes, { timeout: 20_000 });
    await page.waitForTimeout(23_000);
    const after403 = polls();
    expect(after403, "after a 403 the page asks no more").toBe(1);
    await expect(classes).toHaveCount(fx.expected.classes);

    status = 503;
    await page.reload();
    await expect(classes).toHaveCount(fx.expected.classes, { timeout: 20_000 });
    const before = polls();
    await page.waitForTimeout(23_000);
    expect(polls() - before, "a 503 does not stop the poll").toBeGreaterThanOrEqual(1);
    await expect(classes, "a 503 changes nothing on screen").toHaveCount(fx.expected.classes);
    expect(errors, "no page error or console error from the poll").toEqual([]);
    await metric(testInfo, "poll-failures", { after403, pollsDuring503: polls() - before });
  } finally {
    await context.close();
  }
});

test("/__kernel: a failed masters view is \"could not load\" + Try again, never an empty list; Try again recovers", async ({ browser }, testInfo) => {
  const { context, page } = await openAs(browser, "office");
  try {
    let hits = 0;
    await page.route("**/api/data/views/masters", (r) => {
      hits += 1;
      return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Could not read the school setup — please try again." }) });
    });
    const t0 = Date.now();
    await page.goto("/__kernel");
    await test.step("the failure is shown (after the two retries)", async () => {
      await expect(page.getByText("Could not load the school's classes from the server.")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await expect(page.getByRole("list", { name: "Classes", exact: true })).toHaveCount(0);
    });
    const shownAfterMs = Date.now() - t0;
    expect(hits, "one read + two retries").toBe(3);
    await test.step("Try again (read restored) brings the classes back without a reload", async () => {
      await page.unroute("**/api/data/views/masters");
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByRole("list", { name: "Classes", exact: true }).getByRole("listitem").filter({ has: page.locator("strong") })).toHaveCount(fx.expected.classes, { timeout: 15_000 });
    });
    await metric(testInfo, "kernel-error", { failureShownAfterMs: shownAfterMs, reads: hits });
  } finally {
    await context.close();
  }
});
