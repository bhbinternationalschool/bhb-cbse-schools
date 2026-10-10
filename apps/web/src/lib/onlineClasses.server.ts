import "server-only";

/**
 * Online classes — persistence, roster, announcements and the Meet sync.
 *
 * Rows in online_class_sessions / online_class_joins (see the migration
 * header for why rows and not a blob). Authorization is the caller's job;
 * everything here trusts its arguments.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { loadMasters } from "@/lib/masters";
import { sendPushToSubject, sendPushToSubjects } from "@/lib/webPush.server";
import { createMeetSpace, listMeetParticipants } from "@/lib/googleMeet.server";
import { staffConnectionKey } from "@/lib/googleClassroom.store.server";
import {
  autoEndDue,
  matchParticipantToRoster,
  reminderDue,
  sortSessions,
  type OnlineClassInput,
  type OnlineClassJoin,
  type OnlineClassSession,
  type OnlineClassStatus,
} from "@/lib/onlineClasses";

const SESSIONS = "online_class_sessions";
const JOINS = "online_class_joins";

type SessionRow = {
  id: string;
  academic_year_code: string;
  class_id: string;
  section_id: string;
  subject_id: string;
  teacher_id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  period_no: number | null;
  provider: string;
  join_url: string;
  meeting_code: string;
  meet_space_name: string;
  status: string;
  note: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
  cancelled_at: string | null;
  announced_at: string | null;
  reminded_at: string | null;
  attendance_synced_at: string | null;
};

type JoinRow = {
  id: string;
  session_id: string;
  student_id: string;
  household_id: string;
  source: string;
  display_name: string;
  first_joined_at: string;
  last_joined_at: string;
  minutes: number;
};

function fromSessionRow(r: SessionRow): OnlineClassSession {
  return {
    id: r.id,
    academicYearCode: r.academic_year_code || "",
    classId: r.class_id,
    sectionId: r.section_id,
    subjectId: r.subject_id || "",
    teacherId: r.teacher_id || "",
    title: r.title || "",
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    periodNo: r.period_no ?? null,
    provider: r.provider === "google_meet" ? "google_meet" : "link",
    joinUrl: r.join_url || "",
    meetingCode: r.meeting_code || "",
    meetSpaceName: r.meet_space_name || "",
    status: (r.status as OnlineClassStatus) || "scheduled",
    note: r.note || "",
    createdBy: r.created_by || "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at || "",
    endedAt: r.ended_at || "",
    cancelledAt: r.cancelled_at || "",
    announcedAt: r.announced_at || "",
    remindedAt: r.reminded_at || "",
    attendanceSyncedAt: r.attendance_synced_at || "",
  };
}

function fromJoinRow(r: JoinRow): OnlineClassJoin {
  return {
    id: r.id,
    sessionId: r.session_id,
    studentId: r.student_id,
    householdId: r.household_id || "",
    source: (r.source as OnlineClassJoin["source"]) || "app",
    displayName: r.display_name || "",
    firstJoinedAt: r.first_joined_at,
    lastJoinedAt: r.last_joined_at,
    minutes: r.minutes || 0,
  };
}

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

type Ok<T> = { ok: true; value: T };
type Fail = { ok: false; error: string; reconnect?: boolean };

// ─── Read ────────────────────────────────────────────────────────────

export async function listSessions(filter: {
  fromDate?: string;
  toDate?: string;
  sectionIds?: string[];
  teacherId?: string;
  statuses?: OnlineClassStatus[];
  limit?: number;
}): Promise<OnlineClassSession[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  if (filter.sectionIds && filter.sectionIds.length === 0) return [];
  const res = await fetchAllPages<SessionRow>(
    (from, to) => {
      let q = ctx.sb.from(SESSIONS).select("*").eq("tenant_id", ctx.tenantId);
      if (filter.fromDate) q = q.gte("date", filter.fromDate);
      if (filter.toDate) q = q.lte("date", filter.toDate);
      if (filter.sectionIds) q = q.in("section_id", filter.sectionIds.slice(0, 150));
      if (filter.teacherId) q = q.eq("teacher_id", filter.teacherId);
      if (filter.statuses?.length) q = q.in("status", filter.statuses);
      return q.order("id").range(from, to);
    },
    { maxRows: filter.limit ?? 5000 },
  );
  return sortSessions(res.rows.map(fromSessionRow));
}

export async function getSession(id: string): Promise<OnlineClassSession | null> {
  const ctx = await getServerTenantContext();
  if (!ctx || !id) return null;
  const { data } = await ctx.sb
    .from(SESSIONS)
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? fromSessionRow(data as SessionRow) : null;
}

export async function listJoins(sessionId: string): Promise<OnlineClassJoin[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const res = await fetchAllPages<JoinRow>((from, to) =>
    ctx.sb
      .from(JOINS)
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .eq("session_id", sessionId)
      .order("id")
      .range(from, to),
  );
  return res.rows.map(fromJoinRow);
}

/** How many children joined each of these sessions — for the teacher's list. */
export async function joinCountsFor(sessionIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ctx = await getServerTenantContext();
  if (!ctx || sessionIds.length === 0) return out;
  const res = await fetchAllPages<{ session_id: string }>((from, to) =>
    ctx.sb
      .from(JOINS)
      .select("id, session_id")
      .eq("tenant_id", ctx.tenantId)
      .in("session_id", sessionIds.slice(0, 150))
      .order("id")
      .range(from, to),
  );
  for (const r of res.rows) out.set(r.session_id, (out.get(r.session_id) || 0) + 1);
  return out;
}

