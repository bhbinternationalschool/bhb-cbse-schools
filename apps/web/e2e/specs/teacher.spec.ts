/**
 * teacher — a teacher sees exactly her own sections' children: never zero,
 * never the whole school, never another year's rows.
 *
 * Two fixture logins (e2e/fixture.ts):
 *   - the class teacher of Nursery-A (her only tie: class-teacher link);
 *   - the timetable-only teacher: periods in III-A and V-A on the PUBLISHED
 *     timetable and no other link.
 *
 * Screens and selectors:
 *   /attendance  the "Mark register" view. The class teacher's own class
 *                opens by itself ("Nursery · A (class teacher)"); the register
 *                shows "Strength <n>" and one list item per child carrying
 *                the admission number (E2E-0001 …). Expected: exactly her
 *                section's 2026-27 active children.
 *                The timetable-only teacher must be offered her two sections
 *                (not "No classes are assigned to you yet").
 *   /students    the module dashboard's "Active students" card (button named
 *                "Active students…", number in data-testid="metric-value").
 *
 * And with masters-desk failing (503), the teacher sees "could not load" +
 * "Try again", never an empty school.
 */
import type { Page } from "@playwright/test";
import { AY_CURRENT, CLASS_TEACHER, sectionId, TIMETABLE_TEACHER_SECTIONS } from "../fixture";
import { collectPageErrors, expect, fx, leadingNumber, metric, note, openAs, test } from "../support";

const currentRows = (keys: readonly number[]) =>
  fx.sis.students.filter(
    (s) => keys.map(sectionId).includes(s.sectionId) && s.academicYearCode === AY_CURRENT && s.status === "active",
  );
const CT_SECTION = CLASS_TEACHER - 3;
const ctChildren = currentRows([CT_SECTION]);
const ttChildren = currentRows(TIMETABLE_TEACHER_SECTIONS);

async function registerAdmissionNos(page: Page): Promise<string[]> {
  const items = await page.getByRole("listitem").filter({ hasText: /E2E-\d{4}/ }).allTextContents();
  return items.map((t) => /E2E-\d{4}/.exec(t)?.[0] ?? "").filter(Boolean);
}

test.describe("class teacher (Nursery-A)", () => {
  test("/attendance: her register is exactly Nursery-A's 2026-27 children", async ({ browser }, testInfo) => {
    test.fail(
      true,
      "the 2026-27 register also lists every Nursery-A row whose academic year is BLANK — other children who once " +
        "sat there, and some of her own children a second time: an unknown year taken as this year (S2). Until step 3.1.",
    );
    const { context, page } = await openAs(browser, "teacher");
    try {
      await page.goto("/attendance");
      const want = ctChildren.map((s) => s.admissionNo).sort();
      let shown: string[] = [];
      try {
        await test.step(`register shows ${want.length} children, all from her section and year`, async () => {
          await expect(page.getByText(/^Strength\s+\d+$/).first()).toBeVisible({ timeout: 20_000 });
          await expect.poll(async () => (shown = (await registerAdmissionNos(page)).sort()), { timeout: 10_000 }).toEqual(want);
        });
      } finally {
        const extra = shown.filter((a) => !want.includes(a));
        const extraRows = fx.sis.students
          .filter((s) => s.sectionId === sectionId(CT_SECTION) && extra.includes(s.admissionNo))
          .map((s) => `${s.admissionNo}:${s.academicYearCode || "blank"}`);
        await metric(testInfo, "register", {
          expected: want.length,
          shown: shown.length,
          missing: want.filter((a) => !shown.includes(a)),
          extraShown: extra,
          shownTwice: [...new Set(shown.filter((a, i) => shown.indexOf(a) !== i))],
          blankYearRowsInHerSection: fx.sis.students.filter((s) => s.sectionId === sectionId(CT_SECTION) && !s.academicYearCode).length,
          extraChildrensRowsInHerSection: extraRows,
        });
      }
    } finally {
      await context.close();
    }
  });

  test("/students: Active students = her section's 2026-27 children", async ({ browser }, testInfo) => {
    test.fail(true, "the page crashes with React #185 (Maximum update depth exceeded) whenever the roster holds students (S2). Until step 3.x.");
    const { context, page } = await openAs(browser, "teacher");
    const errors = collectPageErrors(page);
    try {
      await page.goto("/students");
      const card = page.getByRole("button", { name: /^Active students/ }).first();
      try {
        await expect
          .poll(async () => leadingNumber(await card.getByTestId("metric-value").textContent({ timeout: 1000 }).catch(() => null)), { timeout: 20_000 })
          .toBe(ctChildren.length);
      } finally {
        await metric(testInfo, "students", { expected: ctChildren.length, pageErrors: errors.slice(0, 2) });
        if (errors.length) note(testInfo, "page error", errors[0]!);
      }
    } finally {
      await context.close();
    }
  });
});

test.describe("timetable-only teacher (III-A, V-A by the published timetable)", () => {
  test("/attendance: she is offered her two sections", async ({ browser }) => {
    test.fail(
      true,
      "she gets 0 sections — 'No classes are assigned to you yet': on the server the published timetable is never " +
        "loaded (loadTimetable() is browser-only), so staffSectionScope() never sees her periods. Until step 1.7.",
    );
    const { context, page } = await openAs(browser, "timetableTeacher");
    try {
      await page.goto("/attendance");
      await expect(page.getByText(/^Mark register$/).first()).toBeVisible({ timeout: 20_000 });
      await test.step("her sections are offered", async () => {
        await expect(page.getByText(/No classes are assigned to you yet/)).toHaveCount(0, { timeout: 10_000 });
        const cls = page.getByRole("combobox", { name: "Class", exact: true }).first();
        await expect(cls.locator("option", { hasText: /^III$/ })).toHaveCount(1);
        await expect(cls.locator("option", { hasText: /^V$/ })).toHaveCount(1);
      });
    } finally {
      await context.close();
    }
  });

  test("/students: Active students = her sections' 2026-27 children", async ({ browser }, testInfo) => {
    test.fail(true, "shows 0 active students: the server finds no section for her (timetable never loaded server-side). Until step 1.7.");
    const { context, page } = await openAs(browser, "timetableTeacher");
    let seen: number | null = null;
    try {
      await page.goto("/students");
      const card = page.getByRole("button", { name: /^Active students/ }).first();
      await test.step(`Active students = ${ttChildren.length}`, async () => {
        await expect
          .poll(async () => (seen = leadingNumber(await card.getByTestId("metric-value").textContent({ timeout: 1000 }).catch(() => null))), { timeout: 20_000 })
          .toBe(ttChildren.length);
      });
    } finally {
      await metric(testInfo, "students", { expected: ttChildren.length, seen });
      await context.close();
    }
  });
});

test.describe("teacher, Masters read failing", () => {
  for (const path of ["/attendance", "/students"]) {
    test(`${path}: masters-desk 503 → "could not load" + Try again, never an empty school`, async ({ browser }) => {
      const { context, page } = await openAs(browser, "teacher");
      try {
        await page.route("**/api/school-data/masters-desk**", (r) =>
          r.request().method() === "GET"
            ? r.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ ok: false, error: "Could not read the school setup — please try again." }),
              })
            : r.continue(),
        );
        await page.goto(path);
        await expect(page.getByText(/could not load/i).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
        await expect(page.getByRole("combobox", { name: "Class", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^Active students/ })).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
});
