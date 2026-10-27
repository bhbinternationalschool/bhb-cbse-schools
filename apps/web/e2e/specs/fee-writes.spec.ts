/**
 * fee-writes — data-layer 2.2e: the fee setup and every lib/ writer of
 * concession grants write Masters ELEMENTS (POST /api/data/masters.* and the
 * all-or-none batch route), never the tab's whole book; the fee counter's
 * receipt number comes from the server.
 *
 * Seeds its own fee setup (ids "e2e_fw_…": one tuition head, one group for a
 * free class, April–March lines) through the kernel, and takes it out again.
 * A fee structure switches on the school's built-in structures for every
 * class (ensureFeeSetup), so the file runs in its own project after every
 * other one ("fee-writes", playwright.config.ts).
 *
 *  1. Fee-line wipe: an old whole-book body for the fee lists is refused by
 *     masters-desk (409 fee_setup_elements) — dropping two lines, or changing
 *     one — and nothing changes; the kernel takes one removal per request.
 *  2. Overlap: two principals edit DIFFERENT fee lines from screens loaded
 *     together — both land, no "Not saved", B's request is B's line alone.
 *  3. Counter grant + void: a recurring counter discount at Fee Take lands as
 *     the grant (and its rule) in ONE batch request — never masters-desk;
 *     voiding that receipt revokes exactly its grant (another receipt's grant
 *     stays approved), again one batch.
 *  4. RTE waiver: unticking a head for an RTE child writes the waiver rule +
 *     grant in one batch; ticking it again removes the grant.
 *  5. Clone: Masters → Fee structure "Copy groups & amounts" into a year with
 *     none — one bad element in the batch and NOTHING is cloned; without it
 *     the groups, lines and instalments are all cloned, in one request.
 *  6. Receipt number: a receipt made elsewhere (the phone counter) after this
 *     tab loaded, and a counter left behind its records — the counter screen
 *     issues max(on record) + 1, never a number in use.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { APIRequestContext, Browser, Page, Request } from "@playwright/test";
import { AY_CURRENT } from "../fixture";
import { BILLED_CLASS, OWES } from "../certificateDuesCase";
import { elementOf, listOf, mastersView, writeElements } from "../mastersKernel";
import { APP_URL, collectPageErrors, expect, fx, signIn, test, type Who } from "../support";

type Row = Record<string, unknown>;

const P = "e2e_fw_";
const HEAD = `${P}fh_tuition`;
const GROUP = `${P}fg`;
const MONTHLY = 100_000;
const MONTHS = ["APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "JAN", "FEB", "MAR"] as const;
const lineId = (m: string) => `${P}fsl_${m}`;
const instId = (m: string) => `${P}inst_${m}`;

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);
// No action waits for ever: a missing control fails the case in 30 s.
test.use({ actionTimeout: 30_000 });

async function pageAs(browser: Browser, who: Who, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ baseURL: APP_URL, viewport });
  await signIn(context, who);
  return context.newPage();
}

/** Every Masters write a page sends (kernel or the old book), with its body. */
function recordWrites(page: Page): { url: string; body: unknown }[] {
  const out: { url: string; body: unknown }[] = [];
  page.on("request", (q: Request) => {
    if (q.method() !== "POST") return;
    if (/\/api\/(data\/masters|school-data\/masters-desk)/.test(q.url())) {
      out.push({ url: q.url().replace(/^.*\/api\//, ""), body: q.postDataJSON() });
    }
  });
  return out;
}

type BatchOp = { collection: string; op: "upsert" | "delete"; id: string; base: string | null; row?: Row };

async function batch(req: APIRequestContext, ops: BatchOp[]): Promise<{ status: number; body: Row }> {
  const res = await req.post("/api/data/masters/batch", { data: { ops } });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Row };
}

/** The installments of this year (the school's own, else ours). */
function seedOps(book: Record<string, unknown>): BatchOp[] {
  const ops: BatchOp[] = [];
  const have = listOf(book as never, "installments").filter((i) => i.academicYearCode === AY_CURRENT);
  const inst = new Map<string, string>();
  for (const [i, m] of MONTHS.entries()) {
    const found = have.find((x) => x.code === m);
    if (found) inst.set(m, String(found.id));
    else {
      inst.set(m, instId(m));
      const month = ((i + 3) % 12) + 1;
      const year = i < 9 ? 2026 : 2027;
      ops.push({
        collection: "masters.installments",
        op: "upsert",
        id: instId(m),
        base: null,
        row: { id: instId(m), academicYearCode: AY_CURRENT, code: m, label: m, dueOn: `${year}-${String(month).padStart(2, "0")}-10`, sortOrder: i + 1, isActive: true },
      });
    }
  }
  if (!elementOf(book as never, "feeHeads", HEAD)) {
    ops.push({
      collection: "masters.fee-heads",
      op: "upsert",
      id: HEAD,
      base: null,
      row: { id: HEAD, code: "E2E-FW-TUI", nameEn: "E2E FW Tuition", category: "academic", frequency: "monthly", isOptional: false, isRefundable: false, isActive: true, sortOrder: 1 },
    });
  }
  if (!elementOf(book as never, "feeGroups", GROUP)) {
    ops.push({
      collection: "masters.fee-groups",
      op: "upsert",
      id: GROUP,
      base: null,
      row: {
        id: GROUP,
        code: "E2E-FW",
        name: "E2E fee writes",
        academicYearCode: AY_CURRENT,
        studentType: OWES!.studentType,
        classIds: [BILLED_CLASS],
        isActive: true,
        structurePublishedAt: "2026-04-01T00:00:00.000Z",
        structurePublishedBy: "e2e",
      },
    });
  }
  for (const m of MONTHS) {
    if (elementOf(book as never, "feeStructureLines", lineId(m))) continue;
    ops.push({
      collection: "masters.fee-structure-lines",
      op: "upsert",
      id: lineId(m),
      base: null,
      row: { id: lineId(m), feeGroupId: GROUP, feeHeadId: HEAD, classId: null, amountPaise: MONTHLY, installmentId: inst.get(m) },
    });
  }
  return ops;
}

/**
 * Every element this file made, out again — through the stack's slice write
 * path (scripts/e2e-restore-fee-writes.ts): the kernel never leaves a list
 * empty, and on the stack these are the only fee lines.
 */
function cleanup(): void {
  execFileSync("npx", ["--yes", "tsx", path.join(__dirname, "..", "..", "..", "..", "scripts", "e2e-restore-fee-writes.ts")], {
    cwd: path.join(__dirname, "..", ".."),
    stdio: "inherit",
    env: process.env,
  });
}

test.beforeAll(async ({ browser }) => {
  expect(BILLED_CLASS, "a free class").toBeTruthy();
  cleanup();
  const p = await pageAs(browser, "principal");
  try {
    const ops = seedOps(await mastersView(p.request));
    const r = await batch(p.request, ops);
    expect(r.status, `seed: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
  } finally {
    await p.context().close();
  }
});

test.afterAll(() => {
  cleanup();
});

// ── 1. Fee-line wipe ──────────────────────────────────────────────────────
test("fee-line wipe: an old whole-book body for the fee lists is refused; the kernel takes one removal per save", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  try {
    const before = listOf(await mastersView(a.request), "feeStructureLines").filter((l) => l.feeGroupId === GROUP);
    expect(before.length, "seeded").toBe(12);
    const desk = (await (await a.request.get("/api/school-data/masters-desk")).json()) as {
      feeStructureLines: Row[];
      sliceStamps?: Record<string, string>;
    };
    // (a) dropping two lines, as a stale or truncated copy would send it
    const drop = await a.request.post("/api/school-data/masters-desk", {
      data: {
        version: 2,
        feeStructureLines: desk.feeStructureLines.filter((l) => l.id !== lineId("APR") && l.id !== lineId("MAY")),
        sliceBases: { feeStructureLines: desk.sliceStamps?.feeStructureLines ?? "" },
      },
    });
    const dropBody = (await drop.json().catch(() => ({}))) as { reason?: string };
    expect(drop.status(), `old body (drop two): ${JSON.stringify(dropBody).slice(0, 200)}`).toBe(409);
    expect(dropBody.reason).toBe("fee_setup_elements");
    // (b) the whole list with one amount changed — still the old path: refused
    const edit = await a.request.post("/api/school-data/masters-desk", {
      data: {
        version: 2,
        feeStructureLines: desk.feeStructureLines.map((l) => (l.id === lineId("JUN") ? { ...l, amountPaise: 1 } : l)),
        sliceBases: { feeStructureLines: desk.sliceStamps?.feeStructureLines ?? "" },
      },
    });
    expect(edit.status(), "old body (edit one)").toBe(409);
    // (c) two removals in one kernel request
    const book = await mastersView(a.request);
    const two = await writeElements(a.request, "masters.fee-structure-lines", [
      { op: "delete", id: lineId("APR"), base: String(elementOf(book, "feeStructureLines", lineId("APR"))?._rev ?? 0) },
      { op: "delete", id: lineId("MAY"), base: String(elementOf(book, "feeStructureLines", lineId("MAY"))?._rev ?? 0) },
    ]);
    expect(two.status, "two removals in one save").toBe(400);
    const after = listOf(await mastersView(a.request), "feeStructureLines").filter((l) => l.feeGroupId === GROUP);
    expect(after.length, "nothing removed").toBe(12);
    expect(elementOf(await mastersView(a.request), "feeStructureLines", lineId("JUN"))?.amountPaise, "nothing changed").toBe(MONTHLY);
  } finally {
    await a.context().close();
  }
});


// ── 2. Overlap: two people, two fee lines, both land ──────────────────────
async function openGroup(page: Page): Promise<void> {
  await page.goto("/masters?tab=fee-structure");
  await page.getByRole("tab", { name: /Promoted \/ continuing/ }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: /E2E fee writes/ }).click({ timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Amount" }).first()).toBeVisible({ timeout: 30_000 });
}

/** The amount field of one month card (cards run April → March). */
const amountOf = (page: Page, month: number) => page.getByRole("textbox", { name: "Amount" }).nth(month);

const lineAmount = async (req: APIRequestContext, m: string) => elementOf(await mastersView(req), "feeStructureLines", lineId(m))?.amountPaise;

test("overlap: two people edit different fee lines at once — both land, no conflict", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  const b = await pageAs(browser, "principal");
  const errors = [...collectPageErrors(a), ...collectPageErrors(b)];
  const writesB = recordWrites(b);
  try {
    // Both screens open on the same answer.
    await openGroup(a);
    await openGroup(b);
    // A changes April; B, without reloading, changes May.
    await amountOf(a, 0).fill("1100");
    await amountOf(a, 0).press("Tab");
    await expect.poll(() => lineAmount(a.request, "APR"), { timeout: 15_000 }).toBe(110_000);
    await amountOf(b, 1).fill("1200");
    await amountOf(b, 1).press("Tab");
    await expect.poll(() => lineAmount(a.request, "MAY"), { timeout: 15_000, message: "B's edit landed" }).toBe(120_000);
    expect(await lineAmount(a.request, "APR"), "A's edit survives B's save").toBe(110_000);
    await b.waitForTimeout(2_000);
    await expect(b.getByText(/^Not saved/)).toHaveCount(0);
    await b.screenshot({ path: test.info().outputPath("overlap-b.png") });
    expect(writesB.filter((w) => w.url.includes("masters-desk")), "no whole-book save").toEqual([]);
    const sent = writesB.filter((w) => w.url.startsWith("data/masters"));
    expect(sent.length, "B sent one request").toBe(1);
    expect(sent[0].url).toBe("data/masters.fee-structure-lines");
    expect((sent[0].body as { ops: { id: string }[] }).ops.map((o) => o.id), "only May's line").toEqual([lineId("MAY")]);
  } finally {
    for (const m of ["APR", "MAY"]) {
      const cur = elementOf(await mastersView(a.request), "feeStructureLines", lineId(m));
      if (cur && cur.amountPaise !== MONTHLY) {
        await writeElements(a.request, "masters.fee-structure-lines", [{ op: "upsert", id: lineId(m), base: String(cur._rev ?? 0), row: { amountPaise: MONTHLY } }]);
      }
    }
    await a.context().close();
    await b.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

// ── 3. Counter grant, and the void that revokes exactly it ────────────────
// The child the counter cases bill: one of the free class's own children (the
// first on a fresh stack; FEE_WRITES_CHILD picks another for a re-run on a used
// stack — receipts cannot be removed, only voided).
const CANDIDATES = fx.sis.students.filter(
  (s) => s.classId === BILLED_CLASS && s.academicYearCode === AY_CURRENT && s.status === "active" && s.householdId && s.studentType === OWES!.studentType,
);
const CHILD = CANDIDATES[Number(process.env.FEE_WRITES_CHILD ?? 0)] ?? OWES!;
const CHILD_ID = CHILD.id;

async function setFeeGroup(req: APIRequestContext, id: string, group: string | null): Promise<void> {
  const rv = await req.get(`/api/data/sis.students?ids=${encodeURIComponent(id)}`);
  const body = (await rv.json()) as { rows: Row[] };
  const base = body.rows?.[0]?.updated_at;
  expect(base, "the child's revision").toBeTruthy();
  const w = await req.post("/api/data/sis.students", { data: { ops: [{ op: "upsert", id, base, row: { fee_group_id: group } }] } });
  expect(w.status(), `fee group: ${(await w.text()).slice(0, 200)}`).toBe(200);
}

/** The counter, the child picked, the first open month ticked and opened (a re-run finds April paid). */
async function counterWithFirstMonth(page: Page): Promise<string> {
  await page.goto(`/fees?tab=collect&q=${encodeURIComponent(CHILD.admissionNo)}`);
  await page.getByRole("button", { name: new RegExp(CHILD.admissionNo) }).first().click({ timeout: 30_000 });
  // A month wholly open at ₹1,000 (the overlap case re-prices April and May; a
  // re-run finds earlier months paid or part-paid).
  const button = page.getByRole("button", { name: /^\w+ 2026 1 open · 1 overdue ₹1,000$/ }).first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  const month = String(await button.textContent()).match(/([A-Z][a-z]+ 2026)/)![1];
  await page.getByRole("checkbox", { name: `Select open heads for ${month}` }).check();
  await page.getByRole("button", { name: new RegExp(`^${month}`) }).click();
  return month;
}

/** Another receipt's grant on another child (idempotent). */
async function keepAnotherGrant(req: APIRequestContext): Promise<void> {
  const book = await mastersView(req);
  const ops: BatchOp[] = [];
  if (!elementOf(book, "concessions", OTHER_RULE)) {
    ops.push({
      collection: "masters.concessions",
      op: "upsert",
      id: OTHER_RULE,
      base: null,
      row: { id: OTHER_RULE, code: "E2E-FW-OTH", name: "E2E other", kind: "other", academicYearCode: AY_CURRENT, mode: "fixed", value: 5_000, siblingTiers: [], feeHeadIds: [HEAD], autoApproveMaxPaise: null, documentationRequired: false, incompatibleCodes: [], notes: "e2e-fw", isActive: true },
    });
  }
  if (!elementOf(book, "concessionGrants", OTHER_GRANT)) {
    ops.push({
      collection: "masters.concession-grants",
      op: "upsert",
      id: OTHER_GRANT,
      base: null,
      row: { id: OTHER_GRANT, concessionId: OTHER_RULE, studentId: OTHER_CHILD, ground: "other", status: "approved", reason: "e2e-fw · receipt RCV-OTHER [v:rcv_e2e_other]", effectiveFrom: "2027-03-01", effectiveTo: null, createdAt: "2026-10-01T00:00:00.000Z", siblingChildNo: null },
    });
  }
  if (!ops.length) return;
  const r = await batch(req, ops);
  expect(r.status, `another grant: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
}

const OTHER_RULE = `${P}cnc_other`;
const OTHER_GRANT = `${P}cg_other`;
const OTHER_CHILD = fx.sis.students.find((s) => s.academicYearCode === AY_CURRENT && s.classId !== BILLED_CLASS && s.status === "active")!.id;

test("counter grant: a recurring discount lands as its grant in one batch; voiding the receipt revokes exactly that grant", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  const errors = collectPageErrors(a);
  const writes = recordWrites(a);
  try {
    await setFeeGroup(a.request, CHILD_ID, GROUP);
    // Another receipt's standing grant (another child — one discount per head
    // per child is the counter's rule) — must survive the void.
    await keepAnotherGrant(a.request);

    await counterWithFirstMonth(a);
    await a.getByRole("textbox", { name: "Discount on E2E FW Tuition" }).fill("100");
    await a.getByRole("checkbox", { name: "Also apply to future months" }).check();
    await expect(a.getByRole("checkbox", { name: "Also apply to future months" })).toBeChecked();
    await a.getByRole("combobox", { name: "Why is this discount given?" }).selectOption("hardship");
    // The note rides in the rule and the grant (the restore script finds them by it).
    await a.getByRole("textbox", { name: "Note (optional)" }).fill("e2e-fw counter");
    await a.getByRole("combobox", { name: "Mode & account" }).selectOption("cash");
    await a.getByRole("button", { name: "Add line" }).click();
    await a.getByRole("button", { name: /^Collect · ₹900/ }).click();
    // The receipt opens; the grant is written before the counter says "collected".
    await expect(a.getByText("Receipt details")).toBeVisible({ timeout: 30_000 });
    await a.screenshot({ path: test.info().outputPath("counter-receipt.png") });
    await a.getByRole("button", { name: "Close", exact: true }).click();

    // The grant, stored, carrying its receipt's marker.
    const grants = () => mastersView(a.request).then((b) => listOf(b, "concessionGrants"));
    await expect.poll(async () => (await grants()).filter((g) => g.studentId === CHILD_ID && /\[v:rcv_/.test(String(g.reason)) && g.id !== OTHER_GRANT).length, { timeout: 15_000 }).toBe(1);
    const grant = (await grants()).find((g) => g.studentId === CHILD_ID && g.id !== OTHER_GRANT && /\[v:rcv_/.test(String(g.reason)))!;
    expect(grant.status, "a principal's grant is approved").toBe("approved");
    const voucherId = String(grant.reason).match(/\[v:([^\]]+)\]/)![1];
    const receiptNo = String(grant.reason).match(/receipt (\S+) \[v:/)![1];

    expect(writes.filter((w) => w.url.includes("masters-desk")), "never the whole book").toEqual([]);
    expect(writes.some((w) => w.url === "data/masters.number-series/next"), "the receipt number was asked of the server").toBe(true);
    const grantWrites = writes.filter((w) => w.url.startsWith("data/masters") && !w.url.includes("number-series"));
    expect(grantWrites.length, "one request").toBe(1);
    expect(grantWrites[0].url).toBe("data/masters/batch");
    const ops = (grantWrites[0].body as { ops: BatchOp[] }).ops;
    expect(ops.filter((o) => o.collection === "masters.concession-grants").map((o) => [o.op, o.id, o.base]), "the grant: one new element").toEqual([["upsert", grant.id, null]]);
    expect(ops.every((o) => o.collection === "masters.concession-grants" || (o.collection === "masters.concessions" && o.base === null)), "and at most its new rule").toBe(true);
    test.info().annotations.push({ type: "receipt", description: `${receiptNo} (${voucherId})` });

    // ── void the receipt ──
    console.log("STEP void", receiptNo);
    writes.length = 0;
    await voidReceipt(a, receiptNo);
    console.log("STEP voided");
    await expect.poll(async () => (await grants()).find((g) => g.id === grant.id)?.status, { timeout: 20_000, message: "its grant revoked" }).toBe("rejected");
    const after = await grants();
    expect(after.find((g) => g.id === grant.id)?.reason, "with the void note").toMatch(/auto-revoked — receipt .+ voided/);
    expect(after.find((g) => g.id === OTHER_GRANT)?.status, "another receipt's grant stays").toBe("approved");
    expect(writes.filter((w) => w.url.includes("masters-desk")), "never the whole book").toEqual([]);
    const revoke = writes.filter((w) => w.url.startsWith("data/masters") && !w.url.includes("number-series"));
    expect(revoke.length, "one request").toBe(1);
    expect((revoke[0].body as { ops: BatchOp[] }).ops.map((o) => [o.collection, o.id, Object.keys(o.row ?? {}).sort().join(",")]), "exactly its grant, status + note").toEqual([
      ["masters.concession-grants", grant.id, "reason,status"],
    ]);
  } finally {
    await setFeeGroup(a.request, CHILD_ID, null);
    await a.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

async function voidReceipt(page: Page, receiptNo: string): Promise<void> {
  // Same page (the counter's own copy holds the receipt it just made — its
  // push to the fee desk may still be on its way).
  await page.getByRole("button", { name: "Receipts", exact: true }).click({ timeout: 30_000 });
  await page.getByRole("searchbox", { name: "Receipt no. / UTR / paper book no." }).fill(receiptNo, { timeout: 30_000 });
  await expect(page.getByText(/^Showing 1 of /)).toBeVisible({ timeout: 15_000 });
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Void", exact: true }).first().click();
}


// ── 4. RTE head waiver ─────────────────────────────────────────────────────
async function setStudentType(req: APIRequestContext, id: string, type: string): Promise<void> {
  const rv = await req.get(`/api/data/sis.students?ids=${encodeURIComponent(id)}`);
  const body = (await rv.json()) as { rows: Row[] };
  const w = await req.post("/api/data/sis.students", { data: { ops: [{ op: "upsert", id, base: body.rows?.[0]?.updated_at, row: { student_type: type } }] } });
  expect(w.status(), `student type: ${(await w.text()).slice(0, 200)}`).toBe(200);
}

/** RTE is a default-off module: switched on through the Modules screen for this case, put back as it was. */
async function setRteModule(page: Page, enabled: boolean | null): Promise<boolean> {
  await page.goto("/modules");
  const row = page.locator("li", { hasText: "RTE / EWS / scholarship" }).first();
  const toggle = row.getByRole("button", { name: /^(Enable|Disable)$/ });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  const now = (await toggle.textContent())?.trim() === "Disable";
  if (enabled !== null && now !== enabled) {
    await toggle.click();
    await expect
      .poll(
        async () => {
          const r = await page.request.get("/api/data/views/module-registry");
          const body = (await r.json().catch(() => null)) as { data?: { enabled?: Record<string, boolean> } } | null;
          return body?.data?.enabled?.rte_ews ?? null;
        },
        { timeout: 30_000, message: `module registry saved rte_ews=${enabled}` },
      )
      .toBe(enabled);
  }
  return now;
}

test("RTE waiver: unticking a head writes the waiver rule + grant in one batch; ticking it again removes the grant", async ({ browser }) => {
  const rteChild = CANDIDATES.at(-1) ?? CHILD;
  expect(rteChild.id, "an RTE child apart from the counter's").not.toBe(CHILD_ID);
  const a = await pageAs(browser, "principal");
  const errors = collectPageErrors(a);
  const writes = recordWrites(a);
  const grantId = `cg_rtew_${rteChild.id}_${HEAD}`;
  const ruleId = `cnc_rtew_${HEAD}`;
  const rteWas = await setRteModule(a, true);
  try {
    // The kernel never empties a list: keep another grant on file (as the
    // school always has), so taking this one off is a removal, not a wipe.
    await keepAnotherGrant(a.request);
    await setStudentType(a.request, rteChild.id, "RTE");
    await a.goto("/rte");
    await a.getByRole("tablist", { name: "Sections" }).getByRole("tab", { name: "Enrolled", exact: true }).click({ timeout: 30_000 });
    const row = a.getByRole("listitem").filter({ hasText: rteChild.fullName });
    await row.getByRole("button", { name: "Fee heads" }).click({ timeout: 30_000 });
    const box = row.getByRole("checkbox", { name: "E2E FW Tuition" });
    await expect(box).toBeChecked({ timeout: 15_000 });
    // Controlled by what Masters holds: it changes once the write is back.
    await box.click();
    await expect.poll(async () => elementOf(await mastersView(a.request), "concessionGrants", grantId)?.status, { timeout: 20_000 }).toBe("approved");
    expect(elementOf(await mastersView(a.request), "concessions", ruleId)?.value, "a 100% waiver rule").toBe(100);
    await a.screenshot({ path: test.info().outputPath("rte-waived.png") });
    const waive = writes.filter((w) => w.url.startsWith("data/masters"));
    expect(writes.filter((w) => w.url.includes("masters-desk")), "never the whole book").toEqual([]);
    expect(waive.length, "one request").toBe(1);
    expect(waive[0].url).toBe("data/masters/batch");
    expect((waive[0].body as { ops: BatchOp[] }).ops.map((o) => [o.collection, o.op, o.id, o.base]).sort(), "the rule and the grant, both new").toEqual([
      ["masters.concession-grants", "upsert", grantId, null],
      ["masters.concessions", "upsert", ruleId, null],
    ]);

    writes.length = 0;
    await expect(box).not.toBeChecked({ timeout: 15_000 });
    await box.click();
    await expect.poll(async () => !!elementOf(await mastersView(a.request), "concessionGrants", grantId), { timeout: 20_000 }).toBe(false);
    const charge = writes.filter((w) => w.url.startsWith("data/masters"));
    expect(charge.length, "one request").toBe(1);
    expect((charge[0].body as { ops: BatchOp[] }).ops.map((o) => [o.collection, o.op, o.id]), "exactly the grant removed").toEqual([
      ["masters.concession-grants", "delete", grantId],
    ]);
    expect(elementOf(await mastersView(a.request), "concessions", ruleId), "the rule stays (it is per head)").toBeTruthy();
  } finally {
    await setStudentType(a.request, rteChild.id, rteChild.studentType);
    await setRteModule(a, rteWas);
    await a.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

// ── 5. The fee-setup clone: all or nothing ─────────────────────────────────
const PREV_AY = "2025-26";

test("clone: one bad element in the batch and nothing is cloned; without it everything is, in one request", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  const errors = collectPageErrors(a);
  const writes = recordWrites(a);
  const prevGroups = async () => listOf(await mastersView(a.request), "feeGroups").filter((g) => g.academicYearCode === PREV_AY);
  try {
    expect(await prevGroups(), "no fee setup in the previous session yet").toEqual([]);
    await a.goto("/fees");
    await a.locator("main").getByRole("button", { name: "Reports", exact: true }).first().click({ timeout: 30_000 });
    await a.getByRole("button", { name: /^More exports & setup/ }).click({ timeout: 30_000 });
    const prepare = a.getByRole("button", { name: "Prepare previous session" });
    await expect(prepare).toBeVisible({ timeout: 30_000 });

    // (a) one element of the batch is bad (a base for an element that does not exist)
    let spoiled = false;
    await a.route("**/api/data/masters/batch", async (route) => {
      const body = route.request().postDataJSON() as { ops: BatchOp[] };
      const i = body.ops.findIndex((o) => o.collection === "masters.fee-structure-lines");
      if (i >= 0) {
        body.ops[i] = { ...body.ops[i], base: "7" };
        spoiled = true;
      }
      await route.continue({ postData: JSON.stringify(body) });
    });
    await prepare.click();
    await expect(a.getByText(/Nothing was cloned/)).toBeVisible({ timeout: 30_000 });
    expect(spoiled, "the clone went through the batch route").toBe(true);
    await a.screenshot({ path: test.info().outputPath("clone-refused.png") });
    expect(await prevGroups(), "nothing cloned").toEqual([]);
    expect(listOf(await mastersView(a.request), "installments").filter((i) => i.academicYearCode === PREV_AY), "no instalment either").toEqual([]);

    // (b) the same action, untouched: everything, in ONE request
    await a.unroute("**/api/data/masters/batch");
    writes.length = 0;
    await prepare.click();
    await expect(a.getByText(`Cloned fee setup into ${PREV_AY}`)).toBeVisible({ timeout: 30_000 });
    const book = await mastersView(a.request);
    const cloned = listOf(book, "feeGroups").filter((g) => g.academicYearCode === PREV_AY);
    const mine = cloned.find((g) => g.code === "E2E-FW");
    expect(mine, "our group cloned").toBeTruthy();
    expect(listOf(book, "feeStructureLines").filter((l) => l.feeGroupId === mine!.id).length, "with all twelve lines").toBe(12);
    expect(listOf(book, "installments").filter((i) => i.academicYearCode === PREV_AY).length, "and the year's instalments").toBeGreaterThanOrEqual(12);
    const sent = writes.filter((w) => w.url.startsWith("data/masters") && !w.url.includes("number-series"));
    expect(writes.filter((w) => w.url.includes("masters-desk")), "never the whole book").toEqual([]);
    expect(sent.length, "one request").toBe(1);
    expect(sent[0].url).toBe("data/masters/batch");
    const ops = (sent[0].body as { ops: BatchOp[] }).ops;
    expect(ops.filter((o) => o.collection === "masters.fee-groups").length, "every cloned group in it").toBe(cloned.length);
    await a.screenshot({ path: test.info().outputPath("clone-done.png") });
  } finally {
    await a.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

// ── 6. The counter's receipt number comes from the records ─────────────────
async function setReceiptCounter(req: APIRequestContext, next: number): Promise<void> {
  const cur = listOf(await mastersView(req), "numberSeries").find((s) => s.code === "RECEIPT")!;
  const w = await writeElements(req, "masters.number-series", [{ op: "upsert", id: String(cur.id), base: String(cur._rev ?? 0), row: { nextNumber: next } }]);
  expect(w.status, `receipt counter: ${JSON.stringify(w.body).slice(0, 200)}`).toBe(200);
}

const tail = (no: string) => Number(no.match(/(\d+)$/)?.[1] ?? NaN);

test("receipt number: after a phone receipt the tab never saw, with the counter left behind, the counter issues the highest on record + 1", async ({ browser }) => {
  const a = await pageAs(browser, "principal");
  const office = await pageAs(browser, "office");
  const errors = collectPageErrors(a);
  try {
    await setFeeGroup(a.request, CHILD_ID, GROUP);
    // The counter screen, loaded and ready, the child's month ticked.
    await counterWithFirstMonth(a);
    await a.getByRole("combobox", { name: "Mode & account" }).selectOption("cash");
    await a.getByRole("button", { name: "Add line" }).click();

    // Meanwhile the phone counter takes ₹1 from another family, as RCV-00040
    // (the counter moved there first) — then the counter is put back to 1: a
    // counter behind its records, as production's was on 27 Oct (701 vs 710).
    await setReceiptCounter(a.request, 40);
    const cv = fx.growing.chargeVouchers[3]!;
    const dues = await office.request.get(`/api/v1/staff/fees/dues?studentId=${encodeURIComponent(cv.studentId)}`);
    expect(dues.status(), await dues.text()).toBe(200);
    const due = ((await dues.json()) as { data: { children: { studentId: string; dues: { dueKey: string; balancePaise: number }[] }[] } }).data.children
      .find((c) => c.studentId === cv.studentId)
      // The charge voucher's due (the academic ones depend on the built-in structures the fee setup switches on).
      ?.dues.find((d) => d.balancePaise > 0 && !d.dueKey.startsWith("acad:"));
    expect(due, "an open charge due for the phone receipt").toBeTruthy();
    const paid = await office.request.post("/api/v1/staff/fees/collect", {
      data: {
        studentId: cv.studentId,
        lines: [{ studentId: cv.studentId, dueKey: due!.dueKey, amountPaise: 100 }],
        tenders: [{ mode: "cash", amountPaise: 100 }],
        clientRef: `e2e-fw-${Date.now().toString(36)}`,
      },
    });
    expect(paid.status(), await paid.text()).toBe(200);
    const phoneNo = ((await paid.json()) as { data: { receiptNo: string } }).data.receiptNo;
    expect(phoneNo.startsWith("RCV-"), `the phone receipt is in the RECEIPT series: ${phoneNo}`).toBe(true);
    await setReceiptCounter(a.request, 1);

    // The counter screen collects now.
    await a.getByRole("button", { name: /^Collect & print receipt/i }).click();
    await expect(a.getByText("Receipt details")).toBeVisible({ timeout: 30_000 });
    const shown = String(await a.locator("text=/RCV-\\d+ · full format/").first().textContent()).match(/RCV-\d+/)![0];
    await a.screenshot({ path: test.info().outputPath("receipt-number.png") });
    expect(shown, "never a number in use").not.toBe(phoneNo);
    expect(tail(shown), `the highest on record + 1 (phone: ${phoneNo})`).toBe(Math.max(tail(phoneNo), 0) + 1);
    // The counter follows: never behind what was issued.
    await expect
      .poll(async () => Number(listOf(await mastersView(a.request), "numberSeries").find((s) => s.code === "RECEIPT")?.nextNumber), { timeout: 15_000 })
      .toBeGreaterThan(tail(shown));
    await a.getByRole("button", { name: "Close", exact: true }).click();
    await voidReceipt(a, shown);
  } finally {
    await setFeeGroup(a.request, CHILD_ID, null);
    await a.context().close();
    await office.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
});

// ── Seen: the screens this step touches, desktop-light and 375-dark ───────
test("seen: fee structure, counter, RTE heads and fee reports — desktop-light and phone375-dark", async ({ browser }) => {
  const shots: { name: string; width: number; height: number; dark: boolean }[] = [
    { name: "desktop-light", width: 1440, height: 900, dark: false },
    { name: "phone375-dark", width: 375, height: 812, dark: true },
  ];
  for (const shot of shots) {
    const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: shot.width, height: shot.height }, colorScheme: shot.dark ? "dark" : "light" });
    await signIn(context, "principal");
    await context.addCookies([{ name: "bhb_theme", value: shot.dark ? "dark" : "light", url: APP_URL }]);
    const page = await context.newPage();
    const errors = collectPageErrors(page);
    try {
      await page.goto("/masters?tab=fee-structure");
      await page.getByRole("tab", { name: /Promoted \/ continuing/ }).click({ timeout: 30_000 });
      await page.getByRole("button", { name: /E2E fee writes/ }).click({ timeout: 30_000 });
      await expect(page.getByRole("textbox", { name: "Amount" }).first()).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: test.info().outputPath(`fee-structure-${shot.name}.png`), fullPage: false });
      await page.goto("/masters?tab=concessions");
      await page.waitForTimeout(2_000);
      await page.screenshot({ path: test.info().outputPath(`concessions-${shot.name}.png`), fullPage: false });
      await page.goto(`/fees?tab=collect&q=${encodeURIComponent(CHILD.admissionNo)}`);
      await page.getByRole("button", { name: new RegExp(CHILD.admissionNo) }).first().click({ timeout: 30_000 });
      await page.waitForTimeout(2_000);
      await page.screenshot({ path: test.info().outputPath(`counter-${shot.name}.png`), fullPage: false });
    } finally {
      await context.close();
    }
    expect(errors, `no page errors (${shot.name})`).toEqual([]);
  }
});
