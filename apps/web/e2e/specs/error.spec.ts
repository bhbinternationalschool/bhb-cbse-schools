/**
 * error — a failed Masters read is shown as a failure, never as an empty school.
 *
 * The read that fails answers exactly what its route answers when the
 * database read fails (data-layer 0.5b: 503,
 * `{ ok:false, error:"Could not read the school setup — please try again." }`).
 * Each screen must then say it could not load and offer "Try again" — and must
 * NOT draw its class / subject pickers (an empty picker is the old failure: a
 * read error shown as "this school has no classes"). Then the intercept is
 * lifted and "Try again" must bring the real school back (15 classes) without
 * a page reload.
 *
 * Selectors: the visible text /could not load/i and the button named
 * "Try again" (components/data/QueryError.tsx — the shell's data wait,
 * ShellDataWait, and the screens draw it), and the "Class" combobox.
 *
 * Since data-layer 2.3a the shell waits for GET /api/data/views/masters, not
 * for the old masters-desk hydrate (CoreDataGate is gone). A masters-desk 503
 * is therefore no longer a page failure: the first block below proves the
 * screens draw the school from the view while masters-desk fails.
 */
import type { Page } from "@playwright/test";
import { APP_URL, expect, fx, metric, signIn, test } from "../support";

const FAILED_READ = JSON.stringify({ ok: false, error: "Could not read the school setup — please try again." });

async function failMastersReads(page: Page): Promise<() => Promise<void>> {
  const pattern = "**/api/school-data/masters-desk**";
  let hits = 0;
  await page.route(pattern, (route) => {
    if (route.request().method() !== "GET") return route.continue();
    hits += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: FAILED_READ });
  });
  return async () => {
    expect(hits, "the page asked for masters-desk at least once").toBeGreaterThan(0);
    await page.unroute(pattern);
  };
}

const PAGES: { path: string; afterRecovery: (page: Page) => Promise<void> }[] = [
  {
    path: "/masters",
    afterRecovery: async (p) => {
      await expect(p.getByRole("button", { name: `${fx.expected.classes} Classes`, exact: true })).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    path: "/attendance",
    afterRecovery: async (p) => {
      await p.getByRole("tab", { name: "Students", exact: true }).click({ timeout: 15_000 });
      await expect(p.getByRole("combobox", { name: "Class", exact: true }).first().locator("option")).toHaveCount(fx.expected.classes + 1, { timeout: 15_000 });
    },
  },
  {
    path: "/timetable",
    afterRecovery: async (p) => {
      await expect(p.getByRole("combobox", { name: "Class", exact: true }).first().locator("option")).toHaveCount(fx.expected.classes + 1, { timeout: 15_000 });
    },
  },
  {
    path: "/homework",
    afterRecovery: async (p) => {
      // /homework's class picker has no "Select…" placeholder.
      await expect(p.getByRole("combobox", { name: "Class", exact: true }).first().locator("option")).toHaveCount(fx.expected.classes, { timeout: 15_000 });
    },
  },
  {
    // 2.1b: the Students register's class filter ("All classes" + one per class).
    path: "/students?tab=register",
    afterRecovery: async (p) => {
      await expect(p.getByRole("combobox", { name: "Filter by class", exact: true }).first().locator("option")).toHaveCount(fx.expected.classes + 1, { timeout: 15_000 });
    },
  },
];

for (const p of PAGES) {
  test(`office ${p.path}: masters-desk 503 (the old hydrate) no longer blocks — the school is drawn from views/masters`, async ({ page }, testInfo) => {
    const lift = await failMastersReads(page);
    const t0 = Date.now();
    await page.goto(p.path);
    await test.step("the school's classes are on screen although masters-desk fails", async () => {
      await p.afterRecovery(page);
    });
    const shownAfterMs = Date.now() - t0;
    await expect(page.getByText(/could not load/i)).toHaveCount(0);
    await lift();
    await metric(testInfo, "error", { page: p.path, read: "masters-desk (not waited for)", schoolShownAfterMs: shownAfterMs });
  });
}

/**
 * The same rule for the masters view (data-layer 2.1a; since 2.3a the shell
 * waits for it on every page): GET /api/data/views/masters failing must show
 * "could not load" + Try again and no class picker — while masters-desk
 * answers normally, so only the new read is failing. On origin/main before
 * 2.1a these screens never asked the view: the intercept saw no request and
 * the page drew its pickers.
 */
async function failMastersView(page: Page): Promise<() => Promise<void>> {
  const pattern = "**/api/data/views/masters";
  let hits = 0;
  await page.route(pattern, (route) => {
    hits += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: FAILED_READ });
  });
  return async () => {
    expect(hits, "the page asked the masters view at least once").toBeGreaterThan(0);
    await page.unroute(pattern);
  };
}

