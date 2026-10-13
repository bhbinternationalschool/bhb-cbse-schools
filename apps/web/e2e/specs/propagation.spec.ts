/**
 * propagation — a change made in one place reaches a screen that is already
 * open somewhere else, without a reload, within 30 s.
 *
 * Parameterised: observeAt(path) × editVia('editor' | 'api').
 *   Context B (an office tab) opens the observer screen and shows the
 *   current value FIRST (the control step — proves the selector and the
 *   screen work). Then context A — the Principal: the fixture's Office role
 *   may only VIEW Masters (built-in rbac), and a save as the office is
 *   refused "Missing permission masters.edit" — makes the change:
 *     editor  through the real screen (Masters → Subjects by class → "New
 *             subject for V"; Masters → Classes & sections → Sections → Edit),
 *     api     with the same POST the editor sends (/api/school-data/masters-desk
 *             `{version:2, <slice>:[…], sliceBases:{…}}`; staff-roster
 *             `{state, stamps}`), from A's signed-in browser context.
 *   The change is then read back from the database through the API (so a
 *   failure below is propagation, not a failed write), and B — never
 *   reloaded — must show it within 30 s. When it does not, the same locator
 *   is tried once more after reloading B (metric `visibleAfterReload`): true
 *   proves the failure is staleness, not a wrong selector.
 *
 * Changes:
 *   subject  a new subject "Computer <tag>" linked to Class V. (The fixture's
 *            Class V already studies "Computer", so the test adds a new
 *            subject of that name with a run tag: the same write — the
 *            subjects and classSubjects slices — and an unambiguous name.)
 *   section  V-A renamed (to a fresh tag each test).
 *   staff    a staff member's full name changed.
 *
 * Every test here is EXPECTED TO FAIL until steps 1.3/1.4/2.1 (one change
 * signal + useErpQuery invalidation): today a Masters copy lives per tab and
 * nothing re-reads it (evidence/propagation.md). The scoreboard records the
 * step each one failed at; the subject and section tests must fail at
 * "propagation", never at "control", "edit" or "database".
 *
 * This project runs after every read-only spec (playwright.config.ts) because
 * it writes to the stack.
 */
import type { APIRequestContext, Browser, Locator, Page } from "@playwright/test";
import type { ClassSubjectLink, StaffRecord, Subject } from "@/lib/foundationMasters";
import { normalizeSubject } from "@/lib/foundationMasters";
import type { Section } from "@/lib/masters";
import { classId, staffId } from "../fixture";
import { expect, metric, openAs, test } from "../support";

const PROPAGATION_MS = 30_000;
const CLASS_V = classId(8);
const STAFF_EDITED = staffId(20);
const UNTIL = "expected to fail until steps 1.3/1.4/2.1: a Masters/staff copy lives per tab and nothing re-reads it";

type EditVia = "editor" | "api";
type Observer = {
  path: string;
  /** Navigate to the view and prove it shows the current value. */
  open: (page: Page, current: string) => Promise<void>;
  /** The element that appears once the new value has reached this screen. */
  sees: (page: Page, next: string) => Locator;
};

