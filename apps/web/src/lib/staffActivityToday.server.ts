/**
 * Collects today's staff activities from the desks and the audit log
 * (lib/staffActivityToday says what each source contributes).
 */

import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { loadAttendance, todayIso } from "@/lib/attendance";
import { ensureHomeworkHydratedServer } from "@/lib/homeworkPersistence";
import { loadHomework } from "@/lib/homework";
import { ensurePaymentsHydratedServer } from "@/lib/paymentsPersistence";
import { loadFees } from "@/lib/fees";
import { ensureStaffAttendanceHydratedServer } from "@/lib/staffAttendancePersistence";
import { loadStaffAttendance } from "@/lib/staffAttendance";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { MastersState } from "@/lib/masters";
import {
  auditActivity,
  buildStaffActivityToday,
  schoolDate,
  type StaffActivityEvent,
} from "@/lib/staffActivityToday";

/** Today's audit rows, or null when the log could not be read. */
async function readAuditToday(today: string): Promise<StaffActivityEvent[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  // School day in UTC: 00:00 IST is 18:30 the previous day.
  const since = new Date(Date.parse(`${today}T00:00:00+05:30`)).toISOString();
  const until = new Date(Date.parse(`${today}T00:00:00+05:30`) + 86_400_000).toISOString();
  const { data, error } = await ctx.sb
    .from("audit_events")
    .select("actor_name, module, action, entity_type, summary, created_at")
    .eq("tenant_id", ctx.tenantId)
    .in("module", ["exams", "students", "fees", "staff", "student_leave"])
    .gte("created_at", since)
    .lt("created_at", until)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) {
    console.warn("[staff activity] audit read failed", error.message);
    return null;
  }
  const out: StaffActivityEvent[] = [];
  for (const r of (data ?? []) as {
    actor_name: string | null;
    module: string;
    action: string;
    entity_type: string | null;
    summary: string | null;
    created_at: string;
  }[]) {
    const a = auditActivity({
      module: r.module,
      action: r.action,
      entityType: r.entity_type || "",
      summary: r.summary || "",
    });
    if (!a || !r.actor_name) continue;
    out.push({ actorName: r.actor_name, kind: a.kind, at: r.created_at, qty: a.qty });
  }
  return out;
}

export async function collectStaffActivityToday(masters: MastersState, ay: string) {
  const today = todayIso();
  await Promise.all([
    ensureStaffAttendanceHydratedServer(),
    ensureAttendanceHydratedServer(),
    ensureHomeworkHydratedServer().catch(() => false),
    ensurePaymentsHydratedServer(),
  ]);
  const events: StaffActivityEvent[] = [];

  // Punches — the in and out times on today's staff register.
  const staffReg = (loadStaffAttendance().registers ?? []).find(
    (r) => r.date === today && r.academicYearCode === ay,
  );
  for (const m of staffReg?.marks ?? []) {
    if (m.inTime) events.push({ staffId: m.staffId, kind: "punch_in", at: m.inTime });
    if (m.outTime) events.push({ staffId: m.staffId, kind: "punch_out", at: m.outTime });
  }

  // Student registers marked today, by the name that marked them.
  const sectionLabel = (classId: string, sectionId: string) => {
    const c = masters.classes.find((x) => x.id === classId)?.name || "";
    const s = masters.sections.find((x) => x.id === sectionId)?.name || "";
    return `${c} ${s}`.trim();
  };
  for (const r of loadAttendance().registers ?? []) {
    if (r.date !== today || r.academicYearCode !== ay || !r.markedBy) continue;
    events.push({
      actorName: r.markedBy,
      kind: "attendance_register",
      at: r.markedAt || "",
      detail: sectionLabel(r.classId, r.sectionId),
    });
  }

  // Homework posted today.
  for (const p of loadHomework().posts ?? []) {
    if (p.status !== "published" || schoolDate(p.createdAt) !== today) continue;
    events.push({
      staffId: p.teacherStaffId || undefined,
      actorName: p.teacherStaffId ? undefined : p.teacherName,
      kind: "homework",
      at: p.createdAt,
      detail: [sectionLabel(p.classId, p.sectionId), p.title].filter(Boolean).join(" · "),
    });
  }

  // Fee receipts taken today, by cashier.
  for (const v of loadFees().vouchers) {
    if (v.voidedAt || v.collectionDate !== today) continue;
    events.push({
      actorName: v.cashierName,
      kind: "fee_receipts",
      at: v.collectedAt || "",
      qty: v.totalPaise,
    });
  }

  const audit = await readAuditToday(today);
  if (audit) events.push(...audit);

  const built = buildStaffActivityToday({
    staff: masters.staff ?? [],
    designations: masters.designations ?? [],
    events,
  });
  return {
    date: today,
    /** false = the audit log could not be read: marks entry and the rest are missing, not zero. */
    auditKnown: !!audit,
    staff: built.rows.map((r) => ({
      ...r,
      status: staffReg?.marks.find((m) => m.staffId === r.staffId)?.status || "",
    })),
  };
}
