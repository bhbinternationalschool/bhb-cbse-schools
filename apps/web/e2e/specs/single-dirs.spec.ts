/**
 * single-dirs — data-layer 2.1i: the screens of the single-file component
 * directories read Masters from the query kernel (useScreenMasters: the
 * server's book kept fresh by the versions poll, plus the access copy's
 * staff roster) — never the page copy read once at mount, and with no
 * ensureMastersHydrated of their own.
 *
 *   1. Seen: every converted screen, desktop-light and 375 px dark, drawn
 *      from the Masters view (where a screen lists classes, all 15), no page
 *      error.
 *   2. Failed read: GET /api/data/views/masters answering 503 makes each
 *      screen say "could not load" + Try again and draw nothing computed from
 *      the missing book (no class list, no permission-gated tabs, no billable
 *      days on the accounts "daily rate" spread — an unread holiday calendar
 *      would bill the shut days); Try again brings it back without a reload.
 *      On origin/main these screens never ask the view and draw from the page
 *      copy, so the "could not load" step fails there.
 *
 * Not covered here: components/rte/RteWorkspace (writes Masters — 2.2) and
 * components/login/LoginPanel (runs before there is a session), which stay
 * on loadMasters() by design.
 */
import type { Browser, Page } from "@playwright/test";
import { APP_URL, collectPageErrors, expect, fx, metric, signIn, test, type Who } from "../support";
import { teachingMastersSubset } from "@/lib/mastersTeachingSubset";

const FAILED_READ = JSON.stringify({ ok: false, error: "Could not read the school setup — please try again." });
const N = fx.expected.classes;

async function failMastersView(page: Page): Promise<() => Promise<number>> {
  const pattern = "**/api/data/views/masters";
  let hits = 0;
  await page.route(pattern, (route) => {
    hits += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: FAILED_READ });
  });
  return async () => {
    await page.unroute(pattern);
    return hits;
  };
}

/**
 * Answer views/masters as the server answers someone without the Masters
 * grant: scope "teaching", the real book cut by the server's own
 * teachingMastersSubset (fee groups, heads, structure, concessions withheld).
 */
async function answerTeachingScope(page: Page): Promise<() => number> {
  let hits = 0;
  await page.route("**/api/data/views/masters", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { ok: boolean; data?: { scope: string; masters: Record<string, unknown> } };
    if (body.ok && body.data) {
      hits += 1;
      body.data = { scope: "teaching", masters: { version: body.data.masters.version, ...teachingMastersSubset(body.data.masters) } };
    }
    await route.fulfill({ response: res, json: body });
  });
  return () => hits;
}

/** The select inside the label whose text starts with `label`. */
const selectIn = (page: Page, label: RegExp) => page.locator("label", { hasText: label }).locator("select").first();

type Screen = {
  name: string;
  who: Who;
  path: string;
  /** Visible only once the screen has its Masters answer. */
  ready: (page: Page) => Promise<void>;
  /** Run after the page is open, before `ready` (e.g. tick a checkbox). */
  prepare?: (page: Page) => Promise<void>;
  /** What must NOT be drawn while the read failed (and is scrolled to for the screenshots). */
  absent: (page: Page) => ReturnType<Page["locator"]>;
  /**
   * The screen stays usable without Masters (the gate, the infirmary —
   * director's standard): while the read fails `absent` must be DRAWN and
   * working, with an in-place "could not load" + Try again for the names.
   */
  usableWithoutMasters?: true;
};

const classSelect = (page: Page) => selectIn(page, /^Class/);