/** Which of these sessions a child has joined — for the parent's list. */
export async function joinedSessionIdsFor(
  studentId: string,
  sessionIds: string[],
): Promise<Set<string>> {
  const ctx = await getServerTenantContext();
  if (!ctx || !studentId || sessionIds.length === 0) return new Set();
  const { data } = await ctx.sb
    .from(JOINS)
    .select("session_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("student_id", studentId)
    .in("session_id", sessionIds.slice(0, 150));
  return new Set(((data as { session_id: string }[]) || []).map((r) => r.session_id));
}

// ─── Roster ──────────────────────────────────────────────────────────

export type RosterChild = {
  studentId: string;
  fullName: string;
  rollNo: string;
  householdId: string;
};

/** Active children of a section this year, with the household each belongs to. */
export async function sectionRoster(
  classId: string,
  sectionId: string,
  academicYearCode: string,
): Promise<RosterChild[]> {
  await ensureSchoolMirrorHydrated();
  await ensureSisHydratedServer();
  const sis = loadSis();
  const seen = new Set<string>();
  const out: RosterChild[] = [];
  for (const s of sis.students) {
    if (s.status !== "active") continue;
    if (s.classId !== classId || s.sectionId !== sectionId) continue;
    if (academicYearCode && s.academicYearCode && s.academicYearCode !== academicYearCode) {
      continue;
    }
    const key = s.admissionNo || s.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      studentId: s.id,
      fullName: s.fullName,
      rollNo: s.rollNo || "",
      householdId: s.householdId || "",
    });
  }
  return out.sort(
    (a, b) =>
      (Number(a.rollNo) || 9999) - (Number(b.rollNo) || 9999) ||
      a.fullName.localeCompare(b.fullName),
  );
}

// ─── Write ───────────────────────────────────────────────────────────

/**
 * Create a session. For google_meet the room is made first, on the host
 * teacher's grant; a failure there is returned to the caller unsaved so
 * the form can offer "paste a link instead" — a scheduled class with no
 * way in is worse than none.
 */
