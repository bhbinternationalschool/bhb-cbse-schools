/**
 * The staff reminders' real dependencies (the logic is staffRemindersRun.ts,
 * the rules staffReminders.ts). Every read goes to the table that holds the
 * answer, pages past PostgREST's 1,000-row cap, and reports a failure as a
 * failure — never as "nothing there".
 */
import "server-only";

import { readServerMastersCopy, readServerRbacCopy } from "@/lib/api/v1/auth";
import { readStaffHrServer } from "@/lib/api/v1/staffLeave";
import { readTimetableStateServer } from "@/lib/api/v1/teachingServer.server";
import { readClassCoordinators } from "@/lib/attendanceCover.server";
import { listAllComplaintTickets } from "@/lib/complaintsServer";
import { fetchExamSetupFromDb, fetchExamSheetsForTermStrict } from "@/lib/examsNormalized.server";
import { notify, notifyDeps } from "@/lib/notify/notify.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchSisFromDb, fetchSisFromDbViaIdentitySplit, sisIdentitySplitEnabled } from "@/lib/sisNormalized.server";
import { readStaffTodayExempt } from "@/lib/staffToday.server";
import { readApproverRules } from "@/lib/staffLeaveRules.server";
import { staffRequestsOfSlice } from "@/lib/staffRequests.server";
import { fetchStudentLeaveDeskFromDb } from "@/lib/studentLeaveNormalized.server";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { protectedSuperAdminEmails } from "@/lib/superAdmin";
import { TENANT } from "@/lib/types";
import { fetchServerBlob } from "@/lib/serverBlob";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { normalizeWaTemplatesState, resolveTemplateForSend, templateVariablePositions, type WaTemplatesState } from "@/lib/waTemplates";
import { sendWhatsAppTemplate } from "@/lib/waSend";
import {
  normalizeReminderSettings,
  reminderKey,
  REMINDER_SETTINGS_KEY,
  type ReminderSettings,
} from "@/lib/staffReminders";
import {
  computePendingWork,
  pendingWorkFor,
  readUnanswered,
  runReminderTick,
  type Read,
  type ReminderDeps,
} from "@/lib/staffRemindersRun";

const CHUNK = 150;
const WA_FAMILY = "staff_work_reminder";

function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: typeof error === "string" ? error : ((error as Error)?.message ?? String(error)) };
}

function istDayOf(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + 330 * 60_000).toISOString().slice(0, 10) : "";
}

/* ── Settings ───────────────────────────────────────────────────────────── */

/** null `state` = never saved: the defaults. */
export async function readReminderSettings(): Promise<Read<{ settings: ReminderSettings; updatedAt: string }>> {
  const ctx = await getServerTenantContext();
  if (!ctx) return fail("tenant unavailable");
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", REMINDER_SETTINGS_KEY)
    .maybeSingle();
  if (error) return fail(error.message);
  return {
    ok: true,
    value: { settings: normalizeReminderSettings(data?.state ?? null), updatedAt: data?.updated_at ? String(data.updated_at) : "" },
  };
}

/** Saved only over the copy the editor loaded (`baseUpdatedAt`, "" = never saved). */
export async function writeReminderSettings(
  settings: ReminderSettings,
  baseUpdatedAt: string,
): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string; conflict?: boolean }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const now = new Date().toISOString();
  const state = { ...settings, updatedAt: now };
  if (baseUpdatedAt) {
    const { data, error } = await ctx.sb
      .from("module_local_state")
      .update({ state, updated_at: now })
      .eq("tenant_id", ctx.tenantId)
      .eq("module_key", REMINDER_SETTINGS_KEY)
      .eq("updated_at", baseUpdatedAt)
      .select("updated_at");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, conflict: true, error: "Someone else changed the reminder settings meanwhile — reload and try again." };
    return { ok: true, updatedAt: now };
  }
  const { error } = await ctx.sb
    .from("module_local_state")
    .insert({ tenant_id: ctx.tenantId, module_key: REMINDER_SETTINGS_KEY, state, updated_at: now });
  if (error) {
    return /duplicate|unique/i.test(error.message)
      ? { ok: false, conflict: true, error: "Someone else saved the reminder settings meanwhile — reload and try again." }
      : { ok: false, error: error.message };
  }
  return { ok: true, updatedAt: now };
}

/* ── The reads ──────────────────────────────────────────────────────────── */

async function inChunks<T>(
  ids: string[],
  read: (part: string[]) => Promise<{ rows: T[]; error: string | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await read(ids.slice(i, i + CHUNK));
    if (r.error) return { rows, error: r.error };
    rows.push(...r.rows);
  }
  return { rows, error: null };
}

