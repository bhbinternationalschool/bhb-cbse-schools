/**
 * Live leadership / desk stats for WhatsApp REPORTS (server-only).
 */

import {
  followUpCounts,
  funnelCounts,
  loadAdmissions,
  type AdmissionStage,
} from "@/lib/admissions";
import { loadAttendance, summarizeMarks } from "@/lib/attendance";
import { computeFeeKpis } from "@/lib/feeFinance";
import { formatInr, loadFees } from "@/lib/fees";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";
import { loadStaffAttendance, staffMarkTotals } from "@/lib/staffAttendance";
import { loadTransport } from "@/lib/transport";
import { TENANT } from "@/lib/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Compact WhatsApp report for director / leadership. */
/**
 * Low stock is an optional input, not a value this function fetches.
 *
 * The store's on-hand figures now live server-side and are read
 * asynchronously, and this composer is synchronous with synchronous callers
 * all the way up. Rather than make the whole chain async for one line — or
 * print "0 low-stock SKUs" when the truth is "not looked up", which is the
 * defect class this rebuild exists to remove — the line is simply omitted
 * unless a caller supplies the number.
 */
/**
 * The bank balance this report may print.
 *
 * Read from the server book, never from the accounts desk. `loadAccounts()`
 * returns EMPTY on the server, so `totalBankBalancePaise` off it reported a
 * flat ₹0 here — a wrong number sent to the director's phone every time, and
 * fed to the ERP assistant as fact. See dailyBrief.server.ts, which documents
 * the same trap for the rest of this file's inputs.
 */
export async function leadershipBankBalancePaise(): Promise<number | null> {
  const today = todayIso();
  const d = new Date(today);
  const fyFrom = `${d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1}-04-01`;
  const { ledgerPosition } = await import("@/lib/ledger/controls.server");
  const pos = await ledgerPosition({ asOf: today, fyFrom });
  // Unknown is not zero: a failed read prints no Bank line at all.
  return pos.ok ? pos.bankPaise : null;
}

export function composeLeadershipWhatsAppReport(
  opts: { lowStockSkus?: number; bankBalancePaise?: number | null } = {},
): string {
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const today = todayIso();

  const sis = loadSis();
  const sessionStudents = sis.students.filter(
    (s) => !ay || s.academicYearCode === ay,
  );
  const activeStudents = sessionStudents.filter((s) => s.status === "active");

  const feeKpi = computeFeeKpis({ academicYearCode: ay });
  const todayFee = loadFees().vouchers.filter(
    (v) => !v.voidedAt && v.collectionDate === today && (!ay || v.academicYearCode === ay),
  );
  const todayFeePaise = todayFee.reduce((s, v) => s + v.totalPaise, 0);

  const adm = loadAdmissions();
  const sessionLeads = adm.leads.filter((l) => !ay || l.academicYearCode === ay);
  const funnel = funnelCounts({ ...adm, leads: sessionLeads });
  const fu = followUpCounts({ ...adm, leads: sessionLeads });
  const pipeline =
    sessionLeads.length - (funnel.enrolled || 0) - (funnel.lost || 0);

  const att = loadAttendance();
  const todayRegs = (att.registers ?? []).filter(
    (r) => r.date === today && (!ay || r.academicYearCode === ay),
  );
  let stuPresent = 0;
  let stuMarked = 0;
  for (const r of todayRegs) {
    const s = summarizeMarks(r.marks || []);
    stuPresent += s.present;
    stuMarked += s.present + s.absent + s.leave;
  }
  const attPct = stuMarked ? Math.round((stuPresent / stuMarked) * 100) : 0;

  const staffAtt = loadStaffAttendance();
  const staffReg = (staffAtt.registers ?? []).find(
    (r) => r.date === today && (!ay || r.academicYearCode === ay),
  );
  let staffPresent = 0;
  let staffMarked = 0;
  if (staffReg) {
    // Was staffMarkTotals(...).present — undefined, so this line read
    // "Present undefined · Absent undefined" in the owner's note.
    const sm = staffMarkTotals(staffReg.marks || []);
    staffPresent = sm.present;
    staffMarked = sm.marked;
  }
  const staffPct = staffMarked
    ? Math.round((staffPresent / staffMarked) * 100)
    : 0;

  const activeStaff = (masters.staff ?? []).filter((s) => s.status === "active")
    .length;
  // Supplied by the caller, and only for someone allowed to see a balance —
  // this report goes to any staff member who types REPORTS. When it is not
  // supplied the line is omitted rather than printed as zero.
  const bankBal =
    typeof opts.bankBalancePaise === "number" && Number.isFinite(opts.bankBalancePaise)
      ? opts.bankBalancePaise
      : null;
  const lowStock = opts.lowStockSkus;
  const transport = loadTransport();
  const activeRoutes = (transport.routes ?? []).filter((r) => r.isActive !== false)
    .length;
  const activeBuses = (transport.vehicles ?? []).filter((v) => v.isActive).length;

  const lines = [
    `*${TENANT.shortName} — live desk*`,
    `Session ${ay} · ${today}`,
    "",
    `*Students* — ${activeStudents.length} active`,
    `*Today attendance* — ${attPct}% (${stuPresent}/${stuMarked || "—"} marked)`,
    `*Staff today* — ${staffPct}% (${staffPresent}/${staffMarked || "—"}) · ${activeStaff} on roster`,
    "",
    `*Fees* — collected ${formatInr(feeKpi.collectedPaise)}`,
    `Open dues ${formatInr(feeKpi.openPaise)} · today ${formatInr(todayFeePaise)}`,
    "",
    `*Admissions* — ${sessionLeads.length} leads · pipeline ${pipeline}`,
    `Enrolled ${funnel.enrolled || 0} · follow-ups due ${fu.overdue || 0}`,
    "",
    `*Transport* — ${activeRoutes} routes · ${activeBuses} buses`,
    ...(typeof lowStock === "number"
      ? [`*Store* — ${lowStock} low-stock SKUs`]
      : []),
    ...(bankBal === null ? [] : [`*Bank* — ${formatInr(bankBal)}`]),
    "",
    "Reply *FEE* · *ADMISSIONS* · *STAFF* · *MENU*",
  ];
  return lines.join("\n");
}