export async function createSession(
  input: OnlineClassInput,
  opts: { academicYearCode: string; createdBy: string; teacherEmail?: string },
): Promise<Ok<OnlineClassSession> | Fail> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database not reachable" };

  let joinUrl = input.joinUrl;
  let meetingCode = "";
  let meetSpaceName = "";
  if (input.provider === "google_meet") {
    if (!input.teacherId && !opts.teacherEmail) {
      return { ok: false, error: "Pick the teacher who will host the Meet" };
    }
    const key = staffConnectionKey({
      staffId: input.teacherId,
      email: opts.teacherEmail,
    });
    const room = await createMeetSpace(key);
    if (!room.ok) return room;
    joinUrl = room.value.meetingUri;
    meetingCode = room.value.meetingCode;
    meetSpaceName = room.value.name;
  }

  const now = new Date().toISOString();
  const row = {
    id: nid("ocl"),
    tenant_id: ctx.tenantId,
    academic_year_code: opts.academicYearCode,
    class_id: input.classId,
    section_id: input.sectionId,
    subject_id: input.subjectId,
    teacher_id: input.teacherId,
    title: input.title,
    date: input.date,
    start_time: input.startTime,
    end_time: input.endTime,
    period_no: input.periodNo,
    provider: input.provider,
    join_url: joinUrl,
    meeting_code: meetingCode,
    meet_space_name: meetSpaceName,
    status: "scheduled",
    note: input.note,
    created_by: opts.createdBy,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await ctx.sb.from(SESSIONS).insert(row).select("*").single();
  if (error || !data) return { ok: false, error: error?.message || "Insert failed" };
  return { ok: true, value: fromSessionRow(data as SessionRow) };
}

export type SessionAction = "start" | "end" | "cancel" | "reopen";

const TRANSITIONS: Record<SessionAction, { from: OnlineClassStatus[]; to: OnlineClassStatus }> = {
  start: { from: ["scheduled"], to: "live" },
  end: { from: ["scheduled", "live"], to: "ended" },
  cancel: { from: ["scheduled", "live"], to: "cancelled" },
  reopen: { from: ["ended", "cancelled"], to: "scheduled" },
};

export async function applySessionAction(
  id: string,
  action: SessionAction,
): Promise<Ok<OnlineClassSession> | Fail> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database not reachable" };
  const current = await getSession(id);
  if (!current) return { ok: false, error: "Class not found" };
  const t = TRANSITIONS[action];
  if (!t.from.includes(current.status)) {
    return {
      ok: false,
      error: `Cannot ${action} a class that is ${current.status}`,
    };
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: t.to, updated_at: now };
  if (action === "start") patch.started_at = now;
  if (action === "end") patch.ended_at = now;
  if (action === "cancel") patch.cancelled_at = now;
  if (action === "reopen") {
    patch.ended_at = null;
    patch.cancelled_at = null;
    patch.started_at = null;
  }
  const { data, error } = await ctx.sb
    .from(SESSIONS)
    .update(patch)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.message || "Update failed" };
  return { ok: true, value: fromSessionRow(data as SessionRow) };
}

/** Edit the schedulable fields of a class that has not run yet. */
export async function updateSessionDetails(
  id: string,
  patch: Partial<Pick<OnlineClassInput, "title" | "date" | "startTime" | "endTime" | "note" | "joinUrl" | "subjectId" | "teacherId">>,
): Promise<Ok<OnlineClassSession> | Fail> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database not reachable" };
  const current = await getSession(id);
  if (!current) return { ok: false, error: "Class not found" };
  if (current.status !== "scheduled") {
    return { ok: false, error: "Only a class that has not started can be edited" };
  }
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.date !== undefined) row.date = patch.date;
  if (patch.startTime !== undefined) row.start_time = patch.startTime;
  if (patch.endTime !== undefined) row.end_time = patch.endTime;
  if (patch.note !== undefined) row.note = patch.note;
  if (patch.subjectId !== undefined) row.subject_id = patch.subjectId;
  if (patch.teacherId !== undefined) row.teacher_id = patch.teacherId;
  if (patch.joinUrl !== undefined && current.provider === "link") row.join_url = patch.joinUrl;
  // A moved class is announced again; the old reminder no longer applies.
  if (patch.date !== undefined || patch.startTime !== undefined) {
    row.reminded_at = null;
  }
  const { data, error } = await ctx.sb
    .from(SESSIONS)
    .update(row)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.message || "Update failed" };
  return { ok: true, value: fromSessionRow(data as SessionRow) };
}

