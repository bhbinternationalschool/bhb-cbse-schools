/**
 * staff-month-register — the staff attendance month register, the month's
 * leave, and "only the owner can edit the staff attendance register"
 * (director, 15 Oct 2026).
 *
 * Seeded here through the app's own write paths, as the people who would:
 *   - a month of staff marks (September 2026, every working day, every
 *     member of staff who keeps attendance) saved by the OWNER through the
 *     staff register's save (POST /api/school-data/staff-attendance-registers);
 *   - a leave applied by the class teacher (POST /api/v1/staff/leave/apply)
 *     and approved by the principal (POST /api/v1/staff/leave/decide), on top
 *     of the fixture's approved 22–24 Sep CL.
 *
 * Then: both views show what was saved (cells, totals, leave rows, balances);
 * the owner may change a mark; the principal and the office may not — the
 * server answers 403 and their screens offer no edit. Screenshots in
 * e2e/staff-register-shots (git-ignored): desktop-light, phone375-dark and
 * the print preview.
 */
import fs from "node:fs";
import path from "node:path";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { demoSessionCookieName, type DemoSession } from "@/lib/auth";
import { protectedSuperAdminEmails } from "@/lib/superAdmin";
import { AY_CURRENT, E2E_TENANT_SLUG, staffId } from "../fixture";
import { mintSessionCookie } from "../session";
import { APP_URL, expect, fx, signIn, test, type Who } from "../support";

const SHOTS = process.env.STAFF_REGISTER_SHOTS || path.join(__dirname, "..", "staff-register-shots");
const DESK = "/api/school-data/staff-attendance-registers";
const VIEW = "/api/v1/attendance/staff-month?month=2026-09";
const MONTH = "2026-09";

/** The owner: a protected super admin (lib/superAdmin) — no fixture person holds the owner role. */
const OWNER: DemoSession = {
  persona: "staff",
  fullName: "E2E Owner",
  roleCode: "owner",
  email: protectedSuperAdminEmails()[0],
  tenantSlug: E2E_TENANT_SLUG,
  academicYearCode: AY_CURRENT,
};

type Mark = { staffId: string; status: string; note: string; inTime: string; outTime: string; punchWay: string };
type Register = { id: string; academicYearCode: string; date: string; marks: Mark[]; markedBy: string; markedAt: string; remark: string };
type Desk = { registers: Register[]; settings: unknown; outdoorDuty: unknown[]; stamps: { registers: Record<string, string> } };

async function openOwner(browser: Browser, opts: { width?: number; height?: number; dark?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    colorScheme: opts.dark ? "dark" : "light",
  });
  await context.addCookies([
    { name: demoSessionCookieName(), value: mintSessionCookie(OWNER), url: APP_URL, httpOnly: true, sameSite: "Lax" },
    { name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL },
  ]);
  return context.newPage();
}

async function openWho(browser: Browser, who: Who, opts: { width?: number; height?: number; dark?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    colorScheme: opts.dark ? "dark" : "light",
  });
  await signIn(context, who);
  await context.addCookies([{ name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL }]);
  return context.newPage();
}

async function readDesk(req: APIRequestContext): Promise<Desk> {
  const r = await req.get(DESK);
  expect(r.status(), await r.text().catch(() => "")).toBe(200);
  return (await r.json()) as Desk;
}

/** Everyone the register lists: active, not visiting. The fixture assigns nobody the owner/admin role. */
const PEOPLE = fx.staff.staff.filter((s) => s.status === "active" && s.category !== "visiting");
const LEAVE_PERSON = staffId(9); // fixture leave e2e_leave_3: CL 22–24 Sep, approved
const TEACHER = fx.sessions.teacher.staffId!; // applies for leave on Mon 14 Sep

function septemberDays(): string[] {
  const out: string[] = [];
  for (let d = 1; d <= 30; d++) out.push(`${MONTH}-${String(d).padStart(2, "0")}`);
  return out;
}
const isSunday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() === 0;

/** The month as it is seeded: deterministic, so the totals can be asserted. */
function plannedMark(i: number, date: string): Mark | null {
  const day = Number(date.slice(8));
  const sid = PEOPLE[i]!.id;
  if (isSunday(date)) {
    // The office worked one Sunday: an extra day.
    return sid === staffId(2) && date === "2026-09-13"
      ? { staffId: sid, status: "P", note: "Extra day — admissions camp", inTime: "09:05", outTime: "13:00", punchWay: "direct" }
      : null;
  }
  if (sid === LEAVE_PERSON && day >= 22 && day <= 24) {
    return { staffId: sid, status: "LE", note: "On leave (CL)", inTime: "", outTime: "", punchWay: "leave_sync" };
  }
  const k = (i * 7 + day) % 23;
  if (k === 0) return { staffId: sid, status: "A", note: "Not punched", inTime: "", outTime: "", punchWay: "" };
  if (k === 5) return { staffId: sid, status: "L", note: "", inTime: "09:25", outTime: "14:10", punchWay: "printed_qr" };
  if (k === 11) return { staffId: sid, status: "HD", note: "", inTime: "11:40", outTime: "14:10", punchWay: "self" };
  return { staffId: sid, status: "P", note: "", inTime: "08:5" + (day % 10), outTime: "14:10", punchWay: day % 2 ? "self" : "printed_qr" };
}