export function composeFeeWhatsAppSnapshot(): string {
  const ay = currentAcademicYearCode(loadMasters());
  const kpi = computeFeeKpis({ academicYearCode: ay });
  const today = todayIso();
  const todayPaise = loadFees().vouchers
    .filter(
      (v) =>
        !v.voidedAt &&
        v.collectionDate === today &&
        (!ay || v.academicYearCode === ay),
    )
    .reduce((s, v) => s + v.totalPaise, 0);
  return [
    `*Fees snapshot* — ${today}`,
    `Collected (session): ${formatInr(kpi.collectedPaise)}`,
    `Open dues: ${formatInr(kpi.openPaise)}`,
    `Arrears: ${formatInr(kpi.arrearsPaise)}`,
    `Today collected: ${formatInr(todayPaise)}`,
    "",
    "Desk: Fees → Take / Defaulters",
  ].join("\n");
}

export function composeStaffAttendanceWhatsAppSnapshot(): string {
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const today = todayIso();
  const staffAtt = loadStaffAttendance();
  const reg = (staffAtt.registers ?? []).find(
    (r) => r.date === today && (!ay || r.academicYearCode === ay),
  );
  if (!reg) {
    return `*Staff attendance* — ${today}\n\nNo register marked yet today. Desk: Attendance → Staff.`;
  }
  const sm = staffMarkTotals(reg.marks || []);
  const total = sm.present + sm.absent + sm.leave;
  return [
    `*Staff attendance* — ${today}`,
    `Present ${sm.present} · Absent ${sm.absent} · Leave ${sm.leave}`,
    total ? `Rate ${Math.round((sm.present / total) * 100)}%` : "",
    "",
    "Desk: Attendance → Staff register",
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeAdmissionsWhatsAppSnapshot(): string {
  const ay = currentAcademicYearCode(loadMasters());
  const adm = loadAdmissions();
  const leads = adm.leads.filter((l) => !ay || l.academicYearCode === ay);
  const funnel = funnelCounts({ ...adm, leads });
  const fu = followUpCounts({ ...adm, leads });
  const stages = (["enquiry", "visit", "registered", "enrolled"] as AdmissionStage[])
    .map((s) => `${s}: ${funnel[s] || 0}`)
    .join(" · ");
  return [
    `*Admissions CRM* — session ${ay}`,
    `Leads ${leads.length} · ${stages}`,
    `Follow-ups overdue: ${fu.overdue || 0} · due today: ${fu.dueToday || 0}`,
    "",
    "Desk: Admissions → Lead details / CRM chat",
  ].join("\n");
}
