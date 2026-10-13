/**
 * counts — every main screen shows the seeded school, read from the DOM.
 *
 * As the office, each page is opened cold. Two separate assertions, so a
 * failure says which one broke:
 *   1. count  — the screen shows the seeded number (polled for up to
 *               CORRECT_WITHIN_MS = 30 s: a wrong number is a wrong number,
 *               however long one waits);
 *   2. speed  — it showed it within SPEED_MS = 5 s of the navigation starting
 *               (step "speed"; only reachable when the count is right).
 * Runs in the `desktop` project and in `phone-375-cpu4x` (375 px, touch, CPU
 * throttled 4× via CDP). The time each page took is on the scoreboard.
 *
 * What each screen renders, and the selector used (roles / labels / visible
 * text; one data-testid):
 *   /staff       the module dashboard's "Active staff" card — a button whose
 *                name starts "Active staff"; its number is the card's
 *                `data-testid="metric-value"` (components/ui/erp-roster.tsx).
 *                Seeded: 34 active staff.
 *   /students    the module dashboard's "Active students" card, same hook.
 *                Seeded: 250 active children in 2026-27 (the dashboard says
 *                "this year only").
 *   /masters     the overview cards — buttons named "<n> Classes" and
 *                "<n> Subjects" (active classes, active subjects incl.
 *                components). Seeded: 15 and 44.
 *   /attendance  Students tab → the "Class" picker has one option per class
 *                (15, besides "Select class…"); V-A's register shows
 *                "Strength <n>" = the 2026-27 active children of V-A (19).
 *   /timetable   the "Class" picker (15 besides "Select…"); Subject rules for
 *                V says "<n> periods a week asked" = the periods of V's 9
 *                class–subject links (45).
 *   /homework    the "Class" picker (15); Compose HW's "Subject" picker lists
 *                the school's subjects (heads only — components are not
 *                offered): 22.
 *
 * Known defects (13 Oct 2026, origin/main 0a9ae0c3) are marked test.fail()
 * with what the screen showed; see KNOWN below. When one is fixed the test
 * passes, Playwright reports it as an unexpected pass and the run goes red:
 * remove its entry from KNOWN.
 */
import type { Page, TestInfo } from "@playwright/test";
import { AY_CURRENT, classId, sectionId } from "../fixture";
import { collectPageErrors, expect, fx, leadingNumber, metric, note, test } from "../support";

const SPEED_MS = 5_000;
const CORRECT_WITHIN_MS = 30_000;

const e = fx.expected;
const CLASS_V = classId(8);
const SECTION_VA = sectionId(8);
const vaChildren = fx.sis.students.filter(
  (s) => s.sectionId === SECTION_VA && s.academicYearCode === AY_CURRENT && s.status === "active",
).length;
const vLinks = fx.masters.classSubjects.filter((l) => l.classId === CLASS_V && l.isActive);
const vPeriods = vLinks.reduce((n, l) => n + l.periodsPerWeek, 0);
const subjectHeads = fx.masters.subjects.filter((s) => !s.parentId && s.isActive).length;

/**
 * Known failures, per project and page, with what was seen. Measured on the
 * Mac and in CI; the reason is the annotation the scoreboard shows.
 */
const KNOWN: Record<string, Partial<Record<string, string>>> = {
  desktop: {
    "/staff":
      "shows 0 active staff (seeded 34) although GET /api/school-data/staff-roster returns all 35 to the page: " +
      "the Staff screen's copy of the roster never receives them (S1). Until steps 1.4/2.1.",
    "/students":
      "the page crashes — React #185 'Maximum update depth exceeded' (a dev build points at ErpSidebar's route " +
      "effect) whenever the roster holds students; no count is drawn (S2). Until step 3.x.",
    "/attendance":
      "V-A's 2026-27 register counts rows with a BLANK academic year as this year's: other children's old rows " +
      "join it (unknown became fact, S2); the admission numbers are in the metric. Until step 3.1.",
  },
  "phone-375-cpu4x": {
    "/staff": "as desktop: 0 active staff (seeded 34). Until steps 1.4/2.1.",
    "/students": "no Active students card within 5 s; the same page crashes with React #185 on desktop. Until step 3.x.",
    "/attendance": "as desktop: blank-year rows counted into V-A's 2026-27 register. Until step 3.1.",
  },
};