const SCREENS: Screen[] = [
  {
    name: "certificates",
    who: "office",
    path: "/certificates",
    ready: async (p) => expect(classSelect(p).locator("option")).toHaveCount(N + 1, { timeout: 20_000 }),
    absent: (p) => p.getByText("Find student", { exact: true }),
  },
  {
    name: "complaints",
    who: "office",
    path: "/complaints",
    ready: async (p) => expect(p.getByText("No complaints match this filter.")).toBeVisible({ timeout: 20_000 }),
    absent: (p) => p.getByText("No complaints match this filter."),
  },
  {
    name: "discipline",
    who: "principal",
    path: "/discipline",
    ready: async (p) => expect(p.getByRole("tab").first()).toBeVisible({ timeout: 20_000 }),
    absent: (p) => p.getByRole("tab"),
  },
  {
    name: "documents",
    who: "office",
    path: "/documents",
    ready: async (p) => expect(p.getByRole("heading", { name: "Compose" })).toBeVisible({ timeout: 20_000 }),
    absent: (p) => p.getByRole("heading", { name: "Compose" }),
  },
  {
    name: "health",
    who: "office",
    path: "/health",
    ready: async (p) => expect(p.getByRole("tab", { name: "Visit log" })).toBeVisible({ timeout: 20_000 }),
    absent: (p) => p.getByRole("tab", { name: "Visit log" }),
    usableWithoutMasters: true,
  },
  {
    name: "id-cards",
    who: "office",
    path: "/id-cards",
    ready: async (p) => expect(classSelect(p).locator("option")).toHaveCount(N + 1, { timeout: 20_000 }),
    absent: (p) => p.getByRole("tab", { name: "Staff ID cards" }),
  },
  {
    name: "inventory-counter",
    who: "office",
    path: "/inventory",
    // The counter's class filter ("Any class" + one per class).
    ready: async (p) =>
      expect(p.locator("select").filter({ has: p.locator("option", { hasText: "Any class" }) }).first().locator("option")).toHaveCount(N + 1, {
        timeout: 20_000,
      }),
    absent: (p) => p.locator("option", { hasText: "Any class" }),
  },
  {
    name: "library",
    who: "office",
    path: "/library",
    ready: async (p) => expect(p.getByRole("tab", { name: "Circulation & fines" })).toBeVisible({ timeout: 20_000 }),
    absent: (p) => p.getByRole("tab", { name: "Circulation & fines" }),
  },
  {
    name: "ptm",
    who: "office",
    path: "/ptm",
    ready: async (p) => expect(p.getByRole("tab", { name: "Slots" })).toBeVisible({ timeout: 20_000 }),
    absent: (p) => p.getByRole("tab", { name: "Slots" }),
  },
  {
    name: "student-leave",
    who: "office",
    path: "/student-leave",
    ready: async (p) => expect(p.getByRole("tab", { name: "Apply (staff)" })).toBeVisible({ timeout: 20_000 }),
    absent: (p) => p.getByRole("tab", { name: "Apply (staff)" }),
  },
  {
    name: "transport",
    who: "office",
    path: "/transport",
    ready: async (p) => expect(p.getByText(/^Vehicle papers/)).toBeVisible({ timeout: 20_000 }),
    absent: (p) => p.getByText(/^Vehicle papers/),
  },
  {
    name: "transport-by-class",
    who: "office",
    path: "/transport?tab=classRosters",
    // One row per section of the book (none has a rider in the fixture).
    ready: async (p) =>
      expect(p.getByRole("button", { name: `Show ${fx.expected.sections} sections with no riders` })).toBeVisible({ timeout: 20_000 }),
    absent: (p) => p.getByRole("heading", { name: "Riders by class & section" }),
  },
  {
    name: "visitors",
    who: "office",
    path: "/visitors",
    ready: async (p) => expect(p.getByRole("button", { name: "Check in", exact: true })).toBeVisible({ timeout: 20_000 }),
    absent: (p) => p.getByRole("button", { name: "Check in", exact: true }),
    usableWithoutMasters: true,
  },
  {
    name: "accounts-daily-rate",
    who: "office",
    path: "/accounts?tab=vouchers",
    prepare: async (p) => {
      await p.getByRole("checkbox", { name: /Bill a daily rate over a range/ }).check({ timeout: 20_000 });
    },
    ready: async (p) => expect(p.getByText(/day\(s\) ×/)).toBeVisible({ timeout: 20_000 }),
    absent: (p) => p.getByText(/day\(s\) ×/),
  },
];

async function phoneDark(browser: Browser, who: Who): Promise<Page> {
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 375, height: 812 }, colorScheme: "dark" });
  await signIn(context, who);
  return context.newPage();
}

async function desktopLight(browser: Browser, who: Who): Promise<Page> {
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  await signIn(context, who);
  return context.newPage();
}