// 2.1h: /masters reads the view too (MastersWorkspace → useScreenMasters).
for (const p of PAGES) {
  test(`office ${p.path}: views/masters 503 shows "could not load" + Try again, not empty pickers; Try again recovers`, async ({ page }, testInfo) => {
    const lift = await failMastersView(page);
    const t0 = Date.now();
    await page.goto(p.path);
    await test.step("the failure is shown", async () => {
      await expect(page.getByText(/could not load/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    });
    const shownAfterMs = Date.now() - t0;
    await test.step("no class picker is drawn from a failed read", async () => {
      await expect(page.getByRole("combobox", { name: "Class", exact: true })).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "Filter by class", exact: true })).toHaveCount(0);
    });
    await test.step("Try again (read restored) brings the school back without a reload", async () => {
      await lift();
      await page.getByRole("button", { name: "Try again" }).click();
      await p.afterRecovery(page);
    });
    await metric(testInfo, "error", { page: p.path, read: "views/masters", failureShownAfterMs: shownAfterMs });
  });
}

/**
 * Staff panels (data-layer 2.1c). Two reads, each failed on its own:
 *   - views/masters  → the Leave tab (useScreenMasters) says "could not load"
 *     and draws no leave form; Try again brings the form back;
 *   - views/staff-list → the Appraisal tab (useStaffList) says "could not load
 *     the staff list" and draws no Staff picker — never a picker with nobody
 *     in it; Try again brings every active member of staff back.
 * On origin/main before 2.1c neither panel asked either view (hits = 0).
 */
async function failView(page: Page, name: "masters" | "staff-list"): Promise<() => Promise<void>> {
  const pattern = `**/api/data/views/${name}`;
  let hits = 0;
  await page.route(pattern, (route) => {
    hits += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: FAILED_READ });
  });
  return async () => {
    expect(hits, `the page asked views/${name} at least once`).toBeGreaterThan(0);
    await page.unroute(pattern);
  };
}

