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
 * Every test on a real screen is EXPECTED TO FAIL until step 2.1 converts it
 * to useMasters(): today a Masters copy lives per tab and nothing re-reads it
 * (evidence/propagation.md). Converted (must pass): /attendance, /timetable,
 * /homework (2.1a), /masters?tab=subjects (2.1h). Still expected to fail: the staff
 * cases (the roster on both observers is still the tab's page copy: /staff
 * until 2.2, the access copy behind useScreenMasters until 2.3a). The scoreboard records the step each one failed
 * at; the subject and section tests must fail at "propagation", never at
 * "control", "edit" or "database".
 *
 * /__kernel (step 1.4) is the exception and must PASS: a test page that lists
 * the classes through useMasters() alone (GET /api/data/views/masters), kept
 * fresh by the versions poll (GET /api/data/views/versions every 20 s; a moved
 * `masters` value refetches the view). It is the proof that the kernel moves
 * a change to an open tab before any real screen is converted to it.
 *
 * This project runs after every read-only spec (playwright.config.ts) because
 * it writes to the stack.
 */
import type { APIRequestContext, Browser, Locator, Page } from "@playwright/test";
import type { ClassSubjectLink, StaffRecord, Subject } from "@/lib/foundationMasters";
import { normalizeSubject } from "@/lib/foundationMasters";
import { classGroupCodeForName, type Section } from "@/lib/masters";
import { classId, staffId } from "../fixture";
import { dropElement, listOf, mastersView, putElement, putObject } from "../mastersKernel";
import { expect, metric, openAs, test } from "../support";

const PROPAGATION_MS = 30_000;
const CLASS_V = classId(8);
const STAFF_EDITED = staffId(20);
const UNTIL = "expected to fail until step 2.1 converts this screen to useMasters(): a Masters/staff copy lives per tab and nothing re-reads it";