let seq = 0;
function tag(): string {
  seq += 1;
  return `${Date.now().toString(36).slice(-3)}${seq}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ── API helpers (A's signed-in context) ─────────────────────────────────

type MastersDesk = { ok: boolean; subjects: Subject[]; classSubjects: ClassSubjectLink[]; sections: Section[]; sliceStamps?: Record<string, string> };

async function mastersDesk(req: APIRequestContext): Promise<MastersDesk> {
  const res = await req.get("/api/school-data/masters-desk");
  expect(res.status(), "GET masters-desk").toBe(200);
  return (await res.json()) as MastersDesk;
}

async function postMasters(req: APIRequestContext, body: Record<string, unknown>): Promise<void> {
  const res = await req.post("/api/school-data/masters-desk", { data: { version: 2, ...body } });
  const text = await res.text();
  expect(res.status(), `POST masters-desk: ${text.slice(0, 300)}`).toBe(200);
  expect((JSON.parse(text) as { ok?: boolean }).ok, `POST masters-desk: ${text.slice(0, 300)}`).toBe(true);
}

type StaffRoster = { ok: boolean; staff: StaffRecord[]; stamps?: Record<string, Record<string, string>> };

async function staffRoster(req: APIRequestContext): Promise<StaffRoster> {
  const res = await req.get("/api/school-data/staff-roster");
  expect(res.status(), "GET staff-roster").toBe(200);
  return (await res.json()) as StaffRoster;
}

async function currentSectionName(req: APIRequestContext): Promise<string> {
  const desk = await mastersDesk(req);
  const sec = desk.sections.find((s) => s.classId === CLASS_V);
  if (!sec) throw new Error("class V has no section");
  return sec.name;
}

// ── Observers ───────────────────────────────────────────────────────────

const pickV = async (page: Page) => {
  const cls = page.getByRole("combobox", { name: "Class", exact: true }).first();
  await expect(cls.locator("option", { hasText: /^V$/ })).toHaveCount(1, { timeout: 20_000 });
  await cls.selectOption({ label: "V" });
};

const SUBJECT_OBSERVERS: Observer[] = [
  {
    path: "/masters?tab=subjects",
    open: async (page) => {
      await page.getByRole("tab", { name: "3 · Subjects by class" }).click({ timeout: 20_000 });
      await pickV(page);
      await expect(page.getByRole("row", { name: /\bMATH Mathematics\b/ })).toBeVisible();
    },
    sees: (page, name) => page.getByRole("row", { name: new RegExp(`\\b${name}\\b`) }),
  },
  {
    path: "/timetable",
    open: async (page) => {
      await page.getByRole("tab", { name: "Subject rules", exact: true }).click({ timeout: 20_000 });
      await pickV(page);
      await expect(page.getByText("Mathematics", { exact: true }).first()).toBeVisible();
    },
    sees: (page, name) => page.getByText(name, { exact: true }),
  },
  {
    path: "/homework",
    open: async (page) => {
      await page.getByRole("tab", { name: "Compose HW", exact: true }).click({ timeout: 20_000 });
      await pickV(page);
      await expect(page.getByRole("combobox", { name: "Subject", exact: true }).locator("option", { hasText: /^Mathematics$/ })).toHaveCount(1);
    },
    sees: (page, name) => page.getByRole("combobox", { name: "Subject", exact: true }).locator("option", { hasText: new RegExp(`^${name}$`) }),
  },
];

const sectionOption = (page: Page, name: string) =>
  page.getByRole("combobox", { name: "Section", exact: true }).first().locator("option", { hasText: new RegExp(`^${name}$`) });

const SECTION_OBSERVERS: Observer[] = [
  {
    path: "/attendance",
    open: async (page, current) => {
      await page.getByRole("tab", { name: "Students", exact: true }).click({ timeout: 20_000 });
      await pickV(page);
      await expect(sectionOption(page, current)).toHaveCount(1);
    },
    sees: sectionOption,
  },
  {
    path: "/homework",
    open: async (page, current) => {
      await pickV(page);
      await expect(sectionOption(page, current)).toHaveCount(1);
    },
    sees: sectionOption,
  },
  {
    path: "/timetable",
    open: async (page, current) => {
      await pickV(page);
      await expect(sectionOption(page, current)).toHaveCount(1);
    },
    sees: sectionOption,
  },
];

const STAFF_OBSERVERS: Observer[] = [
  {
    path: "/staff?tab=roster",
    open: async (page, current) => {
      await expect(page.getByText(current, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    },
    sees: (page, next) => page.getByText(next, { exact: true }),
  },
  {
    path: "/timetable",
    open: async (page, current) => {
      await page.getByRole("tab", { name: "By teacher", exact: true }).click({ timeout: 20_000 });
      await expect(page.getByRole("combobox", { name: "Teacher", exact: true }).locator("option", { hasText: current })).toHaveCount(1, { timeout: 20_000 });
    },
    sees: (page, next) => page.getByRole("combobox", { name: "Teacher", exact: true }).locator("option", { hasText: next }),
  },
];

// ── Edits ───────────────────────────────────────────────────────────────

async function addSubject(a: Page, via: EditVia, code: string, name: string): Promise<void> {
  if (via === "editor") {
    await a.goto("/masters?tab=subjects");
    await a.getByRole("tab", { name: "3 · Subjects by class" }).click({ timeout: 20_000 });
    await pickV(a);
    await a.getByRole("button", { name: "New subject for V", exact: true }).click();
    const dialog = a.getByRole("alertdialog", { name: "Add subject" });
    await dialog.getByRole("textbox", { name: "Code", exact: true }).fill(code);
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Add subject", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    return;
  }
  const desk = await mastersDesk(a.request);
  const subject = normalizeSubject({ id: `e2e_sub_${code.toLowerCase()}`, code, nameEn: name, sortOrder: desk.subjects.length + 1 });
  // The row the editor builds (SubjectsPanel saveEditor). isOptional must be
  // sent: masters_desk_class_subjects.is_optional is NOT NULL, and a link
  // without it is ACCEPTED into the classSubjects slice and then fails the row
  // sync (500 "Masters saved, but the row tables did not update") — after
  // which every later Masters save fails the same way (seen 13 Oct 2026).
  const link: ClassSubjectLink = {
    id: `e2e_cs_${code.toLowerCase()}`,
    classId: CLASS_V,
    subjectId: subject.id,
    periodsPerWeek: 2,
    isActive: true,
    isOptional: false,
  };
  await postMasters(a.request, {
    subjects: [...desk.subjects, subject],
    classSubjects: [...desk.classSubjects, link],
    sliceBases: { subjects: desk.sliceStamps?.subjects ?? "", classSubjects: desk.sliceStamps?.classSubjects ?? "" },
  });
}

async function renameSection(a: Page, via: EditVia, current: string, next: string): Promise<void> {
  if (via === "editor") {
    await a.goto("/masters?tab=classes");
    await a.getByRole("button", { name: "V 1 section", exact: true }).click({ timeout: 20_000 });
    await a.getByRole("tab", { name: "2 · Sections" }).click();
    const row = a.getByRole("listitem").filter({ hasText: new RegExp(`^V-${current}`) });
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await a.getByRole("textbox", { name: "Rename section" }).fill(next);
    await a.getByRole("button", { name: "Update", exact: true }).click();
    return;
  }
  const desk = await mastersDesk(a.request);
  await postMasters(a.request, {
    sections: desk.sections.map((s) => (s.classId === CLASS_V && s.name === current ? { ...s, name: next } : s)),
    sliceBases: { sections: desk.sliceStamps?.sections ?? "" },
  });
}

async function renameStaffViaApi(a: Page, next: string): Promise<void> {
  const roster = await staffRoster(a.request);
  const row = roster.staff.find((s) => s.id === STAFF_EDITED);
  if (!row) throw new Error(`${STAFF_EDITED} not in staff-roster`);
  const res = await a.request.post("/api/school-data/staff-roster", {
    data: {
      state: { staff: [{ ...row, fullName: next }], departments: [], designations: [] },
      stamps: { staff: { [row.id]: roster.stamps?.staff?.[row.id] ?? "" }, departments: {}, designations: {} },
    },
  });
  const text = await res.text();
  expect(res.status(), `POST staff-roster: ${text.slice(0, 300)}`).toBe(200);
  expect((JSON.parse(text) as { ok?: boolean; conflicts?: unknown }).ok, `POST staff-roster: ${text.slice(0, 300)}`).toBe(true);
}

// ── The run ─────────────────────────────────────────────────────────────

async function scenario(
  browser: Browser,
  observer: Observer,
  current: (a: Page) => Promise<string>,
  edit: (a: Page, current: string) => Promise<string>,
  inDatabase: (a: Page, next: string) => Promise<boolean>,
  out: { propagatedAfterMs: number | null; visibleAfterReload?: boolean | string; controlShown?: boolean },
  /** false: a control failure is recorded (controlShown:false) and the edit still runs. */
  controlMustPass = true,
): Promise<void> {
  const A = await openAs(browser, "principal");
  const B = await openAs(browser, "office");
  try {
    const cur = await current(A.page);
    await test.step(`control: B on ${observer.path} shows the current value`, async () => {
      await B.page.goto(observer.path);
      try {
        await observer.open(B.page, cur);
        out.controlShown = true;
      } catch (err) {
        out.controlShown = false;
        if (controlMustPass) throw err;
      }
    });
    let next = "";
    await test.step("edit: A makes the change", async () => {
      next = await edit(A.page, cur);
    });
    await test.step("database: the change is stored", async () => {
      await expect.poll(() => inDatabase(A.page, next), { timeout: 15_000 }).toBe(true);
    });
    const t0 = Date.now();
    await test.step(`propagation: B (never reloaded) shows "${next}" within 30 s`, async () => {
      try {
        await expect(observer.sees(B.page, next).first()).toBeAttached({ timeout: PROPAGATION_MS });
        out.propagatedAfterMs = Date.now() - t0;
      } catch (err) {
        // Proof that this is staleness, not a wrong locator: the SAME locator
        // finds the new value once B reloads and opens the same view.
        out.visibleAfterReload = await (async () => {
          await B.page.goto(observer.path);
          await observer.open(B.page, next).catch(() => undefined);
          await expect(observer.sees(B.page, next).first()).toBeAttached({ timeout: 20_000 });
          return true;
        })().catch((x: unknown) => `not even after a reload: ${String(x).split("\n")[0]}`);
        throw err;
      }
    });
  } finally {
    await A.context.close();
    await B.context.close();
  }
}

for (const via of ["editor", "api"] as const) {
  for (const obs of SUBJECT_OBSERVERS) {
    test(`subject added to Class V via ${via} → visible on ${obs.path}`, async ({ browser }, testInfo) => {
      test.fail(true, UNTIL);
      const t = tag();
      const code = `CMP${t}`;
      const name = `Computer ${t}`;
      const r: { propagatedAfterMs: number | null; visibleAfterReload?: boolean | string; controlShown?: boolean } = { propagatedAfterMs: null };
      await scenario(
        browser,
        obs,
        async () => "Mathematics",
        async (a) => {
          await addSubject(a, via, code, name);
          return name;
        },
        async (a) => {
          const d = await mastersDesk(a.request);
          const s = d.subjects.find((x) => x.code === code);
          return !!s && d.classSubjects.some((l) => l.subjectId === s.id && l.classId === CLASS_V && l.isActive);
        },
        r,
      ).catch(async (e: unknown) => {
        await metric(testInfo, "propagation", { change: "subject", via, observer: obs.path, ...r });
        throw e;
      });
      await metric(testInfo, "propagation", { change: "subject", via, observer: obs.path, ...r });
    });
  }

  for (const obs of SECTION_OBSERVERS) {
    test(`section V-A renamed via ${via} → visible on ${obs.path}`, async ({ browser }, testInfo) => {
      test.fail(true, UNTIL);
      const next = `S${tag()}`;
      const r: { propagatedAfterMs: number | null; visibleAfterReload?: boolean | string; controlShown?: boolean } = { propagatedAfterMs: null };
      await scenario(
        browser,
        obs,
        (a) => currentSectionName(a.request),
        async (a, cur) => {
          await renameSection(a, via, cur, next);
          return next;
        },
        async (a) => (await currentSectionName(a.request)) === next,
        r,
      ).catch(async (e: unknown) => {
        await metric(testInfo, "propagation", { change: "section", via, observer: obs.path, ...r });
        throw e;
      });
      await metric(testInfo, "propagation", { change: "section", via, observer: obs.path, ...r });
    });
  }
}

for (const obs of STAFF_OBSERVERS) {
  test(`staff record renamed via api → visible on ${obs.path}`, async ({ browser }, testInfo) => {
    test.fail(
      true,
      `${UNTIL}. Today the observer lists no staff at all, even before the edit (the /staff count defect, S1): ` +
        "the control is recorded (metric controlShown:false) and the edit still runs, so the write path is proven, " +
        "but propagation cannot be told apart from the empty list until that is fixed.",
    );
    const next = `Rohit Renamed ${tag()}`;
    const r: { propagatedAfterMs: number | null; visibleAfterReload?: boolean | string; controlShown?: boolean } = { propagatedAfterMs: null };
    await scenario(
      browser,
      obs,
      async (a) => (await staffRoster(a.request)).staff.find((s) => s.id === STAFF_EDITED)?.fullName ?? "?",
      async (a) => {
        await renameStaffViaApi(a, next);
        return next;
      },
      async (a) => (await staffRoster(a.request)).staff.find((s) => s.id === STAFF_EDITED)?.fullName === next,
      r,
      false,
    ).catch(async (e: unknown) => {
      await metric(testInfo, "propagation", { change: "staff", via: "api", observer: obs.path, ...r });
      throw e;
    });
    await metric(testInfo, "propagation", { change: "staff", via: "api", observer: obs.path, ...r });
  });
}

test.fixme(
  "staff record renamed via editor → visible elsewhere (the Staff roster lists no staff today, so its editor cannot be driven; build with the /staff fix)",
  async () => {},
);