async function disciplineEnabled(page: Page): Promise<boolean | null> {
  const r = await page.request.get("/api/data/views/module-registry");
  const body = (await r.json().catch(() => null)) as { data?: { enabled?: Record<string, boolean> }; enabled?: Record<string, boolean> } | null;
  const v = (body?.data?.enabled ?? body?.enabled)?.discipline;
  return typeof v === "boolean" ? v : null;
}

/**
 * Discipline is a default-off module (lib/moduleRegistry.ts): the fixture
 * school has it switched off, so the principal is shown "Access restricted".
 * Switch it on through the app's own Modules screen for this file, and put
 * back whatever it WAS afterwards (read first; afterAll runs even when a test
 * or beforeAll failed), so no later spec sees a different module list.
 * Idempotent: a module already in the wanted state is left alone.
 */
async function setDiscipline(browser: Browser, enabled: boolean): Promise<void> {
  const page = await desktopLight(browser, "principal");
  if ((await disciplineEnabled(page)) === enabled) {
    await page.context().close();
    return;
  }
  await page.goto("/modules");
  const row = page.locator("li", { hasText: "Discipline / behavior" }).first();
  await row.getByRole("button", { name: enabled ? "Enable" : "Disable" }).click({ timeout: 20_000 });
  await expect
    .poll(() => disciplineEnabled(page), { timeout: 30_000, message: `module registry saved discipline=${enabled}` })
    .toBe(enabled);
  await page.context().close();
}

/** Discipline's state before this file touched it (null = not read yet). */
let disciplineBefore: boolean | null = null;
test.beforeAll(async ({ browser }) => {
  const page = await desktopLight(browser, "principal");
  disciplineBefore = await disciplineEnabled(page);
  await page.context().close();
  expect(disciplineBefore, "module registry readable before the file changes it").not.toBeNull();
  await setDiscipline(browser, true);
});
test.afterAll(async ({ browser }) => {
  if (disciplineBefore !== null) await setDiscipline(browser, disciplineBefore);
});

async function open(page: Page, s: Screen): Promise<void> {
  await page.goto(s.path);
  if (s.prepare) await s.prepare(page);
}

test.describe("seen: desktop-light and 375 dark, drawn from the Masters view", () => {
  for (const s of SCREENS) {
    test(`${s.who} ${s.name}: drawn, no page error`, async ({ browser }, testInfo) => {
      const desk = await desktopLight(browser, s.who);
      const errors = collectPageErrors(desk);
      await open(desk, s);
      await s.ready(desk);
      await s.absent(desk).first().scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
      await desk.screenshot({ path: testInfo.outputPath(`${s.name}-desktop-light.png`), fullPage: true });
      await desk.context().close();
      const phone = await phoneDark(browser, s.who);
      const phoneErrors = collectPageErrors(phone);
      await open(phone, s);
      await s.ready(phone);
      await s.absent(phone).first().scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
      await phone.screenshot({ path: testInfo.outputPath(`${s.name}-phone375-dark.png`), fullPage: true });
      await phone.context().close();
      expect([...errors, ...phoneErrors], "page errors").toEqual([]);
    });
  }
});

test.describe("views/masters 503 = could not load, never a screen computed from nothing", () => {
  for (const s of SCREENS) {
    test(`${s.who} ${s.name}: "could not load" + Try again; Try again recovers`, async ({ browser }, testInfo) => {
      const page = await desktopLight(browser, s.who);
      const lift = await failMastersView(page);
      const t0 = Date.now();
      await open(page, s);
      await expect(page.getByText(/could not load/i).first()).toBeVisible({ timeout: 30_000 });
      const shownAfterMs = Date.now() - t0;
      await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();
      if (s.usableWithoutMasters) {
        // Drawn and usable — the records and actions do not wait for Masters.
        await expect(s.absent(page).first()).toBeVisible();
      } else {
        await expect(s.absent(page)).toHaveCount(0);
      }
      await page.screenshot({ path: testInfo.outputPath(`${s.name}-failed-read-desktop-light.png`), fullPage: true });
      const hits = await lift();
      expect(hits, "the screen asked views/masters").toBeGreaterThan(0);
      await page.getByRole("button", { name: "Try again" }).first().click();
      await s.ready(page);
      if (s.usableWithoutMasters) await expect(page.getByText(/could not load/i)).toHaveCount(0, { timeout: 20_000 });
      await metric(testInfo, "error", { page: s.path, read: "views/masters", failureShownAfterMs: shownAfterMs });
      await page.context().close();
    });
  }
});

