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
import { AY_CURRENT, E2E_TENANT_SLUG } from "../fixture";
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
    if (/\/api\/(data\/masters|school-data\/masters-desk|fees\/counter-grants)/.test(q.url())) {
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
async function counterWithFirstMonth(page: Page, child: typeof CHILD = CHILD): Promise<string> {
  await page.goto(`/fees?tab=collect&q=${encodeURIComponent(child.admissionNo)}`);
  await page.getByRole("button", { name: new RegExp(child.admissionNo) }).first().click({ timeout: 30_000 });
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

/**
 * The counter's recurring discount and the void, as `who`. Since the 2.2e
 * review both go through POST /api/fees/counter-grants: the grant is written
 * by the server once the receipt is in the database, the revoke once the void
 * is — never masters-desk, never the kernel's Masters routes from the counter.
 */
async function counterGrantAndVoid(browser: Browser, who: Who, child: typeof CHILD): Promise<{ grant: Row }> {
  const a = await pageAs(browser, who);
  const errors = collectPageErrors(a);
  const writes = recordWrites(a);
  // The principal reads the stored grants (the office holds Masters · view).
  const principal = await pageAs(browser, "principal");
  let grant: Row | undefined;
  try {
    await setFeeGroup(principal.request, child.id, GROUP);
    // Another receipt's standing grant (another child — one discount per head
    // per child is the counter's rule) — must survive the void.
    await keepAnotherGrant(principal.request);

    await counterWithFirstMonth(a, child);
    await a.getByRole("textbox", { name: "Discount on E2E FW Tuition" }).fill("100");
    await a.getByRole("checkbox", { name: "Also apply to future months" }).check();
    await expect(a.getByRole("checkbox", { name: "Also apply to future months" })).toBeChecked();
    await a.getByRole("combobox", { name: "Why is this discount given?" }).selectOption("hardship");
    // The note rides in the rule and the grant (the restore script finds them by it).
    await a.getByRole("textbox", { name: "Note (optional)" }).fill("e2e-fw counter");
    await a.getByRole("combobox", { name: "Mode & account" }).selectOption("cash");
    await a.getByRole("button", { name: "Add line" }).click();
    await a.getByRole("button", { name: /^Collect · ₹900/ }).click();
    await expect(a.getByText("Receipt details")).toBeVisible({ timeout: 60_000 });
    await a.screenshot({ path: test.info().outputPath(`counter-receipt-${who}.png`) });
    await a.getByRole("button", { name: "Close", exact: true }).click();

    // The grant, stored once, carrying its receipt's marker and its giver.
    const grants = () => mastersView(principal.request).then((b) => listOf(b, "concessionGrants"));
    const mine = async () => (await grants()).filter((g) => g.studentId === child.id && /\[v:rcv_/.test(String(g.reason)) && g.status !== "rejected");
    await expect.poll(async () => (await mine()).length, { timeout: 60_000 }).toBe(1);
    grant = (await mine())[0]!;
    expect(String(grant.id), "the counter's fixed id").toMatch(/^cg_ctr_/);
    expect(grant.status, who === "office" ? "a clerk's grant waits for approval" : "a principal's grant is approved").toBe(who === "office" ? "pending" : "approved");
    expect(String(grant.reason), "the giver is recorded").toContain(`by ${fx.sessions[who].fullName}`);
    const voucherId = String(grant.reason).match(/\[v:([^\]]+)\]/)![1];
    const receiptNo = String(grant.reason).match(/receipt (\S+) \[v:/)![1];

    expect(writes.filter((w) => w.url.includes("masters-desk")), "never the whole book").toEqual([]);
    expect(writes.some((w) => w.url === "data/masters.number-series/next"), "the receipt number was asked of the server").toBe(true);
    expect(writes.filter((w) => w.url.startsWith("data/masters") && !w.url.includes("number-series")), "no Masters write from the counter").toEqual([]);
    const grantPosts = writes.filter((w) => w.url === "fees/counter-grants" && (w.body as { action?: string }).action === "grant");
    expect(grantPosts.length, "the grant asked of the server (again while the receipt was on its way)").toBeGreaterThanOrEqual(1);
    expect((grantPosts[0].body as { sourceVoucherId?: string }).sourceVoucherId, "tied to its receipt").toBe(voucherId);
    test.info().annotations.push({ type: "receipt", description: `${who}: ${receiptNo} (${voucherId})` });

    // ── void the receipt ──
    writes.length = 0;
    await voidReceipt(a, receiptNo);
    await expect.poll(async () => (await grants()).find((g) => g.id === grant!.id)?.status, { timeout: 60_000, message: "its grant revoked" }).toBe("rejected");
    const after = await grants();
    expect(after.find((g) => g.id === grant!.id)?.reason, "with the void note").toMatch(/auto-revoked — receipt .+ voided/);
    expect(after.find((g) => g.id === OTHER_GRANT)?.status, "another receipt's grant stays").toBe("approved");
    expect(writes.filter((w) => w.url.includes("masters-desk") || w.url.startsWith("data/masters")), "never a Masters write").toEqual([]);
    const revokes = writes.filter((w) => w.url === "fees/counter-grants");
    expect(revokes.length, "the revoke asked of the server").toBeGreaterThanOrEqual(1);
    expect(revokes.every((w) => (w.body as { action?: string; voucherId?: string }).action === "revoke" && (w.body as { voucherId?: string }).voucherId === voucherId), "for exactly this receipt").toBe(true);
  } finally {
    await setFeeGroup(principal.request, child.id, null);
    await a.context().close();
    await principal.context().close();
  }
  expect(errors, "no page errors").toEqual([]);
  return { grant: grant! };
}

test("counter grant: a recurring discount lands as its grant, once, through the server; voiding the receipt revokes exactly that grant", async ({ browser }) => {
  await counterGrantAndVoid(browser, "principal", CHILD);
});

test("fees · edit clerk (Office, Masters view only): her counter grant lands once (pending); her void revokes exactly it; the catalogue and other grants stay closed to her", async ({ browser }) => {
  const officeChild = CANDIDATES.find((s) => s.id !== CHILD_ID && s.id !== (CANDIDATES.at(-1) ?? CHILD).id) ?? CHILD;
  await counterGrantAndVoid(browser, "office", officeChild);
  const office = await pageAs(browser, "office");
  try {
    const book = await mastersView(office.request).catch(() => null);
    const other = book ? elementOf(book, "concessionGrants", OTHER_GRANT) : null;
    // another (non-counter) grant through the kernel: refused
    const g = await writeElements(office.request, "masters.concession-grants", [
      { op: "upsert", id: OTHER_GRANT, base: String(other?._rev ?? 0), row: { status: "rejected" } },
    ]);
    expect(g.status, `a non-counter grant: ${JSON.stringify(g.body).slice(0, 160)}`).toBe(403);
    // the catalogue: refused
    const c = await writeElements(office.request, "masters.concessions", [
      { op: "upsert", id: `${P}cnc_by_office`, base: null, row: { id: `${P}cnc_by_office`, code: "E2E-FW-OFF", name: "Office rule", kind: "other", mode: "fixed", value: 100, feeHeadIds: [HEAD], isActive: true, notes: "e2e-fw" } },
    ]);
    expect(c.status, "the concession catalogue").toBe(403);
    // a standing discount with no receipt: refused (a Masters decision)
    const noReceipt = await office.request.post("/api/fees/counter-grants", {
      data: { action: "grant", academicYearCode: AY_CURRENT, ground: "hardship", reason: "e2e-fw", items: [{ studentId: officeChild.id, studentName: "x", feeHeadId: HEAD, feeHeadName: "x", discountPaise: 100, dueLabel: "x", futureEffectiveFrom: "2026-11-10" }] },
    });
    expect(noReceipt.status(), "no receipt, no counter grant for a clerk").toBe(403);
    // ending another receipt's grants: only once THAT receipt is voided
    const live = fx.growing.receipts[0]!;
    const early = await office.request.post("/api/fees/counter-grants", { data: { action: "revoke", voucherId: live.id, receiptNo: live.receiptNo } });
    expect(early.status(), "a live receipt's grants are not ended").toBe(409);
  } finally {
    await office.context().close();
  }
  expect(elementOf(await mastersView((await pageAs(browser, "principal")).request), "concessionGrants", OTHER_GRANT)?.status, "the other grant untouched").toBe("approved");
});

test("two counters at once: the same grant asked twice together lands once", async ({ browser }) => {
  const office = await pageAs(browser, "office");
  const principal = await pageAs(browser, "principal");
  const receipt = fx.growing.receipts[1]!; // a live fixture receipt, in the database
  const child = fx.sis.students.find((s) => s.id === receipt.lines[0]?.studentId) ?? CHILD;
  const body = {
    action: "grant",
    academicYearCode: AY_CURRENT,
    ground: "hardship",
    reason: "e2e-fw twice",
    sourceVoucherId: receipt.id,
    sourceReceiptNo: receipt.receiptNo,
    items: [{ studentId: child.id, studentName: child.fullName, feeHeadId: HEAD, feeHeadName: "E2E FW Tuition", discountPaise: 7_700, dueLabel: "E2E FW Tuition · June", futureEffectiveFrom: "2026-07-10" }],
  };
  try {
    const [r1, r2] = await Promise.all([
      office.request.post("/api/fees/counter-grants", { data: body }),
      office.request.post("/api/fees/counter-grants", { data: body }),
    ]);
    const statuses = [r1.status(), r2.status()].sort();
    // one lands; the other is refused by the database (same fixed id) or, if
    // it came second, finds the first on file
    expect(statuses[0], `answers: ${await r1.text()} | ${await r2.text()}`).toBe(200);
    const onFile = listOf(await mastersView(principal.request), "concessionGrants").filter(
      (g) => g.studentId === child.id && String(g.reason).includes(`[v:${receipt.id}]`) && g.status !== "rejected",
    );
    expect(onFile.length, "exactly one grant").toBe(1);
    // asked a third time: already on file, nothing new
    const r3 = await office.request.post("/api/fees/counter-grants", { data: body });
    expect(r3.status()).toBe(200);
    expect(((await r3.json()) as { skipped?: number }).skipped, "already on file").toBe(1);
  } finally {
    await office.context().close();
    await principal.context().close();
  }
});

test("grant before receipt: a receipt the database refused never leaves a running grant behind", async ({ browser }) => {
  test.setTimeout(240_000);
  const child = CANDIDATES.at(-2) ?? CHILD;
  const a = await pageAs(browser, "principal");
  const principal = await pageAs(browser, "principal");
  try {
    await setFeeGroup(principal.request, child.id, GROUP);
    // The fee desk push is refused (as a 23505 — two counters, one number — is).
    await a.route("**/api/school-data/fees-vouchers", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, error: "duplicate key value violates unique constraint" }) })
        : route.continue(),
    );
    await counterWithFirstMonth(a, child);
    await a.getByRole("textbox", { name: "Discount on E2E FW Tuition" }).fill("100");
    await a.getByRole("checkbox", { name: "Also apply to future months" }).check();
    await a.getByRole("combobox", { name: "Why is this discount given?" }).selectOption("hardship");
    await a.getByRole("textbox", { name: "Note (optional)" }).fill("e2e-fw refused");
    await a.getByRole("combobox", { name: "Mode & account" }).selectOption("cash");
    await a.getByRole("button", { name: "Add line" }).click();
    await a.getByRole("button", { name: /^Collect · ₹900/ }).click();
    // The server never sees the receipt → the grant is not written; the clerk is told.
    await expect(a.getByText(/standing discount for receipt .* was NOT recorded yet/)).toBeVisible({ timeout: 90_000 });
    await a.screenshot({ path: test.info().outputPath("grant-not-recorded.png") });
    const stored = listOf(await mastersView(principal.request), "concessionGrants").filter((g) => g.studentId === child.id && g.status !== "rejected");
    expect(stored, "no grant without its receipt").toEqual([]);
    const kept = await a.evaluate(() => window.localStorage.getItem("bhb.counterGrantQueue.v1"));
    expect(JSON.parse(kept ?? "[]").length, "kept for a retry").toBe(1);
  } finally {
    await a.unroute("**/api/school-data/fees-vouchers");
    await setFeeGroup(principal.request, child.id, null);
    await a.context().close();
    await principal.context().close();
  }
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

test("clone, stale second run: a tab loaded before another tab's clone is refused by the server — no duplicate set", async ({ browser }) => {
  cleanup(); // the previous case's clone out again: the previous session has no groups
  const p0 = await pageAs(browser, "principal");
  // the server's masters answer follows the restore (its cache moves with erp_versions)
  await expect
    .poll(async () => {
      const v = await mastersView(p0.request);
      return listOf(v, "feeGroups").filter((g) => g.academicYearCode === PREV_AY || g.id === GROUP).length;
    }, { timeout: 30_000 })
    .toBe(0);
  // our seed comes back (cleanup took it out)
  const reseed = await batch(p0.request, seedOps(await mastersView(p0.request)));
  expect(reseed.status, `reseed: ${JSON.stringify(reseed.body).slice(0, 200)}`).toBe(200);
  await p0.context().close();
  const open = async () => {
    const pg = await pageAs(browser, "principal");
    await pg.goto("/fees");
    await pg.locator("main").getByRole("button", { name: "Reports", exact: true }).first().click({ timeout: 30_000 });
    await pg.getByRole("button", { name: /^More exports & setup/ }).click();
    await expect(pg.getByRole("button", { name: "Prepare previous session" })).toBeVisible({ timeout: 30_000 });
    return pg;
  };
  const a = await open();
  const b = await open(); // loaded before A's clone: its copy has no 2025-26 groups
  try {
    await a.getByRole("button", { name: "Prepare previous session" }).click();
    await expect(a.getByText(`Cloned fee setup into ${PREV_AY}`)).toBeVisible({ timeout: 30_000 });
    const count = async () => listOf(await mastersView(a.request), "feeGroups").filter((g) => g.academicYearCode === PREV_AY).length;
    const once = await count();
    expect(once, "A cloned").toBeGreaterThan(0);
    await b.getByRole("button", { name: "Prepare previous session" }).click();
    await expect(b.getByText(/already has fee groups/)).toBeVisible({ timeout: 30_000 });
    await b.screenshot({ path: test.info().outputPath("clone-stale-refused.png") });
    expect(await count(), "no second set").toBe(once);
  } finally {
    await a.context().close();
    await b.context().close();
  }
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

// ── 7. Concession template apply, all or none (data-layer 2.2f, MONEY) ────
// Fees → Bulk & PDC → Concession templates → Apply. Masters is first put in
// the state production was in on 13 Oct 2026 (one stored class link without
// isOptional, so the row tables refuse the next sync): the apply is refused
// and NOTHING is stored — no grant, no template rule. (Before 2.2f the apply
// re-sent the whole grants list and synced the row tables in a second call:
// the grants were written, the sync failed, and the clerk was told "nothing
// was granted".) Healthy again, the same apply stores the rule and both
// grants, each a kernel element, and no other grant is re-written.
type TRow = Row & { id: string; _rev?: number };
const API = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const svc = { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function restJson(path: string, init: RequestInit = {}): Promise<unknown> {
  if (!/^http:\/\/127\.0\.0\.1[:/]/.test(API)) throw new Error(`refusing a non-local database: ${API}`);
  const res = await fetch(`${API}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function tenantId(): Promise<string> {
  const rows = (await restJson(`tenants?slug=eq.${E2E_TENANT_SLUG}&select=id`)) as { id: string }[];
  if (!rows[0]) throw new Error("no e2e tenant");
  return rows[0].id;
}

async function slicePayload(tenant: string, key: string): Promise<TRow[]> {
  const rows = (await restJson(`masters_desk_slices?tenant_id=eq.${tenant}&slice_key=eq.${key}&select=payload`)) as { payload: TRow[] }[];
  return rows[0]?.payload ?? [];
}

async function setSlicePayload(tenant: string, key: string, payload: TRow[]): Promise<void> {
  await restJson(`masters_desk_slices?tenant_id=eq.${tenant}&slice_key=eq.${key}`, { method: "PATCH", body: JSON.stringify({ payload }) });
}

async function resync(tenant: string): Promise<void> {
  await restJson("rpc/masters_sync_rows_from_slices", { method: "POST", body: JSON.stringify({ p_tenant_id: tenant }) });
}

async function list(req: APIRequestContext, collection: string): Promise<TRow[]> {
  const res = await req.get(`/api/data/${collection}?limit=1000`);
  expect(res.status(), `GET ${collection}`).toBe(200);
  return ((await res.json()) as { rows: TRow[] }).rows;
}

const BAD_LINK = "e2e_tpl_bad_link";


test("concession template (2.2f): applies all or none — a refused write stores no grant; a healthy one stores every grant", async ({ browser }) => {
  const page = await pageAs(browser, "principal");
  const a = { context: page.context() };
  const req = page.request;
  const tenant = await tenantId();
  // Two of the free class's children on our fee group (tuition ₹1,000 a month on HEAD).
  const pool = CANDIDATES.slice(1, 3);
  expect(pool.length, "two children of the billed class").toBe(2);
  for (const c of pool) await setFeeGroup(req, c.id, GROUP);
  const tools = await req.get("/api/fees/tools/concession-templates");
  expect(tools.status()).toBe(200);
  const heads = ((await tools.json()) as { feeHeads: { id: string }[] }).feeHeads;
  const post = (data: Record<string, unknown>) => req.post("/api/fees/tools/concession-templates", { data });

  // A template on a head two of these children are billed on (found by preview).
  let template: { id: string; ruleCode: string } | null = null;
  let children: string[] = [];
  const made: string[] = [];
  try {
    for (const head of heads.filter((h) => h.id === HEAD)) {
      const created = await post({
        action: "create",
        name: `E2E 2.2f template ${Date.now().toString(36)}`,
        ground: "merit",
        mode: "percent",
        value: 10,
        feeHeadIds: [head.id],
        siblingChildNo: null,
        endPolicy: "session_end",
        autoApproveMaxPaise: null,
        defaultReason: "e2e 2.2f",
      });
      const text = await created.text();
      expect(created.status(), `create template: ${text.slice(0, 300)}`).toBe(200);
      const t = (JSON.parse(text) as { template: { id: string; ruleCode: string } }).template;
      made.push(t.id);
      const preview = await post({ action: "apply", templateId: t.id, studentIds: pool.map((c) => c.id), fromMonth: "2026-04", reason: "e2e 2.2f", preview: true });
      const ptext = await preview.text();
      expect(preview.status(), `preview: ${ptext.slice(0, 300)}`).toBe(200);
      const grantable = ((JSON.parse(ptext) as { rows: { studentId: string; action: string }[] }).rows ?? []).filter((r) => r.action === "grant");
      if (grantable.length >= 2) {
        template = t;
        children = grantable.slice(0, 2).map((r) => r.studentId);
        break;
      }
    }
    expect(template, "both children are billed on the head").toBeTruthy();
    const tpl = template!;
    const ourRules = async () => (await list(req, "masters.concessions")).filter((r) => String(r.code ?? "").toUpperCase() === tpl.ruleCode.toUpperCase());
    const grantsBefore = await list(req, "masters.concession-grants");
    const ruleIdsOf = async () => new Set((await ourRules()).map((r) => r.id));
    const newGrants = async () => {
      const rules = await ruleIdsOf();
      return (await list(req, "masters.concession-grants")).filter((g) => rules.has(String(g.concessionId)) || (!grantsBefore.some((b) => b.id === g.id) && children.includes(String(g.studentId))));
    };
    const apply = () => post({ action: "apply", templateId: tpl.id, studentIds: children, fromMonth: "2026-04", reason: "e2e 2.2f", preview: false });

    await test.step("1. Masters' row tables refuse the next sync → the apply is refused and NOTHING is stored", async () => {
      const links0 = await slicePayload(tenant, "classSubjects");
      const first = links0[0];
      // The 13 Oct 2026 state: one stored class link without isOptional.
      const bad: TRow = { id: BAD_LINK, classId: String(first.classId), subjectId: String(first.subjectId), isActive: false, periodsPerWeek: 0 };
      await setSlicePayload(tenant, "classSubjects", [...links0, bad]);
      try {
        const res = await apply();
        const text = await res.text();
        expect(res.status(), `refused: ${text.slice(0, 300)}`).toBeGreaterThanOrEqual(400);
        expect(await newGrants(), "no grant for either child").toEqual([]);
        expect(await ourRules(), "no template rule").toEqual([]);
      } finally {
        await setSlicePayload(tenant, "classSubjects", (await slicePayload(tenant, "classSubjects")).filter((l) => l.id !== BAD_LINK));
        await resync(tenant);
      }
    });

    await test.step("2. Masters healthy → the same apply stores the rule and both grants, each a kernel element", async () => {
      const res = await apply();
      const text = await res.text();
      expect(res.status(), `applied: ${text.slice(0, 300)}`).toBe(200);
      expect((JSON.parse(text) as { granted?: number }).granted).toBe(2);
      const grants = await newGrants();
      expect(grants.map((g) => String(g.studentId)).sort()).toEqual([...children].sort());
      for (const g of grants) expect(g._rev, `grant ${g.id} is a kernel element`).toBe(1);
      expect((await ourRules()).length, "the template's rule").toBe(1);
      const now = new Map((await list(req, "masters.concession-grants")).map((g) => [g.id, g._rev]));
      expect(grantsBefore.filter((b) => now.get(b.id) !== b._rev).map((b) => b.id), "no other grant was re-written").toEqual([]);
    });
  } finally {
    // Our grants and rules out of the stored lists (directly: the kernel never
    // empties a list), the row tables re-synced, the templates deleted.
    const codes = new Set<string>();
    for (const id of made) {
      const rows = (await restJson(`fee_concession_templates?id=eq.${id}&select=*`)) as TRow[];
      for (const r of rows) codes.add(String(r.rule_code ?? "").toUpperCase());
      await restJson(`fee_concession_templates?id=eq.${id}`, { method: "DELETE" });
    }
    const rules = await slicePayload(tenant, "concessions");
    const ruleIds = new Set(rules.filter((r) => codes.has(String(r.code ?? "").toUpperCase())).map((r) => r.id));
    if (ruleIds.size) {
      await setSlicePayload(tenant, "concessions", rules.filter((r) => !ruleIds.has(r.id)));
      const grants = await slicePayload(tenant, "concessionGrants");
      await setSlicePayload(tenant, "concessionGrants", grants.filter((g) => !ruleIds.has(String(g.concessionId))));
      await resync(tenant);
    }
    for (const c of pool) await setFeeGroup(req, c.id, null);
    await a.context.close();
  }
});

// ── Between midnight and 05:30 IST the counter's date is India's today ────
// Fee Take defaulted the collection date to the UTC date, while the receipt's
// back-dating rule (lib/fees collectPayment) judges it against India's today.
// From 00:00 to 05:30 IST those differ by a day: a clerk who may not back-date
// pressed Collect and nothing was saved (every CI run after 00:00 IST on
// 28 Oct 2026 failed the clerk case). The browser's clock is put at 00:30 IST.
test("collection date: at 00:30 IST the counter offers India's today — the date the back-dating rule judges against", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 } });
  await signIn(context, "office");
  const page = await context.newPage();
  try {
    // 28 Oct 00:30 IST = 27 Oct 19:00 UTC.
    await page.clock.install({ time: new Date("2026-10-27T19:00:00.000Z") });
    await page.goto(`/fees?tab=collect&q=${encodeURIComponent(CHILD.admissionNo)}`);
    await page.getByRole("button", { name: new RegExp(CHILD.admissionNo) }).first().click({ timeout: 30_000 });
    await expect(page.getByRole("textbox", { name: "Collection date" })).toHaveValue("2026-10-28", { timeout: 30_000 });
  } finally {
    await context.close();
  }
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
