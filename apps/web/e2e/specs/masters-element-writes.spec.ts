/**
 * masters-element-writes — data-layer 2.2c: the Masters editor writes ONE
 * ELEMENT per action (POST /api/data/masters.<list>, on the element's `_rev`),
 * never the masters-desk book. Writes to the stack, so it runs in the
 * "propagation" project (after every reader), and puts everything back.
 *
 *  1. Overlap: two people edit DIFFERENT elements of one list (the sections of
 *     IV and of V) from screens loaded at the same moment — both land, no
 *     "Not saved". (Before 2.2c the second save carried the sections slice's
 *     old stamp and was refused: "changed on another device".)
 *  2. Same element: B's screen is held on the answer from before A's save;
 *     both rename IV-A — B is refused as stale ("Not saved — …"), A's name
 *     stays on the server.
 *  3. Subject wipe: an old whole-book body that drops two subjects is refused
 *     by masters-desk (409 foundation_shrink) and nothing is removed; two
 *     removals in one kernel request are refused (400); deleting a subject on
 *     the real screen sends exactly one delete op and no list.
 *  4. The teacher (Nursery-A's class teacher, the Class subjects function):
 *     marks a subject optional in HER class on the real screen — one element
 *     write to masters.class-subjects, stored; the same in LKG is refused and
 *     nothing changes.
 *  5. Class teacher (Masters → Classes → Sections → Teachers): setting IV-A's
 *     class teacher writes the two members' link lists through sis.staff
 *     (laid on each record as stored) — never the roster — and moves the link.
 */
import type { APIRequestContext, Browser, Page, Request, Route } from "@playwright/test";
import { normalizeSubject } from "@/lib/foundationMasters";
import { classId, sectionId } from "../fixture";
import { classGroupCodeForName } from "@/lib/masters";
import { elementOf, listOf, mastersView, putElement, putObject, writeElements } from "../mastersKernel";
import { APP_URL, collectPageErrors, expect, signIn, test, type Who } from "../support";

const CLASS_IV = classId(7);
const CLASS_V = classId(8);
const AY = "2026-27";

test.describe.configure({ mode: "serial" });

async function pageAs(browser: Browser, who: Who): Promise<Page> {
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 } });
  await signIn(context, who);
  return context.newPage();
}