function plannedRegisters(): Register[] {
  return septemberDays()
    .map((date) => {
      const marks = PEOPLE.map((_, i) => plannedMark(i, date)).filter((m): m is Mark => !!m);
      return marks.length
        ? { id: `e2e_sar_${date}`, academicYearCode: AY_CURRENT, date, marks, markedBy: "E2E Owner", markedAt: `${date}T09:00:00.000Z`, remark: "" }
        : null;
    })
    .filter((r): r is Register => !!r);
}

/** Expected counts for one person (Dussehra etc. are not in the fixture's holidays: only Sundays are off). */
function expectedFor(sid: string) {
  const i = PEOPLE.findIndex((p) => p.id === sid);
  const t = { P: 0, L: 0, HD: 0, A: 0, LE: 0, working: 0, extra: 0 };
  for (const date of septemberDays()) {
    const m = plannedMark(i, date);
    if (isSunday(date)) {
      if (m) t.extra += 1;
      continue;
    }
    t.working += 1;
    if (m) t[m.status as "P" | "L" | "HD" | "A" | "LE"] += 1;
  }
  return t;
}

/** A save as the register screen sends it: one changed register, stamped with what it was read at. */
async function saveOneMark(req: APIRequestContext, date: string, sid: string, status: string) {
  const desk = await readDesk(req);
  const reg = desk.registers.find((r) => r.date === date);
  expect(reg, `register for ${date}`).toBeTruthy();
  const marks = reg!.marks.map((m) => (m.staffId === sid ? { ...m, status, note: `Changed to ${status}`, punchWay: "adjusted" } : m));
  return req.post(DESK, {
    data: {
      registers: [{ ...reg!, marks }],
      settings: desk.settings,
      outdoorDuty: desk.outdoorDuty,
      stamps: { registers: { [reg!.id]: desk.stamps.registers[reg!.id] ?? "" } },
    },
  });
}

/** A tab of Attendance → Staff (the panel's own tab bar). */
function staffTab(page: Page, name: string) {
  return page.getByRole("tablist", { name: "Staff attendance" }).getByRole("tab", { name, exact: true });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
});

test("seed: a month of staff marks saved by the owner, and a leave applied and approved", async ({ browser }) => {
  let seededNow = false;
  const owner = await openOwner(browser);
  try {
    const desk = await readDesk(owner.request);
    // A stack is seeded once (a re-run on the same stack keeps the first seed).
    if (desk.registers.some((r) => r.date.startsWith(MONTH))) return;
    const regs = plannedRegisters();
    const r = await owner.request.post(DESK, {
      data: {
        registers: regs,
        settings: desk.settings,
        outdoorDuty: desk.outdoorDuty,
        stamps: { registers: Object.fromEntries(regs.map((x) => [x.id, ""])) },
      },
    });
    expect(r.status(), await r.text()).toBe(200);
    const after = await readDesk(owner.request);
    expect(after.registers.filter((x) => x.date.startsWith(MONTH))).toHaveLength(regs.length);
    seededNow = true;
  } finally {
    await owner.context().close();
  }

  // The class teacher applies for CL on Monday 14 Sep; the principal approves it.
  if (!seededNow) return;
  const teacher = await openWho(browser, "teacher");
  const principal = await openWho(browser, "principal");
  try {
    const applied = await teacher.request.post("/api/v1/staff/leave/apply", {
      data: { typeCode: "CL", fromDate: "2026-09-14", toDate: "2026-09-14", reason: "Family function" },
    });
    expect(applied.status(), await applied.text()).toBe(200);
    const id = ((await applied.json()) as { data: { id: string } }).data.id;
    const decided = await principal.request.post("/api/v1/staff/leave/decide", { data: { id, approve: true } });
    expect(decided.status(), await decided.text()).toBe(200);
  } finally {
    await teacher.context().close();
    await principal.context().close();
  }
});

