/**
 * Reading the day for the 6 PM brief.
 *
 * Seven questions, each answered from the table that actually holds the
 * answer, and each able to say "nobody recorded this" rather than "zero" —
 * see dailyBrief.ts for why that distinction is the whole point.
 *
 * Deliberately direct Supabase reads rather than the desk loaders. The
 * browser-state loaders (loadFees, loadAttendance, loadAccounts) return
 * EMPTY on the server, and composeLeadershipWhatsAppReport in
 * waLeadershipReports.server.ts is built on exactly those — which is why a
 * report built that way shows a school that collected nothing and marked
 * nobody. The two places here that do use desk state (defaulters, staff
 * names) hydrate it first, the way every other correct server reader does.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureFeesHydratedServer } from "@/lib/feesPersistence.server";
import { listLiveDefaulters } from "@/lib/playbook";
import {
  householdCandidateNumbers,
  pickWaNumbers,
} from "@/lib/waHouseholdNumbers";
import { listKnownNotOnWhatsApp } from "@/lib/waNumberHealth.server";
import { TENANT } from "@/lib/types";
import {
  emptyBrief,
  tenderModeLabel,
  type BriefClassAttendance,
  type BriefCollection,
  type BriefDefaulters,
  type BriefExpenses,
  type BriefMoneyLine,
  type BriefStaffAttendance,
  type BriefStaffRow,
  type BriefStudentAttendance,
  type DailyBrief,
} from "@/lib/dailyBrief";
import { isReviewDemoStudent, reviewDemoHouseholdIds } from "@/lib/reviewDemoRecords";

/** Today in IST — the school's day, whatever the server's clock zone is. */
export function istToday(nowMs = Date.now()): string {
  return new Date(nowMs + 330 * 60_000).toISOString().slice(0, 10);
}