/** Every Masters write a page sends (kernel or the old book), with its body. */
function recordWrites(page: Page): { url: string; body: unknown }[] {
  const out: { url: string; body: unknown }[] = [];
  page.on("request", (q: Request) => {
    if (q.method() !== "POST") return;
    if (/\/api\/(data\/(masters|sis\.staff)|school-data\/(masters-desk|staff-roster))/.test(q.url())) {
      out.push({ url: q.url().replace(/^.*\/api\//, ""), body: q.postDataJSON() });
    }
  });
  return out;
}

const sectionOf = async (req: APIRequestContext, cls: string) => listOf(await mastersView(req), "sections").find((s) => s.classId === cls)!;

async function renameSectionOnScreen(page: Page, className: string, from: string, to: string, opts: { goto?: boolean } = {}): Promise<void> {
  if (opts.goto !== false) await page.goto("/masters?tab=classes");
  await page.getByRole("button", { name: `${className} 1 section`, exact: true }).click({ timeout: 30_000 });
  await page.getByRole("tab", { name: "2 · Sections" }).click();
  const row = page.getByRole("listitem").filter({ hasText: new RegExp(`^${className}-${from}`) });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename section" }).fill(to);
  await page.getByRole("button", { name: "Update", exact: true }).click();
}

async function putSectionName(req: APIRequestContext, cls: string, name: string): Promise<void> {
  const s = await sectionOf(req, cls);
  if (s.name !== name) await putElement(req, "masters.sections", "sections", { ...s, name });
}

test("overlap: two people edit different sections at once — both land, no conflict", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  const b = await pageAs(browser, "principal");
  const errors = [...collectPageErrors(a), ...collectPageErrors(b)];
  const ivBefore = String((await sectionOf(a.request, CLASS_IV)).name);
  const vBefore = String((await sectionOf(a.request, CLASS_V)).name);
  const writesB = recordWrites(b);
  try {
    // Both screens open on the same answer.
    await a.goto("/masters?tab=classes");
    await b.goto("/masters?tab=classes");
    await expect(b.getByRole("button", { name: "V 1 section", exact: true })).toBeVisible({ timeout: 30_000 });
    // A renames IV's section; B, without reloading, renames V's.
    await renameSectionOnScreen(a, "IV", ivBefore, "OA", { goto: false });
    await expect.poll(async () => (await sectionOf(a.request, CLASS_IV)).name, { timeout: 15_000 }).toBe("OA");
    await renameSectionOnScreen(b, "V", vBefore, "OB", { goto: false });
    await expect.poll(async () => (await sectionOf(a.request, CLASS_V)).name, { timeout: 15_000, message: "B's edit landed" }).toBe("OB");
    expect((await sectionOf(a.request, CLASS_IV)).name, "A's edit survives B's save").toBe("OA");
    await b.waitForTimeout(2_000);
    await expect(b.getByText(/^Not saved/)).toHaveCount(0);
    await b.screenshot({ path: test.info().outputPath("overlap-b.png") });
    const sent = writesB.filter((w) => w.url.startsWith("data/masters.sections"));
    expect(writesB.filter((w) => w.url.includes("masters-desk")), "no whole-book save").toEqual([]);
    expect(sent.length, "B wrote the section element").toBe(1);
    expect((sent[0].body as { ops: { id: string }[] }).ops.map((o) => o.id), "only V's section").toEqual([sectionId(8)]);
  } finally {
    await putSectionName(a.request, CLASS_IV, ivBefore);
    await putSectionName(a.request, CLASS_V, vBefore);
    await a.context().close();
    await b.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

test("same element: a screen held on the old answer is refused as stale; the first save stays", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  const b = await pageAs(browser, "principal");
  const ivBefore = String((await sectionOf(a.request, CLASS_IV)).name);
  try {
    // B keeps getting the answer it first had (as a stale cache would serve it).
    let first: string | null = null;
    await b.route("**/api/data/views/masters", async (route: Route) => {
      if (first) return route.fulfill({ status: 200, contentType: "application/json", body: first });
      const res = await route.fetch();
      first = await res.text();
      return route.fulfill({ response: res, body: first });
    });
    await b.goto("/masters?tab=classes");
    await expect(b.getByRole("button", { name: "IV 1 section", exact: true })).toBeVisible({ timeout: 30_000 });
    await renameSectionOnScreen(a, "IV", ivBefore, "SX");
    await expect.poll(async () => (await sectionOf(a.request, CLASS_IV)).name, { timeout: 15_000 }).toBe("SX");
    await renameSectionOnScreen(b, "IV", ivBefore, "SY", { goto: false });
    await expect(b.getByText(/^Not saved — /)).toBeVisible({ timeout: 15_000 });
    await b.screenshot({ path: test.info().outputPath("same-element-b.png") });
    expect((await sectionOf(a.request, CLASS_IV)).name, "A's save stays").toBe("SX");
  } finally {
    await putSectionName(a.request, CLASS_IV, ivBefore);
    await a.context().close();
    await b.context().close();
  }
});

test("subject wipe: an old body dropping two subjects is refused; the kernel takes one removal per save; the screen sends one", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  const errors = collectPageErrors(a);
  const writes = recordWrites(a);
  const extra = [
    normalizeSubject({ id: "e2e_22c_wipe_a", code: "WIPEA", nameEn: "Wipe A", sortOrder: 900 }),
    normalizeSubject({ id: "e2e_22c_wipe_b", code: "WIPEB", nameEn: "Wipe B", sortOrder: 901 }),
  ] as unknown as Record<string, unknown>[];
  try {
    for (const s of extra) {
      const w = await writeElements(a.request, "masters.subjects", [{ op: "upsert", id: String(s.id), base: null, row: s }]);
      expect(w.status, `seed ${s.id}: ${JSON.stringify(w.body).slice(0, 200)}`).toBe(200);
    }
    const before = listOf(await mastersView(a.request), "subjects").length;

    // (a) the old whole-book path, as a stale or seeded copy would send it
    const desk = (await (await a.request.get("/api/school-data/masters-desk")).json()) as {
      subjects: { id: string }[];
      sliceStamps?: Record<string, string>;
    };
    const old = await a.request.post("/api/school-data/masters-desk", {
      data: {
        version: 2,
        subjects: desk.subjects.filter((s) => !s.id.startsWith("e2e_22c_wipe_")),
        sliceBases: { subjects: desk.sliceStamps?.subjects ?? "" },
      },
    });
    const oldBody = (await old.json().catch(() => ({}))) as { reason?: string };
    expect(old.status(), `old body: ${JSON.stringify(oldBody).slice(0, 200)}`).toBe(409);
    expect(oldBody.reason).toBe("foundation_shrink");
    expect(listOf(await mastersView(a.request), "subjects").length, "nothing removed").toBe(before);

    // (b) two removals in one kernel request
    const book = await mastersView(a.request);
    const two = await writeElements(
      a.request,
      "masters.subjects",
      extra.map((s) => ({ op: "delete" as const, id: String(s.id), base: String(elementOf(book, "subjects", String(s.id))?._rev ?? 1) })),
    );
    expect(two.status, "two removals in one save").toBe(400);
    expect(listOf(await mastersView(a.request), "subjects").length, "nothing removed").toBe(before);

    // (c) the real screen: delete WIPEA
    await a.goto("/masters?tab=subjects");
    await a.getByRole("tab", { name: "2 · School subjects & components" }).click({ timeout: 30_000 });
    await a.getByRole("textbox", { name: "Search subjects" }).fill("WIPEA");
    const row = a.getByRole("row").filter({ hasText: "WIPEA" });
    await row.getByRole("button", { name: "Subject actions" }).click();
    await a.getByRole("menuitem", { name: "Delete" }).click();
    await a.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(async () => !!elementOf(await mastersView(a.request), "subjects", "e2e_22c_wipe_a"), { timeout: 15_000 }).toBe(false);
    await a.screenshot({ path: test.info().outputPath("subject-deleted.png") });
    expect(writes.filter((w) => w.url.includes("masters-desk")), "no whole-book save").toEqual([]);
    const del = writes.filter((w) => w.url === "data/masters.subjects");
    expect(del.length).toBe(1);
    expect((del[0].body as { ops: unknown[] }).ops, "exactly one delete op, no list").toEqual([
      { op: "delete", id: "e2e_22c_wipe_a", base: expect.any(String) },
    ]);
    expect(listOf(await mastersView(a.request), "subjects").length, "exactly one removed").toBe(before - 1);
  } finally {
    const book = await mastersView(a.request);
    for (const s of extra) {
      const el = elementOf(book, "subjects", String(s.id));
      if (el) await writeElements(a.request, "masters.subjects", [{ op: "delete", id: String(s.id), base: String(el._rev ?? 1) }]);
    }
    await a.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

async function markOnScreen(page: Page, className: string, code: string, item: "Mark optional" | "Mark compulsory"): Promise<void> {
  const cls = page.getByRole("combobox", { name: "Class", exact: true }).first();
  await cls.selectOption({ label: className });
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: code, exact: true }) });
  await row.getByRole("button", { name: "Class subject actions" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

const link = async (req: APIRequestContext, cls: string, sub: string) =>
  listOf(await mastersView(req), "classSubjects").find((l) => l.classId === cls && l.subjectId === sub);

test("teacher: her own class's subject on the real screen lands as one element; another class is refused", async ({ browser }) => {
  const t = await pageAs(browser, "teacher");
  const principal = await pageAs(browser, "principal");
  const writes = recordWrites(t);
  const NURSERY = classId(1);
  const LKG = classId(2);
  try {
    await t.goto("/masters?tab=subjects");
    await t.getByRole("tab", { name: "3 · Subjects by class" }).click({ timeout: 30_000 });
    await markOnScreen(t, "Nursery", "MUSIC", "Mark optional");
    await expect.poll(async () => (await link(principal.request, NURSERY, "e2e_sub_music"))?.isOptional, { timeout: 15_000 }).toBe(true);
    await expect(t.getByText(/^Not saved/)).toHaveCount(0);
    await t.screenshot({ path: test.info().outputPath("teacher-own-class.png") });
    expect(writes.filter((w) => w.url.includes("masters-desk")), "no whole-book save").toEqual([]);
    const mine = writes.filter((w) => w.url === "data/masters.class-subjects");
    expect(mine.length).toBe(1);
    expect((mine[0].body as { ops: { op: string }[] }).ops.length, "one element").toBe(1);

    const lkgBefore = await link(principal.request, LKG, "e2e_sub_music");
    await markOnScreen(t, "LKG", "MUSIC", "Mark optional");
    await expect(t.getByText(/^Not saved — .*not one of your classes/)).toBeVisible({ timeout: 15_000 });
    await t.screenshot({ path: test.info().outputPath("teacher-other-class.png") });
    expect((await link(principal.request, LKG, "e2e_sub_music"))?.isOptional, "LKG unchanged").toBe(lkgBefore?.isOptional);
  } finally {
    const l = await link(principal.request, NURSERY, "e2e_sub_music");
    if (l?.isOptional) await putElement(principal.request, "masters.class-subjects", "classSubjects", { ...l, isOptional: false });
    await t.context().close();
    await principal.context().close();
  }
});

type StaffRow = { id: string; updated_at: string; profile: { fullName?: string; classTeacherLinks?: { id: string; classId: string; sectionId: string; academicYearCode: string }[] } };

async function staffRows(req: APIRequestContext): Promise<StaffRow[]> {
  const res = await req.get("/api/data/sis.staff?limit=500");
  expect(res.status(), "GET sis.staff").toBe(200);
  return ((await res.json()) as { rows: StaffRow[] }).rows;
}

const holdsIVA = (s: StaffRow) =>
  (s.profile.classTeacherLinks ?? []).some((l) => l.classId === CLASS_IV && l.sectionId === sectionId(7) && l.academicYearCode === AY);

test("class teacher: set on the Sections screen, written to the two staff records as stored — never the roster", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  const errors = collectPageErrors(a);
  const writes = recordWrites(a);
  const rows = await staffRows(a.request);
  const holder = rows.find(holdsIVA);
  try {
    expect(holder, "IV-A has a class teacher in the fixture").toBeTruthy();
    await a.goto("/masters?tab=classes");
    await a.getByRole("button", { name: "IV 1 section", exact: true }).click({ timeout: 30_000 });
    await a.getByRole("tab", { name: "2 · Sections" }).click();
    await a.getByRole("listitem").filter({ hasText: /^IV-/ }).getByRole("button", { name: "Teachers", exact: true }).click();
    const select = a.getByRole("combobox", { name: /^Class teacher of IV-/ });
    await expect(select).toHaveValue(holder!.id, { timeout: 15_000 });
    // Another active teacher: the first option that is not the holder or "Unassigned".
    const other = await select.locator("option").evaluateAll(
      (opts, h) => (opts as HTMLOptionElement[]).map((o) => o.value).find((v) => v && v !== h) ?? "",
      holder!.id,
    );
    expect(other).not.toBe("");
    await select.selectOption(other);
    await expect.poll(async () => (await staffRows(a.request)).filter(holdsIVA).map((s) => s.id), { timeout: 20_000 }).toEqual([other]);
    await expect(select).toHaveValue(other, { timeout: 15_000 });
    await a.screenshot({ path: test.info().outputPath("class-teacher-set.png") });
    expect(writes.filter((w) => /masters-desk|staff-roster/.test(w.url)), "no whole-book / roster save").toEqual([]);
    const staffWrites = writes.filter((w) => w.url === "data/sis.staff");
    expect(staffWrites.length).toBe(1);
    const ops = (staffWrites[0].body as { ops: { id: string; row: { profile: Record<string, unknown> } }[] }).ops;
    expect(ops.map((o) => o.id).sort(), "the old and the new holder only").toEqual([holder!.id, other].sort());
    for (const o of ops) expect(Object.keys(o.row.profile), "only the link list").toEqual(["classTeacherLinks"]);
    // The rest of each record is as it was (laid on the stored profile).
    const after = await staffRows(a.request);
    for (const id of [holder!.id, other]) {
      const was = rows.find((r) => r.id === id)!;
      const now = after.find((r) => r.id === id)!;
      const strip = (p: StaffRow["profile"]) => JSON.stringify({ ...p, classTeacherLinks: undefined });
      expect(strip(now.profile), `${id}: nothing else changed`).toBe(strip(was.profile));
    }
    // Put back on the same screen.
    await select.selectOption(holder!.id);
    await expect.poll(async () => (await staffRows(a.request)).filter(holdsIVA).map((s) => s.id), { timeout: 20_000 }).toEqual([holder!.id]);
  } finally {
    await a.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

// ── Review fixes (22 Oct 2026) ──────────────────────────────────────────────

test("object: a profile form opened before another save conflicts instead of putting the old values back", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  const b = await pageAs(browser, "principal");
  const original = (await mastersView(a.request)).schoolProfile as Record<string, unknown>;
  const theirs = "https://e2e-theirs.example";
  try {
    await a.goto("/masters?tab=school");
    const tagline = a.getByRole("textbox", { name: "Tagline", exact: true });
    await tagline.fill("Typed before the other save", { timeout: 30_000 });
    // B saves a newer profile (another website).
    await putObject(b.request, "masters.school-profile", "schoolProfile", { ...original, website: theirs });
    // A's screen receives it (tables show the SAVED profile) — the typing stays.
    await expect(a.getByRole("definition").filter({ hasText: theirs })).toHaveCount(1, { timeout: 45_000 });
    await expect(tagline).toHaveValue("Typed before the other save");
    await a.getByRole("button", { name: "Save profile", exact: true }).click();
    await expect(a.getByText(/^Not saved — Someone changed this on another device/)).toBeVisible({ timeout: 15_000 });
    await a.screenshot({ path: test.info().outputPath("object-conflict.png") });
    const now = (await mastersView(a.request)).schoolProfile as Record<string, unknown>;
    expect(now.website, "B's website stays").toBe(theirs);
    expect(now.tagline, "A's stale form wrote nothing").toBe(original.tagline);
  } finally {
    await putObject(a.request, "masters.school-profile", "schoolProfile", original);
    await a.context().close();
    await b.context().close();
  }
});

const ZZ = "e2e_22c_cls_zz";

async function seedClassWithLinks(req: APIRequestContext, n: number): Promise<string[]> {
  const subjects = listOf(await mastersView(req), "subjects").filter((s) => !s.parentId).slice(0, n);
  expect(subjects.length, `${n} subjects to link`).toBe(n);
  const cls = { id: ZZ, name: "XIII", sortOrder: 99, isActive: true, groupCode: classGroupCodeForName("XIII") };
  const w1 = await writeElements(req, "masters.classes", [{ op: "upsert", id: ZZ, base: null, row: cls }]);
  expect(w1.status, `seed class: ${JSON.stringify(w1.body).slice(0, 200)}`).toBe(200);
  const ids = subjects.map((s, i) => `e2e_22c_zz_link_${i}`);
  const w2 = await writeElements(
    req,
    "masters.class-subjects",
    subjects.map((s, i) => ({ op: "upsert" as const, id: ids[i], base: null, row: { id: ids[i], classId: ZZ, subjectId: String(s.id), periodsPerWeek: 2, isActive: true, isOptional: false } })),
  );
  expect(w2.status, `seed links: ${JSON.stringify(w2.body).slice(0, 200)}`).toBe(200);
  return ids;
}

async function dropClassZZ(req: APIRequestContext): Promise<void> {
  const book = await mastersView(req);
  const ops = [
    ...(elementOf(book, "classes", ZZ) ? [{ collection: "masters.classes", op: "delete", id: ZZ, base: String(elementOf(book, "classes", ZZ)!._rev ?? 1) }] : []),
    ...listOf(book, "classSubjects")
      .filter((l) => l.classId === ZZ)
      .map((l) => ({ collection: "masters.class-subjects", op: "delete", id: String(l.id), base: String(l._rev ?? 1) })),
  ];
  if (!ops.length) return;
  const res = await req.post("/api/data/masters/batch", { data: { ops } });
  expect(res.status(), `clean up XIII: ${(await res.text()).slice(0, 200)}`).toBe(200);
}

async function removeXIIIOnScreen(page: Page): Promise<void> {
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "XIII 0 sections", exact: true }) }).getByRole("button", { name: "Remove", exact: true }).click({ timeout: 30_000 });
}

test("cascade: removing a class with its links is all or none — a stale link refuses the whole removal", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  try {
    const ids = await seedClassWithLinks(a.request, 3);
    // A's screen keeps the answer it loaded; meanwhile one link changes elsewhere.
    let first: string | null = null;
    await a.route("**/api/data/views/masters", async (route: Route) => {
      if (first) return route.fulfill({ status: 200, contentType: "application/json", body: first });
      const res = await route.fetch();
      first = await res.text();
      return route.fulfill({ response: res, body: first });
    });
    await a.goto("/masters?tab=classes");
    await expect(a.getByRole("button", { name: "XIII 0 sections", exact: true })).toBeVisible({ timeout: 30_000 });
    const l2 = elementOf(await mastersView(a.request), "classSubjects", ids[2])!;
    await putElement(a.request, "masters.class-subjects", "classSubjects", { ...l2, periodsPerWeek: 3 });
    await removeXIIIOnScreen(a);
    await expect(a.getByText(/^Not saved — /)).toBeVisible({ timeout: 15_000 });
    await a.screenshot({ path: test.info().outputPath("cascade-refused.png") });
    const book = await mastersView(a.request);
    expect(!!elementOf(book, "classes", ZZ), "the class is still there").toBe(true);
    expect(listOf(book, "classSubjects").filter((l) => l.classId === ZZ).length, "every link is still there").toBe(3);
  } finally {
    await a.unroute("**/api/data/views/masters");
    await dropClassZZ(a.request);
    await a.context().close();
  }
});

test("cascade: a class with 14 subject links is removed whole, in one batch", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  const writes = recordWrites(a);
  try {
    await seedClassWithLinks(a.request, 14);
    await a.goto("/masters?tab=classes");
    await expect(a.getByRole("button", { name: "XIII 0 sections", exact: true })).toBeVisible({ timeout: 30_000 });
    await removeXIIIOnScreen(a);
    await expect
      .poll(async () => {
        const book = await mastersView(a.request);
        return [!!elementOf(book, "classes", ZZ), listOf(book, "classSubjects").filter((l) => l.classId === ZZ).length];
      }, { timeout: 20_000 })
      .toEqual([false, 0]);
    await expect(a.getByText(/^Not saved/)).toHaveCount(0);
    const batches = writes.filter((w) => w.url === "data/masters/batch");
    expect(batches.length, `one batch (sent: ${writes.map((w) => w.url).join(", ")})`).toBe(1);
    expect((batches[0].body as { ops: unknown[] }).ops.length, "the class and its 14 links").toBe(15);
    expect(writes.filter((w) => w.url !== "data/masters/batch"), "nothing else").toEqual([]);
  } finally {
    await dropClassZZ(a.request);
    await a.context().close();
  }
});

