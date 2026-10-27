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