/** A child (or the parent on their behalf) tapped Join. Idempotent per child. */
export async function recordJoin(input: {
  sessionId: string;
  studentId: string;
  householdId: string;
  source: OnlineClassJoin["source"];
  displayName?: string;
  minutes?: number;
}): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const now = new Date().toISOString();
  const { data: existing } = await ctx.sb
    .from(JOINS)
    .select("id, minutes, source")
    .eq("tenant_id", ctx.tenantId)
    .eq("session_id", input.sessionId)
    .eq("student_id", input.studentId)
    .maybeSingle();
  if (existing) {
    const prev = existing as { id: string; minutes: number; source: string };
    const patch: Record<string, unknown> = { last_joined_at: now };
    if (input.minutes && input.minutes > (prev.minutes || 0)) patch.minutes = input.minutes;
    if (input.displayName) patch.display_name = input.displayName;
    const { error } = await ctx.sb.from(JOINS).update(patch).eq("id", prev.id);
    return !error;
  }
  const { error } = await ctx.sb.from(JOINS).insert({
    id: nid("ocj"),
    tenant_id: ctx.tenantId,
    session_id: input.sessionId,
    student_id: input.studentId,
    household_id: input.householdId,
    source: input.source,
    display_name: input.displayName || "",
    first_joined_at: now,
    last_joined_at: now,
    minutes: input.minutes || 0,
  });
  return !error;
}

// ─── Announce / remind ───────────────────────────────────────────────

function describe(s: OnlineClassSession): {
  what: string;
  when: string;
  teacher: string;
} {
  const masters = loadMasters();
  const cls = masters.classes.find((c) => c.id === s.classId)?.name || "";
  const sec = masters.sections.find((x) => x.id === s.sectionId)?.name || "";
  const subject = masters.subjects.find((x) => x.id === s.subjectId)?.nameEn || "";
  const teacher = masters.staff.find((x) => x.id === s.teacherId)?.fullName || "";
  const what = s.title || [subject, `${cls} ${sec}`.trim()].filter(Boolean).join(" · ");
  const [y, m, d] = s.date.split("-");
  const when = `${d}/${m}/${y} ${s.startTime}–${s.endTime}`;
  return { what, when, teacher };
}

function fmt12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

/**
 * Tell every household in the section (and the teacher) that a class is
 * on. At most once per session — the column is the guard, so a double
 * click on Schedule or a retried request cannot send it twice.
 */