type EditVia = "editor" | "api";
type Observer = {
  path: string;
  /** Set when this observer reads Masters through the query kernel (useMasters): the test must pass (no test.fail). */
  kernel?: true;
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

/** /__kernel (1.4): every class's sections and subjects, from useMasters() only. */
const kernelItem = (page: Page, list: "Sections" | "Subjects", name: string) =>
  page.getByRole("list", { name: `${list} of V`, exact: true }).getByRole("listitem").filter({ hasText: new RegExp(`^${name}$`) });

const SUBJECT_OBSERVERS: Observer[] = [
  {
    path: "/__kernel",
    kernel: true,
    open: async (page) => {
      await expect(kernelItem(page, "Subjects", "Mathematics")).toHaveCount(1, { timeout: 20_000 });
    },
    sees: (page, name) => kernelItem(page, "Subjects", name),
  },
  {
    path: "/masters?tab=subjects",
    kernel: true, // 2.1h
    open: async (page) => {
      await page.getByRole("tab", { name: "3 · Subjects by class" }).click({ timeout: 20_000 });
      await pickV(page);
      await expect(page.getByRole("row", { name: /\bMATH Mathematics\b/ })).toBeVisible();
    },
    sees: (page, name) => page.getByRole("row", { name: new RegExp(`\\b${name}\\b`) }),
  },
  {
    path: "/timetable",
    kernel: true, // 2.1a
    open: async (page) => {
      await page.getByRole("tab", { name: "Subject rules", exact: true }).click({ timeout: 20_000 });
      await pickV(page);
      await expect(page.getByText("Mathematics", { exact: true }).first()).toBeVisible();
    },
    sees: (page, name) => page.getByText(name, { exact: true }),
  },
  {
    path: "/homework",
    kernel: true, // 2.1a
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
    path: "/__kernel",
    kernel: true,
    open: async (page, current) => {
      await expect(kernelItem(page, "Sections", current)).toHaveCount(1, { timeout: 20_000 });
    },
    sees: (page, name) => kernelItem(page, "Sections", name),
  },
  {
    path: "/attendance",
    kernel: true, // 2.1a
    open: async (page, current) => {
      await page.getByRole("tab", { name: "Students", exact: true }).click({ timeout: 20_000 });
      await pickV(page);
      await expect(sectionOption(page, current)).toHaveCount(1);
    },
    sees: sectionOption,
  },
  {
    path: "/homework",
    kernel: true, // 2.1a
    open: async (page, current) => {
      await pickV(page);
      await expect(sectionOption(page, current)).toHaveCount(1);
    },
    sees: sectionOption,
  },
  {
    path: "/timetable",
    kernel: true, // 2.1a
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
    classSubjects: [...desk.classSubjects.map((l) => ({ ...l, isOptional: l.isOptional ?? false })), link],
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
  // Through the kernel (data-layer 2.2d: the staff-roster POST is 410).
  const list = (await (await a.request.get("/api/data/sis.staff?limit=500")).json()) as { rows: { id: string; updated_at: string }[] };
  const row = list.rows.find((r) => r.id === STAFF_EDITED);
  if (!row) throw new Error(`${STAFF_EDITED} not in sis.staff`);
  const res = await a.request.post("/api/data/sis.staff", {
    data: { ops: [{ op: "upsert", id: row.id, base: row.updated_at, row: { full_name: next, profile: { fullName: next } } }] },
  });
  const text = await res.text();
  expect(res.status(), `POST sis.staff: ${text.slice(0, 300)}`).toBe(200);
}

/** The real editor: /staff/<id>/edit, the name typed, Save — one sis.staff request, never a whole-book save. */
async function renameStaffViaEditor(a: Page, next: string): Promise<void> {
  const writes: string[] = [];
  a.on("request", (q) => {
    if (q.method() === "POST" && /\/api\/(data\/|school-data\/(masters-desk|staff-roster))/.test(q.url())) writes.push(q.url());
  });
  await a.goto(`/staff/${STAFF_EDITED}/edit`);
  const name = a.locator("label", { hasText: "Full name" }).first().locator("input");
  await expect(name).not.toHaveValue("", { timeout: 30_000 });
  await name.fill(next);
  const posted = a.waitForResponse((r) => r.url().endsWith("/api/data/sis.staff") && r.request().method() === "POST", { timeout: 15_000 });
  await a.getByRole("button", { name: "Save profile" }).first().click();
  expect((await posted).status(), "POST sis.staff").toBe(200);
  await expect(a.getByTestId("staff-save-notice")).toHaveText("Staff updated", { timeout: 15_000 });
  expect(writes.filter((u) => /masters-desk|staff-roster/.test(u)), "no whole-book / roster save").toEqual([]);
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
        })().catch(
          // Strip the terminal colours from the message.
          (x: unknown) => `not even after a reload: ${String(x).replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0]}`,
        );
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
      test.fail(!obs.kernel, UNTIL);
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
      test.fail(!obs.kernel, UNTIL);
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
    // /staff re-reads its roster when the staff list moves (data-layer 2.2d).
    // /timetable's Teacher picker reads the access copy until 2.3a.
    test.fail(
      obs.path === "/timetable",
      `${UNTIL}. /timetable's Teacher picker reads useScreenMasters, whose staff side is the access copy until 2.3a puts it on useStaffList().`,
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

// Data-layer 2.2d: the staff editor saves rows, and the Staff roster follows
// the staff list — A renames on the real profile form, B on /staff sees it.
test("staff record renamed via editor → visible on /staff?tab=roster", async ({ browser }, testInfo) => {
  const next = `Rohit Edited ${tag()}`;
  const r: { propagatedAfterMs: number | null; visibleAfterReload?: boolean | string; controlShown?: boolean } = { propagatedAfterMs: null };
  await scenario(
    browser,
    STAFF_OBSERVERS[0]!,
    async (a) => (await staffRoster(a.request)).staff.find((s) => s.id === STAFF_EDITED)?.fullName ?? "?",
    async (a) => {
      await renameStaffViaEditor(a, next);
      return next;
    },
    async (a) => (await staffRoster(a.request)).staff.find((s) => s.id === STAFF_EDITED)?.fullName === next,
    r,
  ).catch(async (e: unknown) => {
    await metric(testInfo, "propagation", { change: "staff", via: "editor", observer: "/staff?tab=roster", ...r });
    throw e;
  });
  await metric(testInfo, "propagation", { change: "staff", via: "editor", observer: "/staff?tab=roster", ...r });
});

// ── Data-layer 2.2c: every converted Masters panel, through the REAL editor ──
//
// Since 2.2c each of these panels writes ELEMENTS (POST /api/data/masters.*),
// not the masters-desk book. For each: A (principal) makes the change on the
// panel; the request it sent is checked (one collection, no whole list); the
// change is read back from the database; B (office, Masters view only) has
// the same panel open and must show it within 30 s without a reload. Then
// the school is put back through the kernel.

type PanelCase = {
  name: string;
  path: string;
  /** B's panel: prove it shows the current state (control). */
  open: (page: Page) => Promise<void>;
  /** A's edit through the screen; returns the new value's tag. */
  edit: (a: Page, t: string) => Promise<void>;
  /** The collection the editor must write. */
  collection: string;
  inDatabase: (a: Page, t: string) => Promise<boolean>;
  /** B shows the change (an expectation with its own 30 s timeout). */
  sees: (b: Page, t: string) => Promise<void>;
  putBack: (a: Page, t: string) => Promise<void>;
};

const FEE_RECEIPT = "Expense voucher";

const PANEL_CASES: PanelCase[] = [
  {
    name: "campus added",
    path: "/masters?tab=campuses",
    open: async (p) => {
      await expect(p.getByRole("row").filter({ hasText: "Main Campus" })).toHaveCount(1, { timeout: 20_000 });
    },
    edit: async (a, t) => {
      await a.goto("/masters?tab=campuses");
      await a.getByRole("textbox", { name: "Code", exact: true }).fill(`C${t}`, { timeout: 20_000 });
      await a.getByRole("textbox", { name: "Name", exact: true }).fill(`Campus ${t}`);
      await a.getByRole("button", { name: "Save campus", exact: true }).click();
    },
    collection: "masters.campuses",
    inDatabase: async (a, t) => listOf(await mastersView(a.request), "campuses").some((c) => c.name === `Campus ${t}`),
    sees: async (b, t) => {
      await expect(b.getByRole("row").filter({ hasText: `Campus ${t}` })).toHaveCount(1, { timeout: PROPAGATION_MS });
    },
    putBack: async (a, t) => {
      const c = listOf(await mastersView(a.request), "campuses").find((x) => x.name === `Campus ${t}`);
      if (c) await dropElement(a.request, "masters.campuses", "campuses", String(c.id));
    },
  },
  {
    name: "term added",
    path: "/masters?tab=academic",
    open: async (p) => {
      await expect(p.getByRole("row").filter({ hasText: "2026-27" }).first()).toBeVisible({ timeout: 20_000 });
    },
    edit: async (a, t) => {
      await a.goto("/masters?tab=academic");
      await a.getByRole("textbox", { name: "Code T1" }).fill(`T${t}`, { timeout: 20_000 });
      const dates = a.locator('input[type="date"]');
      await dates.nth(2).fill("2026-11-01");
      await dates.nth(3).fill("2026-11-30");
      await a.getByRole("button", { name: "Add term", exact: true }).click();
    },
    collection: "masters.academic-terms",
    inDatabase: async (a, t) => listOf(await mastersView(a.request), "academicTerms").some((x) => x.code === `T${t}`),
    sees: async (b, t) => {
      await expect(b.getByRole("cell", { name: new RegExp(`^T${t}\\b`) })).toHaveCount(1, { timeout: PROPAGATION_MS });
    },
    putBack: async (a, t) => {
      const x = listOf(await mastersView(a.request), "academicTerms").find((y) => y.code === `T${t}`);
      if (x) await dropElement(a.request, "masters.academic-terms", "academicTerms", String(x.id));
    },
  },
  {
    name: "number series prefix changed",
    path: "/masters?tab=series",
    open: async (p) => {
      await expect(p.getByRole("listitem").filter({ hasText: FEE_RECEIPT })).toHaveCount(1, { timeout: 20_000 });
    },
    edit: async (a, t) => {
      await a.goto("/masters?tab=series");
      await a.getByRole("listitem").filter({ hasText: FEE_RECEIPT }).getByRole("button", { name: "Edit" }).click({ timeout: 20_000 });
      await a.getByRole("textbox", { name: "Prefix" }).fill(`X${t}-`);
      await a.getByRole("button", { name: "Save", exact: true }).click();
    },
    collection: "masters.number-series",
    inDatabase: async (a, t) => listOf(await mastersView(a.request), "numberSeries").some((x) => x.prefix === `X${t}-`),
    sees: async (b, t) => {
      await expect(b.getByText(`Next: X${t}-`)).toHaveCount(1, { timeout: PROPAGATION_MS });
    },
    putBack: async (a, t) => {
      const x = listOf(await mastersView(a.request), "numberSeries").find((y) => y.prefix === `X${t}-`);
      if (x) await putElement(a.request, "masters.number-series", "numberSeries", { ...x, prefix: "EXP-" });
    },
  },
  {
    // Holi (March 2027): no spec counts working days that far ahead. Put back
    // UNPUBLISHED, not removed: on a fresh stack it is the only holiday, and
    // no save may leave a Masters list empty (2.2b's rule).
    name: "government holiday approved",
    path: "/masters?tab=holidays",
    open: async (p) => {
      await expect(p.getByRole("listitem").filter({ hasText: /^Holi2027/ }).getByRole("button", { name: "Approve" })).toHaveCount(1, { timeout: 20_000 });
    },
    edit: async (a) => {
      await a.goto("/masters?tab=holidays");
      await a.getByRole("listitem").filter({ hasText: /^Holi2027/ }).getByRole("button", { name: "Approve" }).click({ timeout: 20_000 });
    },
    collection: "masters.holidays",
    inDatabase: async (a) => listOf(await mastersView(a.request), "holidays").some((x) => x.title === "Holi" && x.isPublished === true),
    sees: async (b) => {
      await expect(b.getByRole("listitem").filter({ hasText: /^Holi2027/ }).getByRole("button", { name: "Approve" })).toHaveCount(0, { timeout: PROPAGATION_MS });
    },
    putBack: async (a) => {
      for (const x of listOf(await mastersView(a.request), "holidays").filter((y) => y.title === "Holi")) {
        await putElement(a.request, "masters.holidays", "holidays", { ...x, isPublished: false, publishedAt: null, publishedBy: "" });
      }
    },
  },
  {
    name: "school profile website changed",
    path: "/masters?tab=school",
    open: async (p) => {
      await expect(p.getByRole("definition").filter({ hasText: "https://bhbinternational.school" })).toHaveCount(1, { timeout: 20_000 });
    },
    edit: async (a, t) => {
      await a.goto("/masters?tab=school");
      await a.getByRole("textbox", { name: "Website", exact: true }).fill(`https://e2e-${t.toLowerCase()}.example`, { timeout: 20_000 });
      await a.getByRole("button", { name: "Save profile", exact: true }).click();
    },
    collection: "masters.school-profile",
    inDatabase: async (a, t) =>
      ((await mastersView(a.request)).schoolProfile as Record<string, unknown> | undefined)?.website === `https://e2e-${t.toLowerCase()}.example`,
    sees: async (b, t) => {
      await expect(b.getByRole("definition").filter({ hasText: `https://e2e-${t.toLowerCase()}.example` })).toHaveCount(1, { timeout: PROPAGATION_MS });
    },
    putBack: async (a) => {
      const p = (await mastersView(a.request)).schoolProfile as Record<string, unknown>;
      await putObject(a.request, "masters.school-profile", "schoolProfile", { ...p, website: "https://bhbinternational.school" });
    },
  },
  {
    name: "class renamed",
    path: "/masters?tab=classes",
    open: async (p) => {
      await expect(p.getByRole("button", { name: "XI 0 sections", exact: true })).toHaveCount(1, { timeout: 20_000 });
    },
    edit: async (a, t) => {
      await a.goto("/masters?tab=classes");
      await a.getByRole("listitem").filter({ has: a.getByRole("button", { name: "XI 0 sections", exact: true }) }).getByRole("button", { name: "Edit", exact: true }).click({ timeout: 20_000 });
      await a.getByRole("textbox", { name: "Rename class" }).fill(`XI ${t}`);
      await a.getByRole("button", { name: "Update", exact: true }).click();
    },
    collection: "masters.classes",
    inDatabase: async (a, t) => listOf(await mastersView(a.request), "classes").some((x) => x.name === `XI ${t}`),
    sees: async (b, t) => {
      await expect(b.getByRole("button", { name: `XI ${t} 0 sections`, exact: true })).toHaveCount(1, { timeout: PROPAGATION_MS });
    },
    putBack: async (a, t) => {
      const x = listOf(await mastersView(a.request), "classes").find((y) => y.name === `XI ${t}`);
      if (x) await putElement(a.request, "masters.classes", "classes", { ...x, name: "XI", groupCode: classGroupCodeForName("XI") });
    },
  },
  {
    name: "periods per week changed (Timetable → Subject rules)",
    path: "/timetable",
    open: async (p) => {
      await p.getByRole("tab", { name: "Subject rules", exact: true }).click({ timeout: 20_000 });
      await p.getByRole("combobox", { name: "Class", exact: true }).first().selectOption({ label: "IV" });
      await expect(p.getByRole("row").filter({ hasText: /^English/ }).getByRole("spinbutton").first()).toHaveValue("5", { timeout: 20_000 });
    },
    edit: async (a) => {
      await a.goto("/timetable");
      await a.getByRole("tab", { name: "Subject rules", exact: true }).click({ timeout: 20_000 });
      await a.getByRole("combobox", { name: "Class", exact: true }).first().selectOption({ label: "IV" });
      await a.getByRole("row").filter({ hasText: /^English/ }).getByRole("spinbutton").first().fill("7");
      await a.getByRole("button", { name: "Save rules", exact: true }).click();
    },
    collection: "masters.class-subjects",
    inDatabase: async (a) =>
      listOf(await mastersView(a.request), "classSubjects").some((l) => l.classId === classId(7) && l.subjectId === "e2e_sub_eng" && l.periodsPerWeek === 7),
    sees: async (b) => {
      await expect(b.getByRole("row").filter({ hasText: /^English/ }).getByRole("spinbutton").first()).toHaveValue("7", { timeout: PROPAGATION_MS });
    },
    putBack: async (a) => {
      const l = listOf(await mastersView(a.request), "classSubjects").find((x) => x.classId === classId(7) && x.subjectId === "e2e_sub_eng");
      if (l) await putElement(a.request, "masters.class-subjects", "classSubjects", { ...l, periodsPerWeek: 5 });
    },
  },
];

for (const c of PANEL_CASES) {
  test(`2.2c ${c.name} via the editor → element write, visible on B's ${c.path}`, async ({ browser }, testInfo) => {
    const t = tag();
    const A = await openAs(browser, "principal");
    const B = await openAs(browser, "office");
    const r: Record<string, unknown> = { change: c.name, via: "editor", observer: c.path, propagatedAfterMs: null };
    const posts: { url: string; body: unknown }[] = [];
    A.page.on("request", (q) => {
      if (q.method() === "POST" && /\/api\/(data\/masters|school-data\/masters-desk)/.test(q.url())) posts.push({ url: q.url(), body: q.postDataJSON() });
    });
    try {
      await test.step(`control: B on ${c.path} shows the current state`, async () => {
        await B.page.goto(c.path);
        await c.open(B.page);
      });
      await test.step("edit: A makes the change on the real screen", async () => {
        await c.edit(A.page, t);
      });
      await test.step("database: stored", async () => {
        await expect.poll(() => c.inDatabase(A.page, t), { timeout: 15_000 }).toBe(true);
      });
      await test.step("request: element ops to the panel's collection, never the masters-desk book", async () => {
        expect(posts.filter((p) => p.url.includes("/api/school-data/masters-desk")), "no whole-book save").toEqual([]);
        const mine = posts.filter((p) => p.url.endsWith(`/api/data/${c.collection}`));
        expect(mine.length, `a POST to ${c.collection} (sent: ${posts.map((p) => p.url).join(", ")})`).toBeGreaterThan(0);
        for (const p of mine) {
          const ops = (p.body as { ops?: { op: string }[] }).ops ?? [];
          expect(ops.length, "a few elements, not a list").toBeLessThanOrEqual(3);
          expect(ops.filter((o) => o.op === "delete").length).toBeLessThanOrEqual(1);
        }
        r.requests = posts.map((p) => p.url.replace(/^.*\/api\//, ""));
      });
      const t0 = Date.now();
      await test.step("propagation: B (never reloaded) shows it within 30 s", async () => {
        await c.sees(B.page, t);
        r.propagatedAfterMs = Date.now() - t0;
      });
    } finally {
      await c.putBack(A.page, t).catch((e: unknown) => {
        r.putBackFailed = String(e).slice(0, 200);
      });
      await metric(testInfo, "propagation", r);
      await A.context.close();
      await B.context.close();
    }
  });
}