test("number series: only the module that issues a series moves it, and never far past its next number", async ({ browser }) => {
  const principal = await pageAs(browser, "principal");
  const clerk = await pageAs(browser, "certClerk");
  const before = listOf(await mastersView(principal.request), "numberSeries");
  const receipt = before.find((s) => s.code === "RECEIPT")!;
  const voucher = before.find((s) => s.code === "EXPENSE_VOUCHER")!;
  const bump = (p: Page, body: Record<string, unknown>) => p.request.post("/api/data/masters.number-series/bump", { data: body });
  try {
    // The certificates clerk (students + certificates edit) may not move the fee receipts.
    const r1 = await bump(clerk, { series: "RECEIPT", used: Number(receipt.nextNumber) });
    expect(r1.status(), `clerk → RECEIPT: ${(await r1.text()).slice(0, 200)}`).toBe(403);
    // Far past the next number: refused, nothing moves.
    const far = Number(voucher.nextNumber) + 100;
    const r2 = await bump(principal, { series: "EXPENSE_VOUCHER", used: far });
    expect(r2.status(), `+100: ${(await r2.text()).slice(0, 200)}`).toBe(409);
    const mid = listOf(await mastersView(principal.request), "numberSeries").find((s) => s.code === "EXPENSE_VOUCHER")!;
    expect(mid.nextNumber, "not moved").toBe(voucher.nextNumber);
    // The next number itself: moves by one.
    const r3 = await bump(principal, { series: "EXPENSE_VOUCHER", used: Number(voucher.nextNumber) });
    expect(r3.status()).toBe(200);
    const after = listOf(await mastersView(principal.request), "numberSeries").find((s) => s.code === "EXPENSE_VOUCHER")!;
    expect(after.nextNumber).toBe(Number(voucher.nextNumber) + 1);
  } finally {
    const cur = listOf(await mastersView(principal.request), "numberSeries");
    for (const s of [receipt, voucher]) {
      const now = cur.find((x) => x.id === s.id);
      if (now && now.nextNumber !== s.nextNumber) await putElement(principal.request, "masters.number-series", "numberSeries", { ...now, nextNumber: s.nextNumber });
    }
    await principal.context().close();
    await clerk.context().close();
  }
});