function paise(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function sortMoney(lines: BriefMoneyLine[]): BriefMoneyLine[] {
  return lines.sort(
    (a, b) => b.paise - a.paise || a.label.localeCompare(b.label),
  );
}

/* ── 1. Collection, with the mode break-up ─────────────────────────── */

async function readCollection(dateIso: string): Promise<BriefCollection> {
  const empty: BriefCollection = {
    recorded: false,
    totalPaise: 0,
    receipts: 0,
    byMode: [],
  };
  const ctx = await getServerTenantContext();
  if (!ctx) return empty;

  const { data: vouchers, error } = await ctx.sb
    .from("fee_desk_vouchers")
    .select("id, total_paise, voided_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("collection_date", dateIso)
    .is("voided_at", null);
  if (error) {
    console.warn("[dailyBrief] collection read failed", error.message);
    return empty;
  }
  const rows = vouchers || [];
  // No receipt today is a real answer and not the same as a failed read:
  // the caller gets recorded:false either way, and the composer says
  // "nothing recorded" rather than "collected ₹0".
  if (rows.length === 0) return empty;

  const ids = rows.map((r) => String(r.id));
  const byMode = new Map<string, BriefMoneyLine>();
  let tenderTotal = 0;
  // Chunked: a busy fee day is a few hundred receipts and a single `in`
  // list that long is how a query starts getting refused.
  for (let i = 0; i < ids.length; i += 200) {
    const { data: tenders, error: tErr } = await ctx.sb
      .from("fee_desk_voucher_tenders")
      .select("mode, amount_paise")
      .eq("tenant_id", ctx.tenantId)
      .in("voucher_id", ids.slice(i, i + 200));
    if (tErr) {
      console.warn("[dailyBrief] tender read failed", tErr.message);
      break;
    }
    for (const t of tenders || []) {
      const mode = String(t.mode || "other");
      const amt = paise(t.amount_paise);
      const cur =
        byMode.get(mode) ??
        { key: mode, label: tenderModeLabel(mode), paise: 0, count: 0 };
      cur.paise += amt;
      cur.count += 1;
      byMode.set(mode, cur);
      tenderTotal += amt;
    }
  }

  const voucherTotal = rows.reduce((s, r) => s + paise(r.total_paise), 0);
  return {
    recorded: true,
    // The voucher total is the receipt the parent holds and therefore the
    // figure of record. Tenders should sum to it; when they do not, the
    // break-up is still shown and the headline stays the voucher total
    // rather than quietly reporting a different number from the receipts.
    totalPaise: voucherTotal || tenderTotal,
    receipts: rows.length,
    byMode: sortMoney([...byMode.values()]),
  };
}

/* ── 2. Expenses, by head ──────────────────────────────────────────── */

async function readExpenses(dateIso: string): Promise<BriefExpenses> {
  const empty: BriefExpenses = {
    recorded: false,
    totalPaise: 0,
    vouchers: 0,
    byHead: [],
  };
  const ctx = await getServerTenantContext();
  if (!ctx) return empty;

  const { data, error } = await ctx.sb
    .from("accounts_desk_expense_vouchers")
    .select("id, grand_total_paise, category_id, cancelled_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("voucher_date", dateIso)
    .is("cancelled_at", null);
  if (error) {
    console.warn("[dailyBrief] expense read failed", error.message);
    return empty;
  }
  const rows = data || [];
  if (rows.length === 0) return empty;

  const [{ data: cats }, { data: lines }] = await Promise.all([
    ctx.sb
      .from("accounts_desk_expense_categories")
      .select("id, name")
      .eq("tenant_id", ctx.tenantId),
    ctx.sb
      .from("accounts_desk_expense_voucher_lines")
      .select("voucher_id, category_id, total_paise")
      .eq("tenant_id", ctx.tenantId)
      .in("voucher_id", rows.map((r) => String(r.id)).slice(0, 500)),
  ]);
  const catName = new Map(
    (cats || []).map((c) => [String(c.id), String(c.name || "")]),
  );

  const byHead = new Map<string, BriefMoneyLine>();
  const add = (categoryId: string, amount: number) => {
    const key = categoryId || "unfiled";
    const cur =
      byHead.get(key) ??
      {
        key,
        // An expense with no head is filed as such rather than dropped:
        // money that left the school belongs in the total whatever the
        // clerk forgot to pick.
        label: catName.get(key) || "No head chosen",
        paise: 0,
        count: 0,
      };
    cur.paise += amount;
    cur.count += 1;
    byHead.set(key, cur);
  };

  // Lines carry the head when a voucher was split across several; a
  // voucher with no lines falls back to its own category.
  const linedVouchers = new Set<string>();
  for (const l of lines || []) {
    linedVouchers.add(String(l.voucher_id));
    add(String(l.category_id || ""), paise(l.total_paise));
  }
  for (const v of rows) {
    if (linedVouchers.has(String(v.id))) continue;
    add(String(v.category_id || ""), paise(v.grand_total_paise));
  }

  return {
    recorded: true,
    totalPaise: rows.reduce((s, r) => s + paise(r.grand_total_paise), 0),
    vouchers: rows.length,
    byHead: sortMoney([...byHead.values()]),
  };
}

/* ── 3. Student attendance, class by class ─────────────────────────── */

function classLabelOf(
  masters: MastersState,
  classId: string,
  sectionId: string,
): string {
  const c = masters.classes?.find((x) => x.id === classId);
  const sec = masters.sections?.find((x) => x.id === sectionId);
  const cls = c?.name ? `Class ${c.name}` : classId || "Unknown class";
  return sec?.name ? `${cls} · ${sec.name}` : cls;
}

async function readStudentAttendance(
  dateIso: string,
  masters: MastersState,
  sis: SisState,
): Promise<BriefStudentAttendance> {
  const empty: BriefStudentAttendance = {
    classes: [],
    present: 0,
    absent: 0,
    strength: 0,
    classesMarked: 0,
    classesUnmarked: 0,
  };
  const ctx = await getServerTenantContext();
  if (!ctx) return empty;

  const ay = currentAcademicYearCode(masters);
  const demoHouseholds = reviewDemoHouseholdIds(sis);
  const active = (sis.students ?? []).filter(
    (s) =>
      s.status === "active" &&
      (!ay || s.academicYearCode === ay) &&
      // The 6 PM brief reports on the school, so it does not count the
      // Play review family.
      !isReviewDemoStudent(s) &&
      !(s.householdId && demoHouseholds.has(s.householdId)),
  );

  // Every section that HAS children is a section that should have been
  // marked. Counting only the registers that exist would hide the classes
  // nobody opened, which is the number a principal most wants at 6 PM.
  const strength = new Map<string, number>();
  for (const s of active) {
    const key = `${s.classId}:${s.sectionId}`;
    strength.set(key, (strength.get(key) ?? 0) + 1);
  }

  const { data: registers, error } = await ctx.sb
    .from("attendance_desk_registers")
    .select("id, class_id, section_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("attendance_date", dateIso);
  if (error) {
    console.warn("[dailyBrief] register read failed", error.message);
    return empty;
  }

  const regs = registers || [];
  const marksByReg = new Map<string, { present: number; absent: number }>();
  if (regs.length) {
    const ids = regs.map((r) => String(r.id));
    for (let i = 0; i < ids.length; i += 200) {
      const { data: marks } = await ctx.sb
        .from("attendance_desk_marks")
        .select("register_id, status")
        .eq("tenant_id", ctx.tenantId)
        .in("register_id", ids.slice(i, i + 200));
      for (const m of marks || []) {
        const key = String(m.register_id);
        const cur = marksByReg.get(key) ?? { present: 0, absent: 0 };
        // P / A, as stored. Anything else (leave codes a school adds
        // later) counts as seen but neither present nor absent, which is
        // honest rather than guessing which way it should fall.
        if (String(m.status) === "P") cur.present++;
        else if (String(m.status) === "A") cur.absent++;
        marksByReg.set(key, cur);
      }
    }
  }

  const seenSections = new Set<string>();
  const classes: BriefClassAttendance[] = [];
  for (const r of regs) {
    const classId = String(r.class_id || "");
    const sectionId = String(r.section_id || "");
    const key = `${classId}:${sectionId}`;
    seenSections.add(key);
    const counts = marksByReg.get(String(r.id)) ?? { present: 0, absent: 0 };
    const total = strength.get(key) ?? counts.present + counts.absent;
    classes.push({
      classId,
      sectionId,
      label: classLabelOf(masters, classId, sectionId),
      present: counts.present,
      absent: counts.absent,
      unmarked: Math.max(0, total - counts.present - counts.absent),
      strength: total,
      // A register row with no marks in it was opened and not filled —
      // still "not marked" as far as anyone reading this is concerned.
      marked: counts.present + counts.absent > 0,
    });
  }

  for (const [key, n] of strength) {
    if (seenSections.has(key)) continue;
    const [classId = "", sectionId = ""] = key.split(":");
    classes.push({
      classId,
      sectionId,
      label: classLabelOf(masters, classId, sectionId),
      present: 0,
      absent: 0,
      unmarked: n,
      strength: n,
      marked: false,
    });
  }

  classes.sort((a, b) => a.label.localeCompare(b.label));
  const present = classes.reduce((s, c) => s + c.present, 0);
  const absent = classes.reduce((s, c) => s + c.absent, 0);
  return {
    classes,
    present,
    absent,
    strength: classes.reduce((s, c) => s + c.strength, 0),
    classesMarked: classes.filter((c) => c.marked).length,
    classesUnmarked: classes.filter((c) => !c.marked).length,
  };
}

/* ── 4. Staff attendance, and why anyone is missing ────────────────── */

type LeaveRow = {
  id: string;
  staff_id: string;
  type_code: string;
  from_date: string;
  to_date: string;
  days: number;
  status: string;
};

async function readStaffAttendance(
  dateIso: string,
  masters: MastersState,
): Promise<BriefStaffAttendance> {
  const empty: BriefStaffAttendance = {
    marked: false,
    present: 0,
    absent: 0,
    strength: 0,
    absentRows: [],
    pending: [],
  };
  const ctx = await getServerTenantContext();
  if (!ctx) return empty;

  const staff = (masters.staff ?? []).filter((s) => s.status === "active");
  const nameOf = new Map(
    staff.map((s) => [s.id, { name: s.fullName || s.id, empCode: s.empCode || "" }]),
  );

  const [registers, leaves, types] = await Promise.all([
    ctx.sb
      .from("staff_attendance_desk_registers")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("attendance_date", dateIso),
    ctx.sb
      .from("staff_leave_requests")
      .select("id, staff_id, type_code, from_date, to_date, days, status")
      .eq("tenant_id", ctx.tenantId)
      // The real vocabulary from staffHr: a two-level school parks a
      // request at pending_l2 after the first approval, and it is still
      // undecided — leaving it out would hide exactly the requests a
      // principal is being asked to settle.
      .in("status", ["pending", "pending_l2", "approved"]),
    ctx.sb
      .from("staff_leave_types")
      .select("code, name")
      .eq("tenant_id", ctx.tenantId),
  ]);

  const typeName = new Map(
    (types.data || []).map((t) => [String(t.code), String(t.name || t.code)]),
  );
  const leaveRows = (leaves.data || []) as LeaveRow[];

  const coversToday = (l: LeaveRow) =>
    String(l.from_date || "") <= dateIso && dateIso <= String(l.to_date || "");
  const approvedToday = new Map<string, LeaveRow>();
  const pendingToday = new Map<string, LeaveRow>();
  const pendingAny: LeaveRow[] = [];
  for (const l of leaveRows) {
    const decided = String(l.status) === "approved";
    if (!decided) pendingAny.push(l);
    if (!coversToday(l)) continue;
    if (decided) approvedToday.set(String(l.staff_id), l);
    else pendingToday.set(String(l.staff_id), l);
  }

  const regIds = (registers.data || []).map((r) => String(r.id));
  const marks = new Map<string, string>();
  if (regIds.length) {
    const { data } = await ctx.sb
      .from("staff_attendance_desk_marks")
      .select("staff_id, status")
      .eq("tenant_id", ctx.tenantId)
      .in("register_id", regIds);
    for (const m of data || []) marks.set(String(m.staff_id), String(m.status));
  }

  const rowFor = (staffId: string, l: LeaveRow | undefined, reason: BriefStaffRow["reason"]): BriefStaffRow => {
    const who = nameOf.get(staffId);
    return {
      staffId,
      name: who?.name || staffId,
      empCode: who?.empCode || "",
      reason,
      leaveTypeLabel: l ? typeName.get(String(l.type_code)) || String(l.type_code) : "",
      requestId: l ? String(l.id) : "",
      fromDate: l ? String(l.from_date) : "",
      toDate: l ? String(l.to_date) : "",
      days: l ? Number(l.days) || 0 : 0,
    };
  };

  let present = 0;
  const absentRows: BriefStaffRow[] = [];
  for (const s of staff) {
    const mark = marks.get(s.id);
    if (mark === "P") {
      present++;
      continue;
    }
    if (mark !== "A") continue; // unmarked: neither present nor absent
    const approved = approvedToday.get(s.id);
    if (approved) {
      absentRows.push(rowFor(s.id, approved, "on_leave"));
      continue;
    }
    const pending = pendingToday.get(s.id);
    absentRows.push(
      pending
        ? rowFor(s.id, pending, "leave_pending")
        : rowFor(s.id, undefined, "unexplained"),
    );
  }

  absentRows.sort(
    (a, b) =>
      // The ones needing a decision first; a name is easier to find than a
      // reason, so the reason leads.
      (a.reason === "on_leave" ? 1 : 0) - (b.reason === "on_leave" ? 1 : 0) ||
      a.name.localeCompare(b.name),
  );

  return {
    marked: marks.size > 0,
    present,
    absent: absentRows.length,
    strength: staff.length,
    absentRows,
    pending: pendingAny
      .map((l) => rowFor(String(l.staff_id), l, "leave_pending"))
      .sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.name.localeCompare(b.name)),
  };
}

/* ── 5. Tomorrow's calling list ────────────────────────────────────── */

async function readDefaulters(
  dateIso: string,
  masters: MastersState,
  sis: SisState,
): Promise<BriefDefaulters> {
  const rows = listLiveDefaulters({
    asOf: dateIso,
    academicYearCode: currentAcademicYearCode(masters),
    sis,
    masters,
  }).filter((d) => d.overdueDays > 0 && d.overdueAmountPaise > 0);

  const households = sis.households ?? [];
  const candidates = new Map<string, ReturnType<typeof householdCandidateNumbers>>();
  for (const d of rows) {
    if (candidates.has(d.householdId)) continue;
    candidates.set(
      d.householdId,
      householdCandidateNumbers({
        household: households.find((h) => h.id === d.householdId),
        students: (sis.students ?? []).filter(
          (s) => s.householdId === d.householdId && s.status === "active",
        ),
      }),
    );
  }
  // A number Meta has already refused is no use to somebody dialling it
  // either — it is usually a wrong entry, not a WhatsApp-only problem.
  const knownBad = await listKnownNotOnWhatsApp(
    [...candidates.values()].flat().map((c) => c.mobile10),
  ).catch(() => new Set<string>());

  let noMobile = 0;
  const out = rows.map((d) => {
    const hh = households.find((h) => h.id === d.householdId);
    const choice = pickWaNumbers(candidates.get(d.householdId) ?? [], knownBad);
    const mobile = choice.primary?.mobile10 || "";
    if (!mobile) noMobile++;
    return {
      studentId: d.studentId,
      name: d.fullName,
      fatherName: d.student?.fatherName || "",
      classLabel: d.classLabel,
      duePaise: d.overdueAmountPaise,
      mobile,
      guardianName: hh?.guardianName || "",
    };
  });

  out.sort((a, b) => b.duePaise - a.duePaise || a.name.localeCompare(b.name));
  return {
    rows: out,
    totalPaise: out.reduce((s, r) => s + r.duePaise, 0),
    noMobile,
  };
}

/* ── The brief ─────────────────────────────────────────────────────── */

export async function buildDailyBrief(
  opts: { dateIso?: string; aiNote?: string } = {},
): Promise<DailyBrief> {
  const dateIso = opts.dateIso || istToday();

  await Promise.all([
    ensureSisHydratedServer().catch(() => false),
    ensureFeesHydratedServer().catch(() => false),
  ]);
  const masters = await loadServerMasters();
  const sis = loadSis();

  const [collection, expenses, students, staff, defaulters] = await Promise.all([
    readCollection(dateIso),
    readExpenses(dateIso),
    readStudentAttendance(dateIso, masters, sis),
    readStaffAttendance(dateIso, masters),
    readDefaulters(dateIso, masters, sis),
  ]);

  return {
    ...emptyBrief(dateIso, TENANT.nameDisplay),
    collection,
    expenses,
    students,
    staff,
    defaulters,
    aiNote: opts.aiNote || "",
  };
}
