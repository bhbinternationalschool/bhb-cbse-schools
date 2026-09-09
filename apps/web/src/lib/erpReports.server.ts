/**
 * PDF reports on command — the data half. Builds a ReportTable for each
 * kind from the school's records, scoped to the sections the asker may see,
 * and stores a rendered PDF where the app can fetch it. Pure formatters and
 * parsing live in erpReports.ts; rendering in reportPdf.server.ts.
 */
import "server-only";
import type { DemoSession } from "@/lib/auth";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { loadAttendance } from "@/lib/attendance";
import type { ChatSectionRef } from "@/lib/erpChatAccess";
import {
  admissionsTable,
  attendanceRegisterTable,
  classListTable,
  collectionTable,
  defaultersTable,
  maskMobile,
  type ErpReportKind,
  type ReportTable,
} from "@/lib/erpReports";
import { resolvePeriodRange, type ErpAskPeriod } from "@/lib/erpAsk";
import { ensureFeesHydratedServer } from "@/lib/feesPersistence.server";
import { loadFees, tenderModeLabel } from "@/lib/fees";
import { classLabel } from "@/lib/homework";
import type { MastersState } from "@/lib/masters";
import { privateMediaUrl, sanitizeMediaPath } from "@/lib/media";
import { listLiveDefaulters } from "@/lib/playbook";
import { getServerTenantContext } from "@/lib/serverTenant";
import { householdWhatsApp, loadSis } from "@/lib/sis";

export type ReportScope = {
  /** Sections the report is limited to; empty = whole school (office). */
  sections: ChatSectionRef[];
  label: string;
};

export type BuildReportInput = {
  kind: ErpReportKind;
  session: DemoSession;
  masters: MastersState;
  todayIso: string;
  scope: ReportScope;
  /** For register / collection on a day. */
  date?: string;
  /** For collection / admissions over a period. */
  period?: ErpAskPeriod;
};

