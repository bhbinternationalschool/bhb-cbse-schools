/**
 * Principal cockpit snapshot — server aggregates for /api/v1/principal/snapshot.
 */

import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { ensureStaffAttendanceHydratedServer } from "@/lib/staffAttendancePersistence";
import { ensureExamsHydratedServer } from "@/lib/examsPersistence";
import { ensureAdmissionsHydratedServer } from "@/lib/admissionsPersistence";
import { ensurePaymentsHydratedServer } from "@/lib/paymentsPersistence";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadAdmissions, funnelCounts } from "@/lib/admissions";
import { loadAttendance, summarizeMarks, todayIso } from "@/lib/attendance";
import { computeFeeKpis } from "@/lib/feeFinance";
import { loadFees } from "@/lib/fees";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { loadStaffAttendance, summarizeStaffMarks } from "@/lib/staffAttendance";
import { loadVault } from "@/lib/vault";
import { listLowStockItems, loadStore } from "@/lib/store";

export type PrincipalSnapshot = {
  generatedAt: string;
  academicYearCode: string;
  fees: {
    todayCollectionPaise: number;
    mtdCollectionPaise: number;
    openDuesPaise: number;
    defaulterHouseholds: number;
  };
  attendance: {
    date: string;
    studentPresent: number;
    studentAbsent: number;
    studentLeave: number;
    studentMarkedPct: number;
    sectionsMarked: number;
  };
  staff: {
    activeCount: number;
    presentToday: number;
    absentToday: number;
  };
  admissions: {
    pipeline: number;
    enrolled: number;
    followUpsDue: number;
  };
  alerts: {
    vaultExpiring30d: number;
    lowStockSkus: number;
    attendanceRegistersPending: number;
  };
};

export async function buildPrincipalSnapshot(
  academicYearCode?: string,
): Promise<PrincipalSnapshot> {
  await Promise.all([
    ensureSchoolMirrorHydrated(),
    ensureSisHydratedServer(),
    ensureAdmissionsHydratedServer(),
    ensurePaymentsHydratedServer(),
    ensureExamsHydratedServer(),
    ensureAttendanceHydratedServer(),
    ensureStaffAttendanceHydratedServer(),
  ]);
  const masters = loadMasters();
  const ay = academicYearCode || currentAcademicYearCode(masters);
  const today = todayIso();
  const monthPrefix = today.slice(0, 7);

  const feeKpi = computeFeeKpis({ academicYearCode: ay });
  const vouchers = loadFees().vouchers.filter(
    (v) => !v.voidedAt && v.academicYearCode === ay,
  );
  const todayCollectionPaise = vouchers
    .filter((v) => v.collectionDate === today)
    .reduce((s, v) => s + v.totalPaise, 0);
  const mtdCollectionPaise = vouchers
    .filter((v) => v.collectionDate.startsWith(monthPrefix))
    .reduce((s, v) => s + v.totalPaise, 0);

  const att = loadAttendance();
  const todayRegs = (att.registers ?? []).filter(
    (r) => r.academicYearCode === ay && r.date === today,
  );
  let stuPresent = 0;
  let stuAbsent = 0;
  let stuLeave = 0;
  for (const r of todayRegs) {
    const s = summarizeMarks(r.marks || []);
    stuPresent += s.present;
    stuAbsent += s.absent;
    stuLeave += s.leave;
  }
  const stuMarked = stuPresent + stuAbsent + stuLeave;
  const activeSections = masters.sections.filter((s) => s.isActive).length;
  const attendanceRegistersPending = Math.max(0, activeSections - todayRegs.length);

  const staffAtt = loadStaffAttendance();
  const staffToday = (staffAtt.registers ?? []).find(
    (r) => r.date === today && r.academicYearCode === ay,
  );
  const staffSum = staffToday ? summarizeStaffMarks(staffToday.marks || []) : null;
  const activeStaff = (masters.staff ?? []).filter((s) => s.status === "active").length;

  const adm = loadAdmissions();
  const funnel = funnelCounts(adm);
  const pipeline = Math.max(
    0,
    adm.leads.length - (funnel.enrolled || 0) - (funnel.lost || 0),
  );

  const vault = loadVault();
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const vaultExpiring30d = (vault.documents ?? []).filter((d) => {
    if (!d.expiresOn) return false;
    const exp = new Date(d.expiresOn);
    return exp <= in30 && exp >= new Date();
  }).length;

  return {
    generatedAt: new Date().toISOString(),
    academicYearCode: ay,
    fees: {
      todayCollectionPaise,
      mtdCollectionPaise,
      openDuesPaise: feeKpi.openPaise,
      defaulterHouseholds: feeKpi.studentsWithOpenDues,
    },
    attendance: {
      date: today,
      studentPresent: stuPresent,
      studentAbsent: stuAbsent,
      studentLeave: stuLeave,
      studentMarkedPct: stuMarked
        ? Math.round((stuPresent / stuMarked) * 100)
        : 0,
      sectionsMarked: todayRegs.length,
    },
    staff: {
      activeCount: activeStaff,
      presentToday: staffSum?.present ?? 0,
      absentToday: staffSum?.absent ?? 0,
    },
    admissions: {
      pipeline,
      enrolled: funnel.enrolled || 0,
      followUpsDue: adm.leads.filter(
        (l) => l.nextFollowUpAt && l.nextFollowUpAt.slice(0, 10) <= today,
      ).length,
    },
    alerts: {
      vaultExpiring30d,
      lowStockSkus: listLowStockItems(loadStore()).length,
      attendanceRegistersPending,
    },
  };
}

export function isPrincipalLikeRole(roleCode: string): boolean {
  const rc = (roleCode || "").toLowerCase();
  return /principal|owner|admin|director|hm|head.?master|vice.?principal/.test(rc);
}