/** Options of a <select>, without its "Select…" placeholder. */
async function realOptions(page: Page, name: string): Promise<string[]> {
  const labels = await page.getByRole("combobox", { name, exact: true }).first().locator("option").allTextContents();
  return labels.map((l) => l.trim()).filter((l) => l && !/^select/i.test(l));
}

async function metricValue(page: Page, title: RegExp): Promise<number | null> {
  const card = page.getByRole("button", { name: title }).first();
  if (!(await card.count())) return null;
  return leadingNumber(await card.getByTestId("metric-value").textContent());
}

type Check = {
  what: string;
  expected: number;
  read: (page: Page) => Promise<number | null>;
  /** On a wrong number, what exactly the screen holds (recorded in the metric). */
  diagnose?: (page: Page) => Promise<unknown>;
};

/** The admission numbers a register shows, sorted against the fixture's V-A rows by year. */
async function registerRows(page: Page): Promise<unknown> {
  // Each register row is a list item: "<initials> <NAME> E2E-0146" plus the P/A/L buttons.
  const items = await page.getByRole("listitem").filter({ hasText: /E2E-\d{4}/ }).allTextContents();
  const shown = items.map((t) => /E2E-\d{4}/.exec(t)?.[0] ?? "").filter(Boolean);
  const thisYear = new Set(
    fx.sis.students
      .filter((s) => s.sectionId === SECTION_VA && s.academicYearCode === AY_CURRENT && s.status === "active")
      .map((s) => s.admissionNo),
  );
  const extra = shown.filter((a) => !thisYear.has(a));
  const extraRows = fx.sis.students
    .filter((s) => s.sectionId === SECTION_VA && extra.includes(s.admissionNo) && s.status === "active")
    .map((s) => `${s.admissionNo} (${s.academicYearCode || "blank year"}; now in ${fx.sis.students.find((c) => c.admissionNo === s.admissionNo && c.academicYearCode === AY_CURRENT)?.sectionId ?? "?"})`);
  return { shown: shown.length, missing: [...thisYear].filter((a) => !shown.includes(a)), extra: extraRows };
}

const PAGES: { path: string; prepare?: (page: Page) => Promise<void>; checks: Check[] }[] = [
  {
    path: "/staff",
    checks: [{ what: "active staff", expected: e.activeStaff, read: (p) => metricValue(p, /^Active staff/) }],
  },
  {
    path: "/students",
    checks: [{ what: "active students 2026-27", expected: e.currentYearActiveChildren, read: (p) => metricValue(p, /^Active students/) }],
  },
  {
    path: "/masters",
    checks: [
      { what: "classes", expected: e.classes, read: async (p) => leadingNumber(await p.getByRole("button", { name: /^\d+ Classes$/ }).first().textContent().catch(() => null)) },
      { what: "subjects", expected: e.subjects, read: async (p) => leadingNumber(await p.getByRole("button", { name: /^\d+ Subjects$/ }).first().textContent().catch(() => null)) },
    ],
  },
  {
    path: "/attendance",
    prepare: async (p) => {
      await p.getByRole("tab", { name: "Students", exact: true }).click();
    },
    checks: [
      { what: "classes in the picker", expected: e.classes, read: async (p) => (await realOptions(p, "Class")).length },
      {
        what: "V-A register strength",
        expected: vaChildren,
        read: async (p) => {
          const cls = p.getByRole("combobox", { name: "Class", exact: true }).first();
          if ((await cls.inputValue()) !== CLASS_V) await cls.selectOption({ label: "V" });
          const sec = p.getByRole("combobox", { name: "Section", exact: true }).first();
          if ((await sec.inputValue()) !== SECTION_VA) await sec.selectOption({ label: "A" }).catch(() => undefined);
          const m = /Strength\s+(\d+)/.exec((await p.getByText(/^Strength\s+\d+$/).first().textContent().catch(() => null)) ?? "");
          return m ? Number(m[1]) : null;
        },
        diagnose: registerRows,
      },
    ],
  },
  {
    path: "/timetable",
    checks: [
      { what: "classes in the picker", expected: e.classes, read: async (p) => (await realOptions(p, "Class")).length },
      {
        what: "class V periods asked (Subject rules)",
        expected: vPeriods,
        read: async (p) => {
          const tab = p.getByRole("tab", { name: "Subject rules", exact: true });
          if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
          const cls = p.getByRole("combobox", { name: "Class", exact: true }).first();
          if ((await cls.inputValue().catch(() => "")) !== CLASS_V) await cls.selectOption({ label: "V" });
          const m = /(\d+) periods a week asked/.exec((await p.getByText(/periods a week asked/).first().textContent().catch(() => null)) ?? "");
          return m ? Number(m[1]) : null;
        },
      },
    ],
  },
  {
    path: "/homework",
    checks: [
      { what: "classes in the picker", expected: e.classes, read: async (p) => (await realOptions(p, "Class")).length },
      {
        what: "subjects offered in Compose HW",
        expected: subjectHeads,
        read: async (p) => {
          const tab = p.getByRole("tab", { name: "Compose HW", exact: true });
          if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
          return (await realOptions(p, "Subject")).length;
        },
      },
    ],
  },
];