test(`office /staff Leave: views/masters 503 shows "could not load" + Try again, no leave form; Try again recovers`, async ({ page }, testInfo) => {
  const lift = await failView(page, "masters");
  const t0 = Date.now();
  await page.goto("/staff?tab=leave");
  await expect(page.getByText(/could not load/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  const shownAfterMs = Date.now() - t0;
  await expect(page.getByRole("tab", { name: "Request leave", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Staff", exact: true })).toHaveCount(0);
  await lift();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("tab", { name: "Request leave", exact: true })).toBeVisible({ timeout: 15_000 });
  // The request form's Staff picker: every active member of staff + "Select…".
  await expect(page.getByRole("combobox", { name: "Staff", exact: true }).locator("option")).toHaveCount(fx.expected.activeStaff + 1);
  await metric(testInfo, "error", { page: "/staff?tab=leave", read: "views/masters", failureShownAfterMs: shownAfterMs });
});

// Since 2.3a the access copy is the staff-list view: with it failing the
// module gate says the staff list did not load (before the panel's own
// "could not load the staff list" can show) — never a Staff picker with
// nobody in it, never "Access restricted".
test(`office /staff Appraisal: views/staff-list 503 shows "did not load" + Try again, no empty Staff picker; Try again recovers`, async ({ page }, testInfo) => {
  const lift = await failView(page, "staff-list");
  const t0 = Date.now();
  await page.goto("/staff?tab=appraisal");
  await expect(page.getByText(/did not load|could not load the staff list/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();
  await expect(page.getByText("Access restricted")).toHaveCount(0);
  const shownAfterMs = Date.now() - t0;
  await expect(page.getByRole("combobox", { name: "Staff", exact: true })).toHaveCount(0);
  await lift();
  await page.getByRole("button", { name: "Try again" }).first().click();
  // Every active member of staff + "Select…".
  await expect(page.getByRole("combobox", { name: "Staff", exact: true }).locator("option")).toHaveCount(fx.expected.activeStaff + 1, { timeout: 15_000 });
  await metric(testInfo, "error", { page: "/staff?tab=appraisal", read: "views/staff-list", failureShownAfterMs: shownAfterMs });
});

/**
 * The access copy (data-layer 2.3a): every permission check now decides with
 * useRbac() + useStaffList(). With GET /api/data/views/staff-list failing
 * (503), a gated module must say the staff list DID NOT LOAD and offer Try
 * again — never "Access restricted" (a no decided on an empty roster) and
 * never the module drawn as if the roster were known. Lifting the intercept
 * and pressing Try again opens the module without a reload.
 * On origin/main before 2.3a the access copy read the page copy (the old
 * staff-roster hydrate): the page never asked the staff-list view for its
 * decision, so the module opened and "did not load" never showed.
 */
const ACCESS_503: { who: "office" | "teacher"; path: string; opened: (p: Page) => Promise<void> }[] = [
  {
    who: "office",
    path: "/students",
    opened: async (p) => {
      await expect(p.getByRole("button", { name: /^Active students/ }).first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    who: "teacher",
    path: "/attendance",
    opened: async (p) => {
      await expect(p.getByText(/Nursery\s*·\s*A/).first()).toBeVisible({ timeout: 20_000 });
    },
  },
];

for (const c of ACCESS_503) {
  test(`${c.who} ${c.path}: views/staff-list 503 shows "did not load" + Try again, never "Access restricted"; Try again opens the module`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 } });
    await signIn(context, c.who);
    const page = await context.newPage();
    try {
      const lift = await failView(page, "staff-list");
      const t0 = Date.now();
      await page.goto(c.path);
      await test.step("the failure is shown, not a refusal", async () => {
        await expect(page.getByText(/did not load/i).first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();
        await expect(page.getByText("Access restricted")).toHaveCount(0);
      });
      const shownAfterMs = Date.now() - t0;
      await test.step("Try again (read restored) opens the module without a reload", async () => {
        await lift();
        await page.getByRole("button", { name: "Try again" }).first().click();
        await c.opened(page);
        await expect(page.getByText("Access restricted")).toHaveCount(0);
      });
      await metric(testInfo, "error", { page: c.path, who: c.who, read: "views/staff-list (access)", failureShownAfterMs: shownAfterMs });
    } finally {
      await context.close();
    }
  });
}

/**
 * Data-layer 2.3b: a save check is decided on the roles and roster the
 * module gate uses (views/rbac + views/staff-list), not the page copies.
 * The certificates clerk's Students grant is a school-made role assigned to
 * her — it exists only in the stored rbac. Here the old rbac page-copy
 * hydrate (desk-slice/rbac) fails, as it does when it is slow or refused,
 * while the views answer and the old roster copy lands (she is a peon on
 * it, so that copy alone makes her "support"): the clerk opens Students → Birthdays (the gate
 * reads the views) and saves the card settings (lib/birthdayCards
 * saveBirthdayState: assertModulePermission students·edit). The save must go
 * out and she must not be told "You do not have permission".
 * On origin/main before 2.3b-1 the check read loadRbac() — the built-in
 * roles, without her role — and the roster copy: "support", which holds no
 * Students edit — and refused her with "You do not have permission
 * for this action" (no write left the page). The write itself is answered
 * here by the test (503) so the shared stack is not changed.
 */
test(`certClerk /students Birthdays: the rbac page copy fails but views/rbac answered — the save goes out, never "You do not have permission"`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 } });
  await signIn(context, "certClerk");
  const page = await context.newPage();
  try {
    let copyHits = 0;
    await page.route("**/api/school-data/desk-slice/rbac**", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      copyHits += 1;
      return route.fulfill({ status: 503, contentType: "application/json", body: FAILED_READ });
    });
    const writes: string[] = [];
    await page.route("**/api/school-data/module-state/birthday_settings**", (route) => {
      if (route.request().method() === "GET") return route.fallback();
      writes.push(route.request().method());
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "e2e: not written" }) });
    });
    // The old roster page copy lands (she is a peon on it); only the rbac
    // page copy is missing — the state a save check met on old code.
    const rosterCopy = page.waitForResponse((r) => r.url().includes("/api/school-data/staff-roster") && r.request().method() === "GET", { timeout: 30_000 });
    await page.goto("/students?tab=birthdays");
    expect((await rosterCopy).ok(), "the roster page copy answered").toBe(true);
    const principal = page.getByPlaceholder("Blank = signed by the office alone").first();
    await expect(principal).toBeEnabled({ timeout: 30_000 });
    expect(copyHits, "the page asked for the rbac page copy (and it failed)").toBeGreaterThan(0);
    await principal.fill("e2e Principal");
    await page.getByRole("button", { name: "Save birthday settings" }).click();
    await test.step("the save goes out; no permission refusal", async () => {
      await expect.poll(() => writes.length, { timeout: 15_000, message: "the birthday settings write left the page" }).toBeGreaterThan(0);
      await expect(page.getByText(/You do not have permission/)).toHaveCount(0);
    });
    await metric(testInfo, "error", { page: "/students?tab=birthdays", who: "certClerk", read: "desk-slice/rbac (page copy) 503", writes: writes.length });
  } finally {
    await context.close();
  }
});