// ── 2.1i review fixes ──────────────────────────────────────────────────────

const CHILD = fx.sis.students.find((st) => st.academicYearCode === "2026-27" && st.status === "active")!;

test.describe("views/masters 503: the gate and the infirmary still work", () => {
  test("office health: visit log, records and the student picker work; class names say …", async ({ browser }, testInfo) => {
    for (const shot of [{ dark: false }, { dark: true }]) {
      const page = shot.dark ? await phoneDark(browser, "office") : await desktopLight(browser, "office");
      const lift = await failMastersView(page);
      await page.goto("/health");
      await expect(page.getByText(/could not load class and section names/i)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("tab", { name: "Visit log" })).toBeVisible();
      await page.getByPlaceholder("Search name or admission no…").first().fill(CHILD.fullName);
      await page.getByRole("button", { name: new RegExp(CHILD.fullName) }).first().click({ timeout: 20_000 });
      // The picked child: name shown, class/section "…" (Masters not read) — never a guessed label.
      await expect(page.getByText(`${CHILD.fullName} · …`)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`health-no-masters-${shot.dark ? "phone375-dark" : "desktop-light"}.png`), fullPage: true });
      expect(await lift()).toBeGreaterThan(0);
      await page.context().close();
    }
  });

  test("office visitors: check-in form and register drawn, Check in enabled; names say …", async ({ browser }, testInfo) => {
    for (const shot of [{ dark: false }, { dark: true }]) {
      const page = shot.dark ? await phoneDark(browser, "office") : await desktopLight(browser, "office");
      const lift = await failMastersView(page);
      await page.goto("/visitors");
      await expect(page.getByText(/could not load class, section and staff names/i)).toBeVisible({ timeout: 30_000 });
      const checkIn = page.getByRole("button", { name: "Check in", exact: true });
      await expect(checkIn).toBeVisible();
      await expect(checkIn).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath(`visitors-no-masters-${shot.dark ? "phone375-dark" : "desktop-light"}.png`), fullPage: true });
      expect(await lift()).toBeGreaterThan(0);
      await page.context().close();
    }
  });
});

test.describe("teaching-scope Masters (fee lists withheld): unknown, never ₹0", () => {
  test("certificates search: 'dues: not shown for your role', no 'open dues ₹'", async ({ browser }, testInfo) => {
    const page = await desktopLight(browser, "office");
    const hits = await answerTeachingScope(page);
    await page.goto("/certificates");
    await page.getByPlaceholder("Name, admission no, or mobile…").fill(CHILD.fullName, { timeout: 20_000 });
    const hit = page.getByRole("button", { name: new RegExp(CHILD.fullName) }).first();
    await expect(hit).toContainText("dues: not shown for your role", { timeout: 20_000 });
    await expect(hit).not.toContainText("open dues");
    expect(hits()).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("certificates-teaching-desktop-light.png"), fullPage: false });
    await page.context().close();
  });

  test("documents 'Insert school facts': no '0 fee structures' line", async ({ browser }) => {
    const page = await desktopLight(browser, "office");
    await answerTeachingScope(page);
    await page.goto("/documents?type=compliance_narrative");
    await page.getByRole("button", { name: /Insert school facts from the ERP/ }).click({ timeout: 20_000 });
    const box = page.getByPlaceholder("Student name, dates, purpose, reference numbers, addresses…");
    await expect(box).toHaveValue(/Fee: not available for your role/, { timeout: 15_000 });
    expect(await box.inputValue()).not.toMatch(/\b0 fee structures?\b/);
    await page.context().close();
  });

  test("documents 'Insert school facts', full scope: the real count", async ({ browser }) => {
    const page = await desktopLight(browser, "office");
    await page.goto("/documents?type=compliance_narrative");
    await page.getByRole("button", { name: /Insert school facts from the ERP/ }).click({ timeout: 20_000 });
    await expect(page.getByPlaceholder("Student name, dates, purpose, reference numbers, addresses…")).toHaveValue(/Fee: \d+ fee structures? published/, {
      timeout: 15_000,
    });
    await page.context().close();
  });
});
