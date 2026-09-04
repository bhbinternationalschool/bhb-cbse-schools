/**
 * Parents ↔ teachers through the school: who a child's teachers are, and
 * the relay of a parent's message to one of them within the school's
 * hours. Delivery to the teacher is three-fold and best-effort — the
 * message is stored, the teacher's staff app is pushed, and a WhatsApp
 * text is sent from the school's number (which Meta only allows inside a
 * 24-hour session; outside it the push and the app carry it). Class
 * teachers additionally see the message in the existing in-app chat.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { loadMasters, type MastersState } from "@/lib/masters";
import { classLabelForStudent } from "@/lib/parentPortal";
import { getServerTenantContext } from "@/lib/serverTenant";
import { householdWhatsApp, loadSis, type Household, type SisStudent } from "@/lib/sis";
import { resolveClassTeachers } from "@/lib/staffResolve";
import {
  buildTeacherForwardText,
  teacherHoursOpen,
  type TeacherContact,
} from "@/lib/teacherContact";
import { findGrid, loadTimetable } from "@/lib/timetable";
import { buildWaTemplateBodyComponent, sendWhatsAppTemplate, sendWhatsAppText } from "@/lib/waSend";
import { listApprovedTemplates, loadWaTemplates } from "@/lib/waTemplates";
import { ensureWaTemplatesHydrated } from "@/lib/waTemplatesPersistence";
import { sendPushToSubjects } from "@/lib/webPush.server";

/** Class teacher(s) first, then every teacher on the section's timetable. */
export function teacherContactsFor(student: SisStudent, masters: MastersState = loadMasters()): TeacherContact[] {
  const out: TeacherContact[] = [];
  const seen = new Set<string>();
  for (const t of resolveClassTeachers(masters, student.classId, student.sectionId, student.academicYearCode)) {
    seen.add(t.id);
    out.push({ staffId: t.id, name: t.fullName, role: "Class teacher", isClassTeacher: true, subjects: [] });
  }
  const grid = findGrid(student.academicYearCode, student.classId, student.sectionId, loadTimetable());
  const bySubject = new Map<string, Set<string>>();
  for (const slot of grid?.slots ?? []) {
    if (!slot.teacherId || !slot.subjectId) continue;
    if (!bySubject.has(slot.teacherId)) bySubject.set(slot.teacherId, new Set());
    bySubject.get(slot.teacherId)!.add(slot.subjectId);
  }
  for (const [teacherId, subjectIds] of bySubject) {
    const staff = (masters.staff ?? []).find((s) => s.id === teacherId && s.status === "active");
    if (!staff) continue;
    const subjects = [...subjectIds]
      .map((id) => masters.subjects.find((s) => s.id === id)?.nameEn ?? "")
      .filter(Boolean)
      .sort();
    if (seen.has(teacherId)) {
      const existing = out.find((c) => c.staffId === teacherId)!;
      existing.subjects = subjects;
      continue;
    }
    seen.add(teacherId);
    out.push({ staffId: teacherId, name: staff.fullName, role: subjects.join(", ") || "Teacher", isClassTeacher: false, subjects });
  }
  return out;
}

export type RelayInput = {
  household: Household;
  student: SisStudent;
  staffId: string;
  body: string;
  channel: "whatsapp" | "app";
};

export type RelayResult =
  | { ok: true; id: string; teacherName: string; delivered: boolean; via: string }
  | { ok: false; error: string };