export const reminderDeps: ReminderDeps = {
  settings: async () => {
    const r = await readReminderSettings();
    return r.ok ? { ok: true, value: r.value.settings } : r;
  },

  school: async () => {
    const [m, r] = await Promise.all([readServerMastersCopy(), readServerRbacCopy()]);
    if (!m.ok) return fail(`masters: ${m.error}`);
    if (m.from === "fallback") return fail("the staff roster could not be read");
    if (!r.ok) return fail(`roles: ${r.error}`);
    return { ok: true, value: { masters: m.value, rbac: r.value.state, superAdminEmails: protectedSuperAdminEmails() } };
  },

  staffMarks: async (date) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return fail("tenant unavailable");
    const regs = await fetchAllPages<{ id: string }>((from, to) =>
      ctx.sb
        .from("staff_attendance_desk_registers")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .eq("attendance_date", date)
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (regs.error) return fail(regs.error);
    const marks = await inChunks(
      regs.rows.map((r) => String(r.id)),
      (part) =>
        fetchAllPages<{ staff_id: string; status: string; in_time: string }>((from, to) =>
          ctx.sb
            .from("staff_attendance_desk_marks")
            .select("id, staff_id, status, in_time")
            .eq("tenant_id", ctx.tenantId)
            .in("register_id", part)
            .order("id", { ascending: true })
            .range(from, to),
        ),
    );
    if (marks.error) return fail(marks.error);
    const out = new Map<string, { status: string; inTime: string }>();
    for (const m of marks.rows) out.set(String(m.staff_id), { status: String(m.status || ""), inTime: String(m.in_time || "") });
    return { ok: true, value: out };
  },

  exempt: async () => {
    const r = await readStaffTodayExempt();
    return r.known ? { ok: true, value: r.ids } : fail("the exempt list or the roles could not be read");
  },

  staffLeave: async () => {
    const hr = await readStaffHrServer();
    return hr.ok ? { ok: true, value: hr.state.leaveRequests ?? [] } : fail("the leave desk could not be read");
  },

  outdoorDuty: async (date) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return fail("tenant unavailable");
    const r = await fetchAllPages<{ staff_id: string; status: string; started_at: string }>((from, to) =>
      ctx.sb
        .from("staff_attendance_desk_outdoor_duty")
        .select("id, staff_id, status, started_at")
        .eq("tenant_id", ctx.tenantId)
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (r.error) return fail(r.error);
    const out = new Set<string>();
    for (const d of r.rows) if (d.status === "active" || istDayOf(String(d.started_at)) === date) out.add(String(d.staff_id));
    return { ok: true, value: out };
  },

  students: async () => {
    const r = sisIdentitySplitEnabled() ? await fetchSisFromDbViaIdentitySplit() : await fetchSisFromDb();
    return r.ok ? { ok: true, value: r.bundle.students } : fail("the student register could not be read");
  },

  registersMarked: async (date) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return fail("tenant unavailable");
    const regs = await fetchAllPages<{ id: string; class_id: string; section_id: string }>((from, to) =>
      ctx.sb
        .from("attendance_desk_registers")
        .select("id, class_id, section_id")
        .eq("tenant_id", ctx.tenantId)
        .eq("attendance_date", date)
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (regs.error) return fail(regs.error);
    // The brief's rule: a register counts as taken once it holds a P or an A.
    const marks = await inChunks(
      regs.rows.map((r) => String(r.id)),
      (part) =>
        fetchAllPages<{ register_id: string }>((from, to) =>
          ctx.sb
            .from("attendance_desk_marks")
            .select("id, register_id")
            .eq("tenant_id", ctx.tenantId)
            .in("register_id", part)
            .in("status", ["P", "A"])
            .order("id", { ascending: true })
            .range(from, to),
        ),
    );
    if (marks.error) return fail(marks.error);
    const withMarks = new Set(marks.rows.map((m) => String(m.register_id)));
    const out = new Set<string>();
    for (const r of regs.rows) if (withMarks.has(String(r.id))) out.add(`${r.class_id}:${r.section_id}`);
    return { ok: true, value: out };
  },

  timetable: async () => {
    try {
      return { ok: true, value: await readTimetableStateServer() };
    } catch (e) {
      return fail(e);
    }
  },

  coordinators: async () => {
    const r = await readClassCoordinators();
    return r ? { ok: true, value: r.state } : fail("the co-ordinators could not be read");
  },

  homeworkPosts: async (date) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return fail("tenant unavailable");
    const r = await fetchAllPages<{ class_id: string; section_id: string; subject_id: string; status: string }>((from, to) =>
      ctx.sb
        .from("homework_desk_posts")
        .select("id, class_id, section_id, subject_id, status")
        .eq("tenant_id", ctx.tenantId)
        .eq("post_date", date)
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (r.error) return fail(r.error);
    return {
      ok: true,
      value: r.rows
        .filter((p) => String(p.status) !== "withdrawn")
        .map((p) => ({ classId: String(p.class_id || ""), sectionId: String(p.section_id || ""), subjectId: String(p.subject_id || "") })),
    };
  },

  examSetup: async () => {
    const r = await fetchExamSetupFromDb();
    return r.ok ? { ok: true, value: r.bundle } : fail("the exams setup could not be read");
  },

  examSheets: async (ay, termId) => {
    const r = await fetchExamSheetsForTermStrict(ay, termId);
    return r.ok ? { ok: true, value: r.sheets } : fail(r.error);
  },

  approverRules: () => readApproverRules(),

  studentLeave: async () => {
    const r = await fetchStudentLeaveDeskFromDb();
    return r.ok ? { ok: true, value: r.bundle.requests } : fail("parents' leave requests could not be read");
  },

  complaints: async () => {
    const r = await listAllComplaintTickets().catch(() => null);
    return r ? { ok: true, value: r } : fail("complaints could not be read");
  },

  staffRequests: async () => {
    const ctx = await getServerTenantContext();
    if (!ctx) return fail("tenant unavailable");
    const { data, error } = await ctx.sb
      .from("staff_hr_desk_slices")
      .select("payload")
      .eq("tenant_id", ctx.tenantId)
      .eq("slice_key", "staffRequests")
      .maybeSingle();
    if (error) return fail(error.message);
    try {
      return { ok: true, value: staffRequestsOfSlice((data as { payload?: unknown } | null)?.payload ?? null) };
    } catch (e) {
      return fail(e);
    }
  },

  reminded: async (rule, date) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return fail("tenant unavailable");
    const r = await fetchAllPages<{ recipient_id: string }>((from, to) =>
      ctx.sb
        .from("erp_notification_keys")
        .select("recipient_id")
        .eq("tenant_id", ctx.tenantId)
        .eq("recipient_type", "staff")
        .eq("dedupe_key", reminderKey(rule, date))
        .order("recipient_id", { ascending: true })
        .range(from, to),
    );
    if (r.error) return fail(r.error);
    return { ok: true, value: new Set(r.rows.map((x) => String(x.recipient_id))) };
  },

  devices: async (staff) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return fail("tenant unavailable");
    // A device registers under the roster id, or the login email for a login with no roster link.
    const owner = new Map<string, string>();
    for (const s of staff) {
      owner.set(s.id, s.id);
      const email = (s.email || "").trim().toLowerCase();
      if (email) owner.set(email, s.id);
    }
    const r = await inChunks([...owner.keys()], (part) =>
      fetchAllPages<{ subject_id: string; last_seen_at: string }>((from, to) =>
        ctx.sb
          .from("push_device_tokens")
          .select("id, subject_id, last_seen_at")
          .eq("tenant_id", ctx.tenantId)
          .eq("subject_type", "staff")
          .in("subject_id", part)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
    if (r.error) return fail(r.error);
    const out = new Map<string, string[]>();
    for (const d of r.rows) {
      const id = owner.get(String(d.subject_id));
      if (!id) continue;
      out.set(id, [...(out.get(id) ?? []), String(d.last_seen_at || "")]);
    }
    return { ok: true, value: out };
  },

  prefs: async (staffIds) => {
    // Keyed "staff:<id>", as notify keys them (recipientKey).
    return notifyDeps.prefsFor(staffIds.map((id) => ({ type: "staff" as const, id })));
  },

  notify: (ev) => notify(ev),

  whatsapp: async (p) => {
    const { state: raw } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
    const templates = normalizeWaTemplatesState(raw);
    const language = waTemplateLanguageFor({});
    const resolved = resolveTemplateForSend({ state: templates, familyKey: WA_FAMILY, language });
    // Not approved on Meta (both languages) = no message. Never free text:
    // a business-initiated message outside the 24-hour window is a template
    // or nothing.
    if (!resolved.ok) return { ok: false, error: resolved.reason };
    const values = { staffName: p.name, schoolName: TENANT.nameDisplay, pendingWork: language === "hi" ? p.line.hi : p.line.en };
    const positions = templateVariablePositions(resolved.template, values);
    const res = await sendWhatsAppTemplate({
      toMobile: p.mobile,
      name: resolved.template.metaName,
      language: resolved.template.metaLanguage || resolved.template.language,
      fromPhoneNumberId: resolved.sender?.phoneNumberId,
      components: [
        {
          type: "body",
          parameters: Object.keys(positions)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => ({ type: "text", text: positions[k]! })),
        },
      ],
      clientMessageId: `staffremind:${p.rule}:${p.date}:${p.staffId}`,
    });
    return res.ok ? { ok: true } : { ok: false, error: res.error || "send failed" };
  },

  now: () => Date.now(),
  log: (msg) => console.warn(msg),
};

export const computeStaffPendingWork = (date: string) => computePendingWork(reminderDeps, { date });
export const staffPendingWorkFor = (staffId: string, date: string) => pendingWorkFor(reminderDeps, staffId, date);
export const runStaffReminderTick = (opts: Parameters<typeof runReminderTick>[1] = {}) => runReminderTick(reminderDeps, opts);
export const readUnansweredReminders = (date: string) => readUnanswered(reminderDeps, { date });