export async function buildErpReport(input: BuildReportInput): Promise<ReportTable> {
  const { kind, session, masters, todayIso, scope } = input;
  const ay = session.academicYearCode;
  const sectionIds = new Set(scope.sections.map((s) => s.sectionId));
  const inScope = (sectionId: string) => sectionIds.size === 0 || sectionIds.has(sectionId);

  if (kind === "defaulters") {
    await ensureFeesHydratedServer();
    const sis = loadSis();
    const rows = listLiveDefaulters({ academicYearCode: ay, asOf: todayIso, sis, masters })
      .filter((r) => inScope(r.student.sectionId))
      .map((r) => ({
        name: r.fullName,
        admissionNo: r.admissionNo,
        classLabel: r.classLabel,
        overdueDays: r.overdueDays,
        overdueAmountPaise: r.overdueAmountPaise,
        earliestDueOn: r.earliestDueOn,
        planCode: r.planCode,
        mobileMasked: maskMobile(householdWhatsApp(sis.households.find((h) => h.id === r.householdId))),
      }));
    return { ...defaultersTable({ scopeLabel: scope.label, todayIso, rows }) };
  }

  if (kind === "collection") {
    await ensureFeesHydratedServer();
    const sis = loadSis();
    const range = input.period ? resolvePeriodRange(input.period, todayIso) : { from: input.date || todayIso, to: input.date || todayIso, label: input.date && input.date !== todayIso ? input.date : "today" };
    const live = (loadFees().vouchers ?? []).filter((v) => !v.voidedAt && (!v.academicYearCode || v.academicYearCode === ay) && v.collectionDate >= range.from && v.collectionDate <= range.to);
    const rows = live.map((v) => {
      const names = [...new Set(v.lines.map((l) => l.studentName).filter(Boolean))];
      const first = sis.students.find((s) => s.id === v.lines[0]?.studentId);
      const modes = [...new Set((v.tenders ?? []).map((t) => (t.gatewayProvider ? "Online" : tenderModeLabel(t.mode))))];
      return {
        receiptNo: v.receiptNo,
        date: v.collectionDate,
        student: names.join(", ") || "—",
        classLabel: first ? classLabel(masters, first.classId, first.sectionId) : "—",
        mode: modes.join("+") || "—",
        amountPaise: v.totalPaise,
        cashier: v.cashierName || "—",
      };
    });
    return collectionTable({ rangeLabel: range.label, from: range.from, to: range.to, rows });
  }

  if (kind === "attendance_register") {
    await ensureAttendanceHydratedServer();
    const sis = loadSis();
    const section = scope.sections[0]!;
    const date = input.date || todayIso;
    const reg = loadAttendance().registers.find((r) => r.sectionId === section.sectionId && r.date === date && r.academicYearCode === ay);
    const marks = new Map((reg?.marks ?? []).map((m) => [m.studentId, m]));
    const rows = sis.students
      .filter((s) => s.status === "active" && s.sectionId === section.sectionId && (!s.academicYearCode || s.academicYearCode === ay))
      .map((s) => ({ rollNo: s.rollNo, name: s.fullName, status: marks.get(s.id)?.status ?? null, note: marks.get(s.id)?.note ?? "" }));
    return attendanceRegisterTable({ sectionLabel: section.label, date, markedBy: reg?.markedBy ?? "", rows });
  }

  if (kind === "class_list") {
    const sis = loadSis();
    const rows = sis.students
      .filter((s) => s.status === "active" && (!s.academicYearCode || s.academicYearCode === ay) && inScope(s.sectionId))
      .map((s) => ({
        rollNo: s.rollNo,
        name: s.fullName,
        admissionNo: s.admissionNo,
        classLabel: classLabel(masters, s.classId, s.sectionId),
        fatherName: s.fatherName || sis.households.find((h) => h.id === s.householdId)?.guardianName || "—",
        mobileMasked: maskMobile(householdWhatsApp(sis.households.find((h) => h.id === s.householdId))),
      }));
    return classListTable({ scopeLabel: scope.label, rows });
  }

  // admissions
  const { ensureAdmissionsHydratedServer } = await import("@/lib/admissionsPersistence");
  const { loadAdmissions, sourceLabel, stageLabel } = await import("@/lib/admissions");
  await ensureAdmissionsHydratedServer();
  const range = resolvePeriodRange(input.period ?? "this_week", todayIso);
  const leads = loadAdmissions().leads.filter((l) => {
    const d = (l.createdAt || "").slice(0, 10);
    return d >= range.from && d <= range.to;
  });
  const rows = leads.map((l) => ({
    enquiryNo: l.enquiryNo || l.applicationNo || "—",
    date: (l.createdAt || "").slice(0, 10),
    childName: l.childName || "—",
    classSought: l.classSoughtId ? classLabel(masters, l.classSoughtId, "") || l.classSoughtId : "—",
    guardianName: l.guardianName || "—",
    mobileMasked: maskMobile(l.mobile),
    source: sourceLabel(l.source),
    stage: stageLabel(l.stage),
  }));
  return admissionsTable({ rangeLabel: range.label.replace(" (from Monday)", ""), from: range.from, to: range.to, rows });
}

/**
 * Keep a rendered PDF in the private files bucket and return the app URL
 * that serves it (staff-authenticated, never expires). Reports live under
 * reports/<yyyy-mm>/ so the bucket stays browsable.
 */
export async function storeReportPdf(bytes: Buffer, filename: string, atIso: string): Promise<{ ok: true; url: string; path: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Storage is not configured" };
  const path = sanitizeMediaPath(`reports/${atIso.slice(0, 7)}/${atIso.replace(/[-:T]/g, "").slice(0, 14)}-${filename}`);
  const { error } = await ctx.sb.storage.from("school-files").upload(path, bytes, { contentType: "application/pdf", upsert: true, cacheControl: "3600" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, url: privateMediaUrl(path), path };
}