export async function announceSession(
  s: OnlineClassSession,
): Promise<{ households: number; sent: number }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { households: 0, sent: 0 };
  if (s.announcedAt || s.status === "cancelled") return { households: 0, sent: 0 };
  const { data: claimed } = await ctx.sb
    .from(SESSIONS)
    .update({ announced_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", s.id)
    .is("announced_at", null)
    .select("id");
  if (!claimed || (claimed as unknown[]).length === 0) return { households: 0, sent: 0 };

  await ensureSchoolMirrorHydrated();
  const roster = await sectionRoster(s.classId, s.sectionId, s.academicYearCode);
  const { what, teacher } = describe(s);
  const byHousehold = new Map<string, string>();
  for (const c of roster) if (c.householdId && !byHousehold.has(c.householdId)) byHousehold.set(c.householdId, c.studentId);

  let sent = 0;
  const body = `${fmt12(s.startTime)} today${teacher ? ` · ${teacher}` : ""}. Tap to see the link.`;
  const isToday = s.date === new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [y, m, d] = s.date.split("-");
  const bodyLater = `${d}/${m}/${y} at ${fmt12(s.startTime)}${teacher ? ` · ${teacher}` : ""}. Tap to see the link.`;
  for (const [householdId, studentId] of byHousehold) {
    const r = await sendPushToSubject("parent", householdId, {
      title: `Online class: ${what}`,
      body: isToday ? body : bodyLater,
      url: `/online-classes?studentId=${encodeURIComponent(studentId)}`,
      data: { kind: "online_class", sessionId: s.id, studentId },
    }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
    sent += r.sent;
  }
  if (s.teacherId) {
    await sendPushToSubject("staff", s.teacherId, {
      title: `Online class scheduled: ${what}`,
      body: isToday ? `${fmt12(s.startTime)} today.` : bodyLater,
      url: "/online-classes",
      data: { kind: "online_class", sessionId: s.id },
    }).catch(() => undefined);
  }
  return { households: byHousehold.size, sent };
}

async function remindSession(s: OnlineClassSession): Promise<number> {
  const ctx = await getServerTenantContext();
  if (!ctx) return 0;
  const { data: claimed } = await ctx.sb
    .from(SESSIONS)
    .update({ reminded_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", s.id)
    .is("reminded_at", null)
    .select("id");
  if (!claimed || (claimed as unknown[]).length === 0) return 0;
  const roster = await sectionRoster(s.classId, s.sectionId, s.academicYearCode);
  const { what } = describe(s);
  const byHousehold = new Map<string, string>();
  for (const c of roster) if (c.householdId && !byHousehold.has(c.householdId)) byHousehold.set(c.householdId, c.studentId);
  let sent = 0;
  for (const [householdId, studentId] of byHousehold) {
    const r = await sendPushToSubject("parent", householdId, {
      title: `Starting soon: ${what}`,
      body: `${fmt12(s.startTime)}. Tap to join.`,
      url: `/online-classes?studentId=${encodeURIComponent(studentId)}`,
      data: { kind: "online_class", sessionId: s.id, studentId },
    }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
    sent += r.sent;
  }
  if (s.teacherId) {
    await sendPushToSubjects("staff", [s.teacherId], {
      title: `Your online class starts at ${fmt12(s.startTime)}`,
      body: what,
      url: "/online-classes",
      data: { kind: "online_class", sessionId: s.id },
    }).catch(() => undefined);
  }
  return sent;
}

/**
 * The scheduler's tick: nudge classes starting within the window, close
 * the ones nobody ended. Cheap when there is nothing today — one indexed
 * read for today's rows.
 */
export async function onlineClassesTick(at: Date = new Date()): Promise<{
  reminded: number;
  pushes: number;
  autoEnded: number;
}> {
  const today = new Date(at.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const yesterday = new Date(at.getTime() + 5.5 * 3600_000 - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = await listSessions({
    fromDate: yesterday,
    toDate: today,
    statuses: ["scheduled", "live"],
  });
  let reminded = 0;
  let pushes = 0;
  let autoEnded = 0;
  for (const s of rows) {
    if (autoEndDue(s, at)) {
      const r = await applySessionAction(s.id, "end");
      if (r.ok) autoEnded += 1;
      continue;
    }
    if (reminderDue(s, at)) {
      const n = await remindSession(s);
      reminded += 1;
      pushes += n;
    }
  }
  return { reminded, pushes, autoEnded };
}

// ─── Meet attendance sync ────────────────────────────────────────────

export async function syncMeetAttendance(
  s: OnlineClassSession,
  opts: { teacherEmail?: string },
): Promise<
  | Ok<{ participants: number; matched: number; unmatched: string[] }>
  | Fail
> {
  if (s.provider !== "google_meet" || !s.meetSpaceName) {
    return { ok: false, error: "Only a Google Meet class made here can be synced" };
  }
  const key = staffConnectionKey({ staffId: s.teacherId, email: opts.teacherEmail });
  const parts = await listMeetParticipants(key, s.meetSpaceName);
  if (!parts.ok) return parts;
  const roster = await sectionRoster(s.classId, s.sectionId, s.academicYearCode);
  const byStudent = new Map(roster.map((r) => [r.studentId, r]));
  let matched = 0;
  const unmatched: string[] = [];
  for (const p of parts.value) {
    const sid = matchParticipantToRoster(p.displayName, roster);
    if (!sid) {
      if (p.displayName) unmatched.push(p.displayName);
      continue;
    }
    const child = byStudent.get(sid)!;
    const ok = await recordJoin({
      sessionId: s.id,
      studentId: sid,
      householdId: child.householdId,
      source: "meet_sync",
      displayName: p.displayName,
      minutes: p.minutes,
    });
    if (ok) matched += 1;
  }
  const ctx = await getServerTenantContext();
  if (ctx) {
    await ctx.sb
      .from(SESSIONS)
      .update({ attendance_synced_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", s.id);
  }
  return {
    ok: true,
    value: { participants: parts.value.length, matched, unmatched: [...new Set(unmatched)] },
  };
}