async function checkPage(page: Page, testInfo: TestInfo, path: string, prepare: ((p: Page) => Promise<void>) | undefined, checks: Check[]) {
  const errors = collectPageErrors(page);
  const t0 = Date.now();
  const deadline = t0 + CORRECT_WITHIN_MS;
  const timings: Record<string, number | null> = {};
  const seen: Record<string, number | null> = {};
  const diagnosis: Record<string, unknown> = {};
  try {
    await test.step(`open ${path}`, async () => {
      await page.goto(path, { timeout: CORRECT_WITHIN_MS });
    });
    if (prepare) {
      await test.step("prepare", async () => {
        await expect(async () => prepare(page)).toPass({ timeout: Math.max(1, deadline - Date.now()) });
      });
    }
    for (const c of checks) {
      timings[c.what] = null;
      await test.step(`${c.what} = ${c.expected}`, async () => {
        const poll = expect
          .poll(
            async () => {
              const v = await c.read(page).catch(() => null);
              seen[c.what] = v;
              return v;
            },
            { message: `${path}: ${c.what}`, timeout: Math.max(1, deadline - Date.now()), intervals: [100, 250, 500] },
          )
          .toBe(c.expected);
        try {
          await poll;
        } catch (err) {
          if (c.diagnose) diagnosis[c.what] = await c.diagnose(page).catch((x: unknown) => String(x));
          throw err;
        }
        timings[c.what] = Date.now() - t0;
      });
    }
    await test.step(`speed: every number shown within ${SPEED_MS} ms`, async () => {
      const slowest = Math.max(...Object.values(timings).map((v) => v ?? Infinity));
      expect(slowest, `${path}: ms until the last number was right (${JSON.stringify(timings)})`).toBeLessThanOrEqual(SPEED_MS);
    });
  } finally {
    await metric(testInfo, "dom", {
      page: path,
      speedLimitMs: SPEED_MS,
      expected: Object.fromEntries(checks.map((c) => [c.what, c.expected])),
      seen,
      msToShow: timings,
      pageErrors: errors.slice(0, 3),
      ...(Object.keys(diagnosis).length ? { diagnosis } : {}),
    });
    if (errors.length) note(testInfo, "page error", errors[0]!);
  }
}

for (const p of PAGES) {
  test(`office ${p.path} shows the seeded counts within 5 s`, async ({ page }, testInfo) => {
    const known = KNOWN[testInfo.project.name]?.[p.path];
    test.fail(!!known, known);
    await checkPage(page, testInfo, p.path, p.prepare, p.checks);
  });
}