/** Store, then deliver now if the window is open; otherwise hold for the morning tick. */
export async function relayTeacherMessage(input: RelayInput): Promise<RelayResult> {
  const masters = loadMasters();
  const contact = teacherContactsFor(input.student, masters).find((c) => c.staffId === input.staffId);
  if (!contact) return { ok: false, error: "That teacher does not teach this child" };
  const body = input.body.trim().slice(0, 2000);
  if (!body) return { ok: false, error: "Empty message" };

  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const id = `tm_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const { error } = await ctx.sb.from("teacher_messages").insert({
    id,
    tenant_id: ctx.tenantId,
    household_id: input.household.id,
    student_id: input.student.id,
    staff_id: contact.staffId,
    staff_name: contact.name,
    subject: contact.role,
    body,
    channel: input.channel,
  });
  if (error) return { ok: false, error: error.message };

  // The class teacher's in-app thread carries it too, so it sits with the
  // rest of that conversation and shows as unread in the staff app.
  if (contact.isClassTeacher) {
    await ctx.sb.from("chat_messages").insert({
      tenant_id: ctx.tenantId,
      student_id: input.student.id,
      sender_persona: "parent",
      sender_id: input.household.id,
      sender_name: input.household.guardianName || "Parent",
      body: input.channel === "whatsapp" ? `(via WhatsApp) ${body}` : body,
      read_by_parent_at: new Date().toISOString(),
    });
  }

  if (!teacherHoursOpen()) {
    return { ok: true, id, teacherName: contact.name, delivered: false, via: "held" };
  }
  const via = await deliverToTeacher({ id, staffId: contact.staffId, student: input.student, household: input.household, body, heldSince: null }, masters);
  return { ok: true, id, teacherName: contact.name, delivered: via !== "failed", via };
}

async function deliverToTeacher(
  m: { id: string; staffId: string; student: SisStudent; household: Household; body: string; heldSince: string | null },
  masters: MastersState,
): Promise<string> {
  const staff = (masters.staff ?? []).find((s) => s.id === m.staffId);
  const classLabel = classLabelForStudent(m.student, masters);
  const text = buildTeacherForwardText({
    childName: m.student.fullName,
    classLabel,
    guardianName: m.household.guardianName || "",
    guardianMobile: householdWhatsApp(m.household) || m.household.mobile || "",
    message: m.body,
    heldSince: m.heldSince,
  });
  const via: string[] = [];
  const push = await sendPushToSubjects("staff", [m.staffId], {
    title: `Parent of ${m.student.fullName} (${classLabel})`,
    body: m.body.length > 120 ? `${m.body.slice(0, 117)}…` : m.body,
    url: `/chat?studentId=${encodeURIComponent(m.student.id)}`,
    data: { kind: "teacher_message", studentId: m.student.id },
  }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
  if (push.sent > 0) via.push("push");
  if (staff?.mobile) {
    // The approved "teacher_message" template reaches a teacher at any time;
    // free text only inside Meta's 24h session with the school's number.
    let wa: { ok: boolean } = { ok: false };
    const tpl = await approvedTeacherTemplate();
    if (tpl) {
      wa = await sendWhatsAppTemplate({
        toMobile: staff.mobile,
        name: tpl.metaName,
        language: tpl.metaLanguage || tpl.language,
        components: [
          buildWaTemplateBodyComponent(tpl.variables, {
            staffName: staff.fullName,
            childName: m.student.fullName,
            classLabel,
            guardianName: m.household.guardianName || "Parent",
            messageText: m.body,
          }),
        ],
        clientMessageId: m.id,
      }).catch(() => ({ ok: false }));
      if (wa.ok) via.push("whatsapp-template");
    }
    if (!wa.ok) {
      wa = await sendWhatsAppText({ toMobile: staff.mobile, body: text, clientMessageId: m.id }).catch(() => ({ ok: false }));
      if (wa.ok) via.push("whatsapp");
    }
  }
  const ctx = await getServerTenantContext();
  const delivered = via.length > 0;
  if (ctx) {
    await ctx.sb
      .from("teacher_messages")
      .update({
        status: delivered ? "delivered" : "failed",
        delivered_via: via.join("+"),
        delivered_at: delivered ? new Date().toISOString() : null,
        error: delivered ? "" : "no push subscription and WhatsApp outside session window",
      })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", m.id);
  }
  return delivered ? via.join("+") : "failed";
}

/** The morning tick: deliver what was held overnight. No-op outside hours. */
export async function flushHeldTeacherMessages(): Promise<{ delivered: number; failed: number; skipped: boolean }> {
  if (!teacherHoursOpen()) return { delivered: 0, failed: 0, skipped: true };
  const ctx = await getServerTenantContext();
  if (!ctx) return { delivered: 0, failed: 0, skipped: true };
  const { data } = await ctx.sb
    .from("teacher_messages")
    .select("id, household_id, student_id, staff_id, body, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  const rows = (data ?? []) as { id: string; household_id: string; student_id: string; staff_id: string; body: string; created_at: string }[];
  if (!rows.length) return { delivered: 0, failed: 0, skipped: false };
  const sis = loadSis();
  const masters = loadMasters();
  let delivered = 0;
  let failed = 0;
  for (const r of rows) {
    const student = sis.students.find((s) => s.id === r.student_id);
    const household = sis.households.find((h) => h.id === r.household_id);
    if (!student || !household) {
      failed += 1;
      await ctx.sb.from("teacher_messages").update({ status: "failed", error: "student or household no longer found" }).eq("tenant_id", ctx.tenantId).eq("id", r.id);
      continue;
    }
    const via = await deliverToTeacher({ id: r.id, staffId: r.staff_id, student, household, body: r.body, heldSince: r.created_at }, masters);
    if (via === "failed") failed += 1;
    else delivered += 1;
  }
  return { delivered, failed, skipped: false };
}

/** The approved "teacher_message" template, English first, if Meta has approved one. */
async function approvedTeacherTemplate() {
  try {
    await ensureWaTemplatesHydrated();
  } catch {
    /* fall through to whatever is cached locally */
  }
  const approved = listApprovedTemplates(loadWaTemplates()).filter((t) => t.familyKey === "teacher_message");
  return approved.find((t) => t.language === "en") ?? approved[0] ?? null;
}
