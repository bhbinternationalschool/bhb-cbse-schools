/**
 * Live leadership / desk stats for WhatsApp REPORTS (server-only).
 */

import {
  followUpCounts,
  funnelCounts,
  loadAdmissions,
  type AdmissionStage,
} from "@/lib/admissions";
import { totalBankBalancePaise } from "@/lib/accountsCashBank";
import { loadAccounts } from "@/lib/accountsStore";
import { loadAttendance, summarizeMarks } from "@/lib/attendance";
import { computeFeeKpis } from "@/lib/feeFinance";
import { formatInr, loadFees } from "@/lib/fees";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";
import { loadStaffAttendance, summarizeStaffMarks } from "@/lib/staffAttendance";
import { listLowStockItems, loadStore } from "@/lib/store";
import { loadTransport } from "@/lib/transport";
import { TENANT } from "@/lib/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Compact WhatsApp report for director / leadership. */
export function composeLeadershipWhatsAppReport(): string {
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
    const sm = summarizeStaffMarks(staffReg.marks || []);
    staffPresent = sm.present;
    staffMarked = sm.present + sm.absent + sm.leave;
  }
  const staffPct = staffMarked
    ? Math.round((staffPresent / staffMarked) * 100)
    : 0;

  const activeStaff = (masters.staff ?? []).filter((s) => s.status === "active")
    .length;
  const bankBal = totalBankBalancePaise(loadAccounts());
  const lowStock = listLowStockItems(loadStore()).length;
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
    `*Store* — ${lowStock} low-stock SKUs`,
    `*Bank* — ${formatInr(bankBal)}`,
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
  const sm = summarizeStaffMarks(reg.marks || []);
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