test("the month register: every person, every day, the marks and the totals the register holds", async ({ browser }) => {
  const page = await openOwner(browser);
  try {
    const r = await page.request.get(VIEW);
    expect(r.status()).toBe(200);
    const view = (await r.json()) as {
      data: {
        canEdit: boolean;
        days: { date: string; teaching: { off: boolean } }[];
        staff: { id: string; cells: Record<string, { s: string; leaveType?: string; extra?: boolean }>; totals: Record<string, number> & { leaveByType: Record<string, number> } }[];
      };
    };
    const v = view.data;
    expect(v.canEdit).toBe(true);
    expect(v.days).toHaveLength(30);
    expect(v.days.filter((d) => d.teaching.off).map((d) => d.date)).toEqual(["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"]);
    expect(v.staff.map((s) => s.id).sort()).toEqual(PEOPLE.map((p) => p.id).sort());

    // A plain person: every count equals the seed.
    const plain = staffId(20);
    const e = expectedFor(plain);
    const row = v.staff.find((s) => s.id === plain)!;
    expect({ P: row.totals.P, L: row.totals.L, HD: row.totals.HD, A: row.totals.A, working: row.totals.working }).toEqual({
      P: e.P, L: e.L, HD: e.HD, A: e.A, working: e.working,
    });
    expect(row.totals.unmarked).toBe(0);
    expect(row.totals.present).toBe(e.P + e.L + e.HD / 2);

    // Leave shows its type; the approved app leave overlays 14 Sep (the
    // decide route writes LE onto the register, or the view overlays it).
    const onLeave = v.staff.find((s) => s.id === LEAVE_PERSON)!;
    expect(["2026-09-22", "2026-09-23", "2026-09-24"].map((d) => onLeave.cells[d]!.leaveType)).toEqual(["CL", "CL", "CL"]);
    expect(onLeave.totals.leaveByType.CL).toBe(3);
    const teacherRow = v.staff.find((s) => s.id === TEACHER)!;
    expect(teacherRow.cells["2026-09-14"]!.s).toBe("LE");
    expect(teacherRow.cells["2026-09-14"]!.leaveType).toBe("CL");

    // The office's Sunday is an extra day.
    const office = v.staff.find((s) => s.id === staffId(2))!;
    expect(office.cells["2026-09-13"]!.extra).toBe(true);
    expect(office.totals.extra).toBe(1);

    // On screen.
    await page.goto("/attendance?tab=staff");
    await staffTab(page, "Month register").click({ timeout: 30_000 });
    await page.getByLabel("Month", { exact: true }).fill(MONTH);
    const grid = page.getByTestId("staff-month-register");
    const cell = grid.locator(`tr[data-staff-id="${LEAVE_PERSON}"] td[data-date="2026-09-22"]`);
    await expect(cell).toHaveText(/^CL/, { timeout: 30_000 });
    await expect(grid.locator(`tr[data-staff-id="${staffId(2)}"] td[data-date="2026-09-13"]`)).toContainText("P");
    await expect(page.getByTestId("staff-register-edit-rule")).toContainText("You are the owner");
    await expect(staffTab(page, "Manage")).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "month-register-owner-desktop-light.png"), fullPage: false });
  } finally {
    await page.context().close();
  }
});

test("leave this month: each leave with its approver, and the balances at month end", async ({ browser }) => {
  const page = await openWho(browser, "principal");
  try {
    const r = await page.request.get(VIEW);
    const v = ((await r.json()) as {
      data: {
        canEdit: boolean;
        leaves: { staffId: string; typeCode: string; daysInMonth: number; approvedBy: string; fromDate: string }[];
        balances: { staffId: string; byType: Record<string, { inMonth: number; usedToMonthEnd: number; balance: number; allotted: number }> }[];
      };
    }).data;
    expect(v.canEdit).toBe(false);
    const mine = v.leaves.find((l) => l.staffId === TEACHER)!;
    expect(mine).toMatchObject({ typeCode: "CL", daysInMonth: 1, fromDate: "2026-09-14", approvedBy: fx.sessions.principal.fullName });
    const fixtureLeave = v.leaves.find((l) => l.staffId === LEAVE_PERSON)!;
    expect(fixtureLeave).toMatchObject({ typeCode: "CL", daysInMonth: 3, approvedBy: "E2E Principal" });
    const bal = v.balances.find((b) => b.staffId === LEAVE_PERSON)!.byType.CL!;
    expect(bal.inMonth).toBe(3);
    expect(bal.usedToMonthEnd).toBe(3);
    expect(bal.balance).toBe(bal.allotted - 3);

    await page.goto("/attendance?tab=staff");
    await staffTab(page, "Leave this month").click({ timeout: 30_000 });
    await page.getByLabel("Month", { exact: true }).fill(MONTH);
    const leave = page.getByTestId("staff-month-leave");
    await expect(leave.getByTestId("staff-leave-total")).toContainText("day", { timeout: 30_000 });
    await expect(leave.locator("tr", { hasText: fx.sessions.teacher.fullName }).first()).toContainText(fx.sessions.principal.fullName);
    await page.screenshot({ path: path.join(SHOTS, "leave-month-principal-desktop-light.png") });
  } finally {
    await page.context().close();
  }
});

test("only the owner can change a mark: principal and office are refused by the server (403), the owner is not", async ({ browser }) => {
  const principal = await openWho(browser, "principal");
  const office = await openWho(browser, "office");
  const owner = await openOwner(browser);
  const date = "2026-09-08";
  const who = staffId(21);
  try {
    const current = (await readDesk(owner.request)).registers.find((r) => r.date === date)!.marks.find((m) => m.staffId === who)!.status;
    const target = current === "A" ? "P" : "A";
    const p = await saveOneMark(principal.request, date, who, target);
    expect(p.status(), "principal's changed mark").toBe(403);
    expect(((await p.json()) as { error: string }).error).toContain("Only the owner");
    const o = await saveOneMark(office.request, date, who, target);
    expect(o.status(), "office's changed mark").toBe(403);

    // Nothing was written.
    const before = await readDesk(owner.request);
    expect(before.registers.find((r) => r.date === date)!.marks.find((m) => m.staffId === who)!.status).toBe(current);

    const w = await saveOneMark(owner.request, date, who, target);
    expect(w.status(), await w.text()).toBe(200);
    const after = await readDesk(owner.request);
    expect(after.registers.find((r) => r.date === date)!.marks.find((m) => m.staffId === who)!.status).toBe(target);

    // A non-owner's save that changes no mark (the registers as stored) still goes through.
    const same = await principal.request.post(DESK, {
      data: { registers: [], settings: after.settings, outdoorDuty: after.outdoorDuty, stamps: { registers: {} } },
    });
    expect(same.status(), await same.text()).toBe(200);
  } finally {
    await principal.context().close();
    await office.context().close();
    await owner.context().close();
  }
});

test("the principal's screen offers no edit: no Manage tab, the month register is view only", async ({ browser }) => {
  const page = await openWho(browser, "principal");
  try {
    await page.goto("/attendance?tab=staff");
    await staffTab(page, "Month register").click({ timeout: 30_000 });
    await expect(page.getByTestId("staff-register-edit-rule")).toContainText("View only — only the owner", { timeout: 30_000 });
    for (const name of ["Manage", "Direct mark", "Adjust", "Adjust half-day", "Sync leave"]) {
      await expect(staffTab(page, name)).toHaveCount(0);
    }
  } finally {
    await page.context().close();
  }
});

test("phone 375 dark and the print preview", async ({ browser }) => {
  const phone = await openWho(browser, "principal", { width: 375, height: 812, dark: true });
  try {
    await phone.goto("/attendance?tab=staff");
    await staffTab(phone, "Month register").click({ timeout: 30_000 });
    await phone.getByLabel("Month", { exact: true }).fill(MONTH);
    await expect(phone.getByTestId("staff-month-register").locator(`tr[data-staff-id="${LEAVE_PERSON}"]`)).toBeVisible({ timeout: 30_000 });
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "no sideways page scroll at 375 px").toBeLessThanOrEqual(1);
    await phone.getByTestId("staff-month-register").locator("table").scrollIntoViewIfNeeded();
    await phone.evaluate(() => window.scrollBy(0, -140));
    await phone.screenshot({ path: path.join(SHOTS, "month-register-phone375-dark.png") });
    await staffTab(phone, "Leave this month").click();
    await expect(phone.getByTestId("staff-leave-total")).toBeVisible({ timeout: 30_000 });
    await phone.screenshot({ path: path.join(SHOTS, "leave-month-phone375-dark.png") });
  } finally {
    await phone.context().close();
  }

  const page = await openOwner(browser);
  try {
    await page.goto("/attendance?tab=staff");
    await staffTab(page, "Month register").click({ timeout: 30_000 });
    await page.getByLabel("Month", { exact: true }).fill(MONTH);
    await expect(page.getByTestId("staff-month-register").locator(`tr[data-staff-id="${LEAVE_PERSON}"]`)).toBeVisible({ timeout: 30_000 });
    // What Print does (printSheet), without the dialog: the body class, landscape, print media.
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "@media print { @page { size: A4 landscape; margin: 6mm; } }";
      document.head.appendChild(style);
      document.body.classList.add("printing-staff-register");
    });
    await page.emulateMedia({ media: "print" });
    await page.setViewportSize({ width: 1123, height: 794 });
    await expect(page.locator(".staff-register-sheet header.erp-print-brand")).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "month-register-print-preview.png"), fullPage: true });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    fs.writeFileSync(path.join(SHOTS, "month-register-print.pdf"), pdf);
  } finally {
    await page.context().close();
  }
});
