import "server-only";

import { createHash } from "node:crypto";

/**
 * School chat — the server side (director's request, 15 Oct 2026).
 *
 * Every read and write goes through here, from the routes under
 * app/api/v1/school-chat (the staff app, the parent app and the web ERP all
 * use the same routes). Rules:
 *  - Membership is decided here, per request, from the roster this server
 *    just read (lib/schoolChat.ts) — never from the client.
 *  - Rows only (school_chat_* tables, migration 20261020090000), read from
 *    SQL scoped to the conversation; a failed read is a 503, never an empty
 *    chat (R6).
 *  - Every message (staff too) is checked before it is stored as visible;
 *    a failure of the check holds a child's / family's message and flags a
 *    staff one (lib/schoolChatModeration.ts).
 *  - Every check and decision is logged with the original text, in the
 *    same transaction as the write it describes (the school_chat_* RPCs);
 *    a write whose log row cannot be written is refused, never half-done.
 *  - A sender may send CHAT_RATE_LIMIT messages a minute / a day, checked
 *    before the model is asked.
 */

import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import { loadScopeTimetable } from "@/lib/api/v1/timetableScope.server";
import { readClassCoordinators } from "@/lib/attendanceCover.server";
import { coordinatorBySection } from "@/lib/attendanceCover";
import { readStudentById } from "@/lib/data/server/householdRead";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import { hasFeaturePermission, type RbacState } from "@/lib/rbac";
import { getServerTenantContext } from "@/lib/serverTenant";
import { rowToStudent } from "@/lib/sisNormalized.server";
import { normalizeStudent, type SisStudent } from "@/lib/sis";
import { staffRoleCodeFor } from "@/lib/staffSessionRole";
import { resolveSessionStaff } from "@/lib/staffResolve";
import {
  allGroups,
  blockVerdict,
  CHAT_RATE_LIMIT,
  groupFor,
  isRepeatOffender,
  parentDmId,
  parentLabel,
  parseConversationId,
  rateLimitRefusal,
  sectionGroups,
  sectionLabel,
  staffDmId,
  staffForChild,
  staffMadeGroupId,
  staffGroups,
  staffLabel,
  studentLabel,
  type ChatBlock,
  type ChatRoster,
  type ChatSubject,
  type GroupRef,
  type ParsedConversation,
} from "@/lib/schoolChat";
import { admitThenModerate, heldNotice, type Classifier, type ModerationOutcome } from "@/lib/schoolChatModeration";
import { notifySchoolChat } from "@/lib/schoolChatNotify.server";
import { cardText, readWorkForSections, workComposerFor, workForGroup, type WorkCard, type WorkItem } from "@/lib/schoolChatWork.server";

type Sb = NonNullable<Awaited<ReturnType<typeof getServerTenantContext>>>["sb"];
type Tenant = { sb: Sb; tenantId: string };

const NOT_SET_UP = "School chat is not set up on the server yet — the office has been told.";

export async function chatTenant(): Promise<Tenant> {
  const t = await getServerTenantContext();
  if (!t) throw new ApiError("server_error", "Could not reach the school database — please try again.", 503);
  return t;
}

/** A database error: a missing table is "not set up"; anything else is a 503. */
function dbFail(where: string, error: { message?: string; code?: string } | null, write = false): never {
  const msg = error?.message || "unknown";
  console.error(`[school-chat] ${where}: ${msg}`);
  if (error?.code === "42P01" || error?.code === "PGRST205" || /does not exist|schema cache/i.test(msg)) {
    throw new ApiError("server_error", NOT_SET_UP, 503);
  }
  throw new ApiError("server_error", write ? "Could not save that — nothing was changed. Please try again." : "Could not read the chat — please try again.", 503);
}

// ── Who is asking ────────────────────────────────────────────────────────

export type ChatActor =
  | { kind: "staff"; staffId: string; name: string; moderator: boolean; ay: string }
  | {
      kind: "family";
      householdId: string;
      student: SisStudent;
      section: string;
      ay: string;
    };

/** The RBAC function behind moderation (lib/rbacFeatureCatalog/campus.ts). */
export const CHAT_MODERATE_FEATURE = "discipline.chat_moderate";

/**
 * Moderator = holds the "School chat moderation" function for approve —
 * through Discipline · approve (owner, principal, admin by default) or the
 * function on its own (Masters → Roles). Unknown roles = not a moderator.
 */
export function isChatModerator(ctx: ApiAuthContext): boolean {
  if (ctx.session.persona !== "staff" || ctx.rbacKnown === false) return false;
  try {
    return hasFeaturePermission(ctx.session, ctx.masters, CHAT_MODERATE_FEATURE, "approve", ctx.rbac);
  } catch {
    return false;
  }
}

/**
 * The staff id a staff login chats as: the session's own; else the roster
 * row its email / login / name matches (resolveSessionStaff, as the old
 * header chat did); else — for a moderator only (the owner / principal
 * signing in with an account that has no staff row, as the director's does)
 * — a stable id made from the login ("sess_<email>"), the same id the old
 * header chat gave such a login. Anyone else without a staff row: null.
 */
export function staffChatId(ctx: ApiAuthContext): string {
  const s = ctx.session;
  if (s.staffId) return s.staffId;
  const row = resolveSessionStaff({ email: s.email, fullName: s.fullName }, ctx.masters);
  if (row?.id) return row.id;
  if (!isChatModerator(ctx)) return "";
  const seed = (s.email || s.fullName || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return seed ? `sess_${seed}` : "";
}

function familyYear(masters: MastersState, fallback: string): string {
  try {
    return currentAcademicYearCode(masters) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * The caller. A family must name the child it is acting for; the child must
 * be theirs, active, and on this year's roll — else 403/404.
 */
export async function chatActor(ctx: ApiAuthContext, studentId: string | null): Promise<ChatActor> {
  if (ctx.session.persona === "staff") {
    const staffId = staffChatId(ctx);
    if (!staffId) throw new ApiError("forbidden", "Your login is not linked to a staff record — ask the office to add your email to your Staff profile, then sign in again.", 403);
    return { kind: "staff", staffId, name: ctx.session.fullName, moderator: isChatModerator(ctx), ay: staffWorkingYear(ctx) };
  }
  if (ctx.session.persona === "parent") {
    const householdId = ctx.session.householdId || "";
    if (!householdId) throw new ApiError("forbidden", "Parent session required", 403);
    const sid = (studentId || "").trim();
    if (!sid) throw new ApiError("bad_request", "Pick your child first (studentId).", 400);
    const r = await readStudentById(sid);
    if (!r.ok) throw new ApiError("server_error", "Could not read your child's record — please try again.", 503);
    const s = r.student;
    if (!s) throw new ApiError("not_found", "Student not found", 404);
    if (s.householdId !== householdId) throw new ApiError("forbidden", "Not your child", 403);
    const ay = familyYear(ctx.masters, ctx.session.academicYearCode);
    if (s.status !== "active" || s.academicYearCode !== ay) {
      throw new ApiError("forbidden", "Chat is open for children on this year's roll only.", 403);
    }
    return { kind: "family", householdId, student: s, section: sectionLabel(ctx.masters, s.classId, s.sectionId), ay };
  }
  throw new ApiError("forbidden", "School chat is for staff and families.", 403);
}

function subjectsOf(actor: ChatActor, asParent = false): ChatSubject[] {
  if (actor.kind === "staff") return [{ kind: "staff", id: actor.staffId }];
  return asParent
    ? [{ kind: "household", id: actor.householdId }]
    : [
        { kind: "student", id: actor.student.id },
        { kind: "household", id: actor.householdId },
      ];
}

// ── The roster ───────────────────────────────────────────────────────────

export async function loadChatRoster(ctx: ApiAuthContext, ay: string): Promise<ChatRoster> {
  const [tt, coord] = await Promise.all([loadScopeTimetable(), readClassCoordinators()]);
  if (!coord) console.warn("[school-chat] co-ordinators unknown — class groups built without them");
  const m = ctx.masters;
  return {
    ay,
    staff: (m.staff ?? []).map((s) => ({
      id: s.id,
      fullName: s.fullName,
      status: s.status,
      classTeacherLinks: s.classTeacherLinks,
      subjectTeachingLinks: s.subjectTeachingLinks,
    })),
    classes: m.classes,
    sections: m.sections,
    subjects: m.subjects,
    grids: tt.grids,
    coordinators: coord ? coordinatorBySection(coord.state) : new Map(),
  };
}

const staffName = (roster: ChatRoster, id: string) => roster.staff.find((s) => s.id === id)?.fullName || "Staff";

/**
 * A staff↔staff chat's title for one of its two: the other's name — or, for
 * a login with no staff row (an owner's "sess_…" id, see staffChatId), the
 * names stored on the row when it was opened, less the caller's own.
 */
function otherStaffTitle(roster: ChatRoster, row: Pick<ConvRow, "staff_ids" | "title">, me: string): string {
  const other = row.staff_ids.find((id) => id !== me) || "";
  const hit = roster.staff.find((s) => s.id === other);
  if (hit) return hit.fullName;
  const mine = roster.staff.find((s) => s.id === me)?.fullName;
  const parts = row.title.split(" · ").filter((p) => p && p !== mine);
  return parts[0] || "Staff";
}

/** Active children on this year's roll in one section (SQL, scoped to it). */
async function sectionStudents(t: Tenant, ay: string, classId: string, sectionId: string): Promise<SisStudent[]> {
  const { data, error } = await t.sb
    .from("sis_students")
    .select("*")
    .eq("tenant_id", t.tenantId)
    .eq("class_id", classId)
    .eq("section_id", sectionId)
    .eq("academic_year_code", ay)
    .eq("status", "active")
    .limit(500);
  if (error) dbFail("section students", error);
  return ((data ?? []) as Parameters<typeof rowToStudent>[0][])
    .map((r) => normalizeStudent(rowToStudent(r)))
    .filter((s) => s.classId === classId && s.sectionId === sectionId && s.status === "active");
}

// ── Blocks ───────────────────────────────────────────────────────────────

type BlockRow = {
  id: string;
  subject_kind: ChatSubject["kind"];
  subject_id: string;
  mode: "mute" | "block";
  conversation_id: string;
  reason: string;
  created_at: string;
  created_by_name: string;
  created_by?: string;
  lifted_at?: string | null;
  lifted_by?: string;
  lift_reason?: string;
};

const toBlock = (r: BlockRow): ChatBlock => ({
  id: r.id,
  subjectKind: r.subject_kind,
  subjectId: r.subject_id,
  mode: r.mode,
  conversationId: r.conversation_id,
  reason: r.reason,
  createdAt: r.created_at,
  createdByName: r.created_by_name,
});

async function activeBlocksFor(t: Tenant, subjects: ChatSubject[]): Promise<ChatBlock[]> {
  const ids = [...new Set(subjects.map((s) => s.id))];
  const { data, error } = await t.sb
    .from("school_chat_blocks")
    .select("id, subject_kind, subject_id, mode, conversation_id, reason, created_at, created_by_name")
    .eq("tenant_id", t.tenantId)
    .is("lifted_at", null)
    .in("subject_id", ids);
  // Unknown is not "no block": refuse rather than let a blocked person in.
  if (error) dbFail("blocks", error);
  return ((data ?? []) as BlockRow[]).map(toBlock).filter((b) => subjects.some((s) => s.kind === b.subjectKind && s.id === b.subjectId));
}

// ── Conversations ────────────────────────────────────────────────────────

type ConvRow = {
  id: string;
  kind: string;
  staff_ids: string[];
  household_id: string;
  student_id: string;
  title: string;
  last_message_at: string | null;
  academic_year_code?: string;
  class_id?: string;
  section_id?: string;
  created_by?: string;
};

const CONV_COLS = "id, kind, staff_ids, household_id, student_id, title, last_message_at, academic_year_code, class_id, section_id, created_by";

export type ConversationAccess = {
  id: string;
  kind: ParsedConversation["kind"];
  title: string;
  /** Staff who belong to it (push). */
  staffIds: string[];
  /** The group, for class / subject. */
  group: GroupRef | null;
  /** A staff-made group's section (its families read it), else null. */
  section: { classId: string; sectionId: string } | null;
  /** true = may read, never post (a family in a staff-made group). */
  readOnly: boolean;
  /** dm_parent: the family + child. */
  householdId: string;
  studentId: string;
  /** true = a moderator looking in, not a member. */
  oversight: boolean;
  /** How the caller speaks here. */
  speakAs: "staff" | "student" | "parent";
  /** A staff-made group's maker (its actor key, "staff:<id>"); "" otherwise. */
  createdBy: string;
};

/** Group rows this process has already made sure of (they are never deleted). */
const ensuredGroups = new Set<string>();

async function ensureGroupRow(t: Tenant, g: GroupRef, ay: string, createdBy: string): Promise<void> {
  if (ensuredGroups.has(`${t.tenantId}|${g.id}`)) return;
  const { error } = await t.sb.from("school_chat_conversations").upsert(
    {
      id: g.id,
      tenant_id: t.tenantId,
      kind: g.kind,
      academic_year_code: ay,
      class_id: g.classId,
      section_id: g.sectionId,
      subject_id: g.subjectId,
      title: g.title,
      created_by: createdBy,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) dbFail("group row", error);
  ensuredGroups.add(`${t.tenantId}|${g.id}`);
}

async function readConvRow(t: Tenant, id: string): Promise<ConvRow | null> {
  const { data, error } = await t.sb
    .from("school_chat_conversations")
    .select(CONV_COLS)
    .eq("tenant_id", t.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) dbFail("conversation", error);
  return (data as ConvRow | null) ?? null;
}

const actorKey = (a: ChatActor) => (a.kind === "staff" ? `staff:${a.staffId}` : `household:${a.householdId}`);

/**
 * May this caller open this conversation? 403 with the reason if not.
 * Students' classmates in another section, a teacher of another subject, a
 * family whose child is not in the group — all refused here.
 */
export async function accessConversation(
  ctx: ApiAuthContext,
  t: Tenant,
  actor: ChatActor,
  conversationId: string,
): Promise<{ access: ConversationAccess; roster: ChatRoster }> {
  const parsed = parseConversationId(conversationId);
  if (!parsed) throw new ApiError("not_found", "No such conversation", 404);
  const roster = await loadChatRoster(ctx, actor.ay);
  const refuse = (): never => {
    throw new ApiError("forbidden", "You are not a member of this conversation.", 403);
  };

  if (parsed.kind === "class" || parsed.kind === "subject") {
    const g = groupFor(roster, parsed);
    if (!g) refuse();
    const group = g as GroupRef;
    let oversight = false;
    let speakAs: ConversationAccess["speakAs"] = "staff";
    if (actor.kind === "family") {
      if (actor.student.classId !== group.classId || actor.student.sectionId !== group.sectionId) refuse();
      speakAs = "student";
    } else if (!group.staffIds.includes(actor.staffId)) {
      if (!actor.moderator) refuse();
      oversight = true;
    }
    await ensureGroupRow(t, group, roster.ay, actorKey(actor));
    return {
      roster,
      access: { id: group.id, kind: group.kind, title: group.title, staffIds: group.staffIds, group, section: null, readOnly: false, householdId: "", studentId: "", oversight, speakAs, createdBy: "" },
    };
  }

  const row = await readConvRow(t, conversationId);
  if (!row) throw new ApiError("not_found", "No such conversation", 404);
  if (row.kind !== parsed.kind) throw new ApiError("not_found", "No such conversation", 404);
  if (parsed.kind === "group") {
    // A staff-made group: its staff are stored (staff_ids); a section's
    // families are worked out from the roll — the child must be in that
    // section on this year's roll now. Families read; they never post here.
    const section = row.class_id && row.section_id ? { classId: row.class_id, sectionId: row.section_id } : null;
    let oversight = false;
    let speakAs: ConversationAccess["speakAs"] = "staff";
    if (actor.kind === "family") {
      if (!section || actor.student.classId !== section.classId || actor.student.sectionId !== section.sectionId) refuse();
      if ((row.academic_year_code || "") !== actor.ay) refuse();
      speakAs = "student";
    } else if (!row.staff_ids.includes(actor.staffId)) {
      if (!actor.moderator) refuse();
      oversight = true;
    }
    return {
      roster,
      access: { id: row.id, kind: "group", title: row.title, staffIds: row.staff_ids, group: null, section, readOnly: actor.kind === "family", householdId: "", studentId: "", oversight, speakAs, createdBy: row.created_by || "" },
    };
  }
  if (parsed.kind === "dm_staff") {
    if (actor.kind !== "staff") refuse();
    const a = actor as Extract<ChatActor, { kind: "staff" }>;
    const member = row.staff_ids.includes(a.staffId);
    if (!member && !a.moderator) refuse();
    return {
      roster,
      access: { id: row.id, kind: "dm_staff", title: member ? otherStaffTitle(roster, row, a.staffId) : row.title, staffIds: row.staff_ids, group: null, section: null, readOnly: false, householdId: "", studentId: "", oversight: !member, speakAs: "staff", createdBy: "" },
    };
  }
  // dm_parent
  let oversight = false;
  if (actor.kind === "family") {
    if (row.household_id !== actor.householdId || row.student_id !== actor.student.id) refuse();
  } else if (!row.staff_ids.includes(actor.staffId)) {
    if (!actor.moderator) refuse();
    oversight = true;
  }
  return {
    roster,
    access: {
      id: row.id,
      kind: "dm_parent",
      title: actor.kind === "family" ? staffName(roster, row.staff_ids[0]!) : row.title,
      staffIds: row.staff_ids,
      group: null,
      section: null,
      readOnly: false,
      householdId: row.household_id,
      studentId: row.student_id,
      oversight,
      speakAs: actor.kind === "family" ? "parent" : "staff",
      createdBy: "",
    },
  };
}

export type ConversationSummary = {
  id: string;
  kind: ParsedConversation["kind"];
  title: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
  oversight: boolean;
};

/** The caller's conversations: their groups, then their direct chats. */
export async function listConversations(
  ctx: ApiAuthContext,
  actor: ChatActor,
  opts: { oversight?: boolean } = {},
): Promise<{ conversations: ConversationSummary[]; blocked: boolean; muted: boolean; moderator: boolean }> {
  const t = await chatTenant();
  const roster = await loadChatRoster(ctx, actor.ay);
  const blocks = await activeBlocksFor(t, subjectsOf(actor));
  // The family's own block closes everything; a block on the child alone
  // closes the child's groups (filtered per conversation below), not the
  // family's direct chats with teachers.
  const schoolWide = blockVerdict(blocks, subjectsOf(actor, true), "");
  if (!schoolWide.canRead) return { conversations: [], blocked: true, muted: false, moderator: false };

  let groups: GroupRef[];
  let oversightIds = new Set<string>();
  if (actor.kind === "family") {
    groups = sectionGroups(roster, actor.student.classId, actor.student.sectionId);
  } else {
    groups = staffGroups(roster, actor.staffId);
    if (actor.moderator && opts.oversight) {
      const mine = new Set(groups.map((g) => g.id));
      const rest = allGroups(roster).filter((g) => !mine.has(g.id));
      oversightIds = new Set(rest.map((g) => g.id));
      groups = [...groups, ...rest];
    }
  }

  // Direct chats, and the staff-made groups the caller is in (staff: by
  // staff_ids; a family: its child's section this year).
  let dmq = t.sb
    .from("school_chat_conversations")
    .select(CONV_COLS)
    .eq("tenant_id", t.tenantId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(300);
  dmq =
    actor.kind === "family"
      ? dmq.in("kind", ["dm_parent"]).eq("household_id", actor.householdId).eq("student_id", actor.student.id)
      : dmq.in("kind", ["dm_staff", "dm_parent", "group"]).contains("staff_ids", [actor.staffId]);
  const familyGroups =
    actor.kind === "family"
      ? t.sb
          .from("school_chat_conversations")
          .select(CONV_COLS)
          .eq("tenant_id", t.tenantId)
          .eq("kind", "group")
          .eq("academic_year_code", actor.ay)
          .eq("class_id", actor.student.classId)
          .eq("section_id", actor.student.sectionId)
          .limit(100)
      : null;
  const [{ data: dmRows, error: dmErr }, fg] = await Promise.all([dmq, familyGroups ?? Promise.resolve(null)]);
  if (dmErr) dbFail("direct chats", dmErr);
  if (fg?.error) dbFail("groups", fg.error);
  const dms = [...((dmRows ?? []) as ConvRow[]), ...((fg?.data ?? []) as ConvRow[])];

  const items: { id: string; kind: ParsedConversation["kind"]; title: string; oversight: boolean }[] = [
    ...groups.map((g) => ({ id: g.id, kind: g.kind, title: g.title, oversight: oversightIds.has(g.id) })),
    ...dms.map((r) => ({
      id: r.id,
      kind: r.kind as ParsedConversation["kind"],
      title:
        r.kind === "group"
          ? r.title
          : actor.kind === "family"
          ? staffName(roster, r.staff_ids[0]!)
          : r.kind === "dm_staff"
            ? otherStaffTitle(roster, r, actor.staffId)
            : r.title,
      oversight: false,
    })),
  ];
  const ids = items.map((i) => i.id);
  const last = new Map<string, { body: string; at: string }>();
  const unread = new Map<string, number>();
  if (ids.length) {
    const memberKind = actor.kind === "staff" ? "staff" : "household";
    const memberId = actor.kind === "staff" ? actor.staffId : actor.householdId;
    const [{ data: reads, error: rErr }, { data: msgs, error: mErr }] = await Promise.all([
      t.sb.from("school_chat_members").select("conversation_id, last_read_at").eq("tenant_id", t.tenantId).eq("member_kind", memberKind).eq("member_id", memberId).in("conversation_id", ids),
      t.sb
        .from("school_chat_messages")
        .select("conversation_id, body, created_at, sender_kind, sender_id, household_id")
        .eq("tenant_id", t.tenantId)
        .eq("status", "visible")
        .in("conversation_id", ids)
        .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);
    if (rErr) dbFail("read markers", rErr);
    if (mErr) dbFail("messages", mErr);
    const readAt = new Map(((reads ?? []) as { conversation_id: string; last_read_at: string | null }[]).map((r) => [r.conversation_id, r.last_read_at || ""]));
    for (const m of (msgs ?? []) as { conversation_id: string; body: string; created_at: string; sender_kind: string; sender_id: string; household_id: string }[]) {
      if (!last.has(m.conversation_id)) last.set(m.conversation_id, { body: m.body, at: m.created_at });
      const mine = actor.kind === "staff" ? m.sender_kind === "staff" && m.sender_id === actor.staffId : m.household_id === actor.householdId;
      // A group's history line ("Asha added Ravi") is shown, never counted unread.
      if (isGroupNote(m)) continue;
      if (!mine && m.created_at > (readAt.get(m.conversation_id) || "")) unread.set(m.conversation_id, (unread.get(m.conversation_id) || 0) + 1);
    }
    // Homework / classwork cards count as messages of their groups (the
    // Homework module's rows, one read for every listed section).
    if (groups.length) {
      const items = await readWorkForSections(ctx.masters, roster.ay, [...new Set(groups.map((g) => g.sectionId))]);
      for (const g of groups) {
        for (const w of workForGroup(items, g)) {
          const prev = last.get(g.id);
          if (!prev || w.createdAt > prev.at) last.set(g.id, { body: cardText(w.card), at: w.createdAt });
          const mine = actor.kind === "staff" && w.card.teacherStaffId === actor.staffId;
          if (!mine && w.createdAt > (readAt.get(g.id) || "")) unread.set(g.id, (unread.get(g.id) || 0) + 1);
        }
      }
    }
  }
  const conversations = items
    .filter((i) => blockVerdict(blocks, subjectsOf(actor, i.kind === "dm_parent"), i.id).canRead)
    .map((i) => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      lastMessage: last.get(i.id)?.body ?? null,
      lastMessageAt: last.get(i.id)?.at ?? null,
      unread: unread.get(i.id) || 0,
      oversight: i.oversight,
    }));
  return { conversations, blocked: false, muted: !blockVerdict(blocks, subjectsOf(actor), "").canSend, moderator: actor.kind === "staff" && actor.moderator };
}

// ── Messages ─────────────────────────────────────────────────────────────

type MsgRow = {
  id: string;
  sender_kind: "staff" | "student" | "parent";
  sender_id: string;
  household_id: string;
  sender_label: string;
  body: string;
  status: "visible" | "held" | "removed";
  moderation: { categories?: string[] } | null;
  created_at: string;
};

export type ChatMessageOut = {
  id: string;
  senderLabel: string;
  senderKind: "staff" | "student" | "parent";
  body: string;
  createdAt: string;
  mine: boolean;
  /** visible / held (waiting for review — only the sender and moderators see it) / removed (sender only). */
  status: "visible" | "held" | "removed";
  notice?: string;
  /** Moderators only: whose message it is, for mute / block. */
  senderSubject?: ChatSubject;
  /**
   * A homework / classwork card: the Homework module's own record, read
   * now (lib/schoolChatWork.server). `body` holds the same as text, for an
   * app that does not draw cards.
   */
  card?: WorkCard;
  /** A staff-made group's history line ("Asha added Ravi"), written by the server — drawn as a note, not a bubble. */
  system?: true;
};

/**
 * A group's history lines are rows of school_chat_messages written by the
 * server (manageStaffGroup), not by a person: sender_kind 'staff' (the
 * table's check allows no other kind for them) with the reserved sender id
 * GROUP_NOTE_SENDER, which no staff row has — so the per-sender rate limit,
 * "mine" and mute / block never see them as anybody's message.
 */
export const GROUP_NOTE_SENDER = "system";
const isGroupNote = (m: { sender_kind: string; sender_id: string }) => m.sender_kind === "staff" && m.sender_id === GROUP_NOTE_SENDER;

function isMine(actor: ChatActor, m: Pick<MsgRow, "sender_kind" | "sender_id" | "household_id">): boolean {
  return actor.kind === "staff" ? m.sender_kind === "staff" && m.sender_id === actor.staffId : m.sender_kind !== "staff" && m.household_id === actor.householdId;
}

export async function readMessages(
  ctx: ApiAuthContext,
  actor: ChatActor,
  conversationId: string,
): Promise<{
  conversation: ConversationAccess & {
    canSend: boolean;
    muted: boolean;
    moderator: boolean;
    compose: { subjects: { id: string; name: string }[]; fixedSubject: string } | null;
    /** A staff-made group, for staff: its members and what this person may change. */
    manage: GroupManage | null;
  };
  messages: ChatMessageOut[];
}> {
  const t = await chatTenant();
  const { access, roster } = await accessConversation(ctx, t, actor, conversationId);
  const subjects = subjectsOf(actor, access.speakAs === "parent");
  const verdict = blockVerdict(await activeBlocksFor(t, subjects), subjects, access.id);
  if (!verdict.canRead) throw new ApiError("forbidden", "The school has paused your chat. Please speak to the class teacher.", 403);

  const { data, error } = await t.sb
    .from("school_chat_messages")
    .select("id, sender_kind, sender_id, household_id, sender_label, body, status, moderation, created_at")
    .eq("tenant_id", t.tenantId)
    .eq("conversation_id", access.id)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) dbFail("messages", error);
  const rows = ((data ?? []) as MsgRow[]).reverse();
  const seeAll = actor.kind === "staff" && actor.moderator;
  const messages: ChatMessageOut[] = [];
  // Homework and classwork of a class / subject group: the Homework
  // module's rows, as cards (one record — never copied into the chat).
  const g = access.group;
  const work: WorkItem[] = g ? workForGroup(await readWorkForSections(ctx.masters, roster.ay, [g.sectionId]), g) : [];
  for (const m of rows) {
    if (isGroupNote(m)) {
      if (m.status === "visible") messages.push({ id: m.id, senderLabel: m.sender_label, senderKind: "staff", body: m.body, createdAt: m.created_at, mine: false, status: "visible", system: true });
      continue;
    }
    const mine = isMine(actor, m);
    if (m.status !== "visible" && !mine && !seeAll) continue;
    messages.push({
      id: m.id,
      senderLabel: m.sender_label,
      senderKind: m.sender_kind,
      body: m.status === "removed" && !seeAll ? "This message was removed by the school." : m.body,
      createdAt: m.created_at,
      mine,
      status: m.status,
      ...(seeAll && !mine ? { senderSubject: { kind: m.sender_kind === "parent" ? ("household" as const) : m.sender_kind, id: m.sender_id } } : {}),
      ...(m.status === "held" ? { notice: mine ? heldNotice(m.moderation?.categories ?? [], m.sender_kind) : "Held for review — only you (a moderator) and the sender see it." } : {}),
    });
  }
  if (work.length) {
    const cards: ChatMessageOut[] = work.map((w) => ({
      id: `${w.card.kind === "homework" ? "hw" : "cw"}:${w.card.refId}`,
      senderLabel: staffLabel(w.card.teacherName),
      senderKind: "staff",
      body: cardText(w.card),
      createdAt: w.createdAt,
      mine: actor.kind === "staff" && !!w.card.teacherStaffId && w.card.teacherStaffId === actor.staffId,
      status: "visible",
      card: w.card,
    }));
    messages.push(...cards);
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  // Who may post homework / classwork here (the Homework module's rule).
  const compose =
    g && actor.kind === "staff" && !access.oversight ? await workComposerFor(ctx, g.classId, g.sectionId) : null;
  if (!access.oversight) {
    const { error: rErr } = await t.sb.from("school_chat_members").upsert(
      {
        conversation_id: access.id,
        tenant_id: t.tenantId,
        member_kind: actor.kind === "staff" ? "staff" : "household",
        member_id: actor.kind === "staff" ? actor.staffId : actor.householdId,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id,member_kind,member_id" },
    );
    if (rErr) console.warn("[school-chat] read marker not saved:", rErr.message);
  }
  return {
    conversation: {
      ...access,
      canSend: verdict.canSend && !access.oversight && !access.readOnly,
      muted: !verdict.canSend,
      moderator: seeAll,
      // null = this person cannot post homework / classwork here.
      compose: compose && g ? { subjects: g.kind === "subject" ? compose.subjects.filter((x) => x.id === g.subjectId) : compose.subjects, fixedSubject: g.kind === "subject" ? g.subjectId : "" } : null,
      createdBy: actor.kind === "staff" ? access.createdBy : "",
      manage: access.kind === "group" && actor.kind === "staff" ? groupManageFor(actor, access, roster) : null,
    },
    messages,
  };
}

// ── Sending ──────────────────────────────────────────────────────────────

/**
 * SCHOOL_CHAT_AI_STUB=markers answers the model's part on the local e2e
 * stack only (E2E=1 and a 127.0.0.1 Supabase URL — never on Cloud Run): a
 * message containing "[[ai-down]]" makes the check fail, "[[ai-hold]]" makes
 * it hold, anything else is allowed. The rules layer runs as everywhere.
 */
function e2eStub(): Classifier | null {
  if (process.env.SCHOOL_CHAT_AI_STUB !== "markers") return null;
  if (process.env.E2E !== "1") return null;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL || "")) return null;
  return async (text) => {
    if (text.includes("[[ai-down]]")) return { ok: false, error: "e2e stub: model unavailable" };
    if (text.includes("[[ai-hold]]")) return { ok: true, verdict: { verdict: "hold", categories: ["bullying"], reason: "e2e stub hold" }, engine: "e2e-stub" };
    return { ok: true, verdict: { verdict: "allow", categories: [], reason: "" }, engine: "e2e-stub" };
  };
}

const AI_TIMEOUT_MS = 15_000;

function routerClassifier(requester: string): Classifier {
  return async (text, where) => {
    const { generateChatModerationJson } = await import("@/lib/aiLlm.server");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ ok: false; error: string }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: `no answer in ${AI_TIMEOUT_MS / 1000} s` }), AI_TIMEOUT_MS);
    });
    let r: Awaited<ReturnType<typeof generateChatModerationJson>> | { ok: false; error: string };
    try {
      r = await Promise.race([generateChatModerationJson({ text, where, requester }), timeout]);
    } finally {
      clearTimeout(timer);
    }
    return r.ok ? { ok: true, verdict: r.verdict, engine: r.engine, generationId: r.generationId } : { ok: false, error: r.error };
  };
}

/**
 * The per-sender rate limit (CHAT_RATE_LIMIT). One RPC counts the sender's
 * messages in the last minute / day and, when over, writes the
 * "send_refused" log row in the same transaction. A family login counts as
 * one sender (all its children and the parent line). Throws 429 to refuse;
 * a failed check is a 503, never "allowed".
 */
async function admitSend(
  t: Tenant,
  a: { actor: ChatActor; access: ConversationAccess; body: string; subject: ChatSubject },
): Promise<void> {
  const { data, error } = await t.sb.rpc("school_chat_rate_check", {
    p_tenant: t.tenantId,
    p_conversation: a.access.id,
    p_sender_kind: a.actor.kind === "staff" ? "staff" : "",
    p_sender_id: a.actor.kind === "staff" ? a.actor.staffId : "",
    p_household: a.actor.kind === "family" ? a.actor.householdId : "",
    p_subject_kind: a.subject.kind,
    p_subject_id: a.subject.id,
    p_body: a.body,
    p_per_minute: CHAT_RATE_LIMIT.perMinute,
    p_per_day: CHAT_RATE_LIMIT.perDay,
  });
  if (error) dbFail("rate check", error);
  const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; minute_count: number; day_count: number } | undefined;
  if (!row) throw new ApiError("server_error", "Could not check your sending limit — please try again.", 503);
  if (row.allowed) return;
  throw new ApiError(
    "rate_limited",
    rateLimitRefusal({ minute: row.minute_count, day: row.day_count }) || "You are sending messages too fast. Please wait a minute and try again.",
    429,
  );
}

export type SendResult = { message: ChatMessageOut; held: boolean; notice: string | null };

export async function sendMessage(
  ctx: ApiAuthContext,
  actor: ChatActor,
  conversationId: string,
  rawBody: string,
): Promise<SendResult> {
  const body = String(rawBody || "").replace(/\r\n/g, "\n").trim();
  if (!body) throw new ApiError("bad_request", "Type a message first.", 400);
  if (body.length > 2000) throw new ApiError("bad_request", "That message is too long (2,000 characters at most).", 400);

  const t = await chatTenant();
  const { access, roster } = await accessConversation(ctx, t, actor, conversationId);
  if (access.oversight) throw new ApiError("forbidden", "You are looking in as a moderator — you are not a member of this conversation.", 403);
  if (access.readOnly) throw new ApiError("forbidden", "This group is for reading — the staff who made it post here. Message a teacher directly instead.", 403);
  const asParent = access.speakAs === "parent";
  const subjects = subjectsOf(actor, asParent);
  const verdict = blockVerdict(await activeBlocksFor(t, subjects), subjects, access.id);
  if (!verdict.canSend) {
    const subject = subjects[0]!;
    // The refusal is logged or the caller hears that it was not (never a
    // silent refusal without its log row).
    const { error: logErr } = await t.sb.from("school_chat_moderation_log").insert({
      tenant_id: t.tenantId,
      conversation_id: access.id,
      action: "send_refused",
      subject_kind: subject.kind,
      subject_id: subject.id,
      reason: verdict.by ? `${verdict.by.mode}: ${verdict.by.reason}` : "",
      original_text: body,
    });
    if (logErr) dbFail("send_refused log", logErr, true);
    throw new ApiError(
      "forbidden",
      verdict.by?.mode === "block"
        ? "The school has paused your chat. Please speak to the class teacher."
        : "The school has muted you in this chat for now. You can still read messages.",
      403,
    );
  }

  const sender: "staff" | "student" | "parent" = actor.kind === "staff" ? "staff" : asParent ? "parent" : "student";
  const label =
    actor.kind === "staff"
      ? staffLabel(actor.name || staffName(roster, actor.staffId))
      : asParent
        ? parentLabel(actor.student.fullName, actor.section)
        : studentLabel(actor.student.fullName, actor.section);
  const subject: ChatSubject = actor.kind === "staff" ? { kind: "staff", id: actor.staffId } : asParent ? { kind: "household", id: actor.householdId } : { kind: "student", id: actor.student.id };
  const requester = `chat:${subject.kind}:${subject.id}`;
  const outcome: ModerationOutcome = await admitThenModerate(body, {
    sender,
    where: access.title,
    classify: e2eStub() ?? routerClassifier(requester),
    // The rate limit, BEFORE the model is asked.
    admit: () => admitSend(t, { actor, access, body, subject }),
  });

  const { data, error } = await t.sb.rpc("school_chat_post", {
    p_tenant: t.tenantId,
    p_conversation: access.id,
    p_sender_kind: sender,
    p_sender_id: subject.id,
    p_household: actor.kind === "family" ? actor.householdId : "",
    p_label: label,
    p_body: body,
    p_status: outcome.status,
    p_moderation: {
      by: outcome.by,
      categories: outcome.categories,
      reason: outcome.reason,
      flagged: !!outcome.flagged,
      engine: outcome.engine ?? "",
      generationId: outcome.generationId ?? "",
      error: outcome.error ?? "",
    },
    p_log_action: outcome.logAction,
    p_log_reason: outcome.error ? `${outcome.reason} (${outcome.error})` : outcome.reason,
    p_log_categories: outcome.categories,
    p_subject_kind: subject.kind,
    p_subject_id: subject.id,
  });
  if (error) dbFail("post", error);
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; created_at: string } | undefined;
  if (!row?.id) throw new ApiError("server_error", "The message was not saved — please try again.", 503);

  const held = outcome.status === "held";
  // Push: a visible message to the other members; a held one to moderators only.
  void notifySchoolChat({
    kind: held ? "held" : "message",
    conversationId: access.id,
    title: access.title,
    senderLabel: label,
    preview: held ? "" : body,
    urgent: outcome.categories.includes("self_harm"),
    flagged: !!outcome.flagged,
    staffIds: access.staffIds.filter((id) => !(actor.kind === "staff" && id === actor.staffId)),
    group: access.group ?? access.section,
    ay: roster.ay,
    householdIds: access.kind === "dm_parent" && actor.kind === "staff" ? [access.householdId] : [],
    exceptHousehold: actor.kind === "family" ? actor.householdId : "",
    ctx,
    loadSection: (classId, sectionId) => sectionStudents(t, roster.ay, classId, sectionId),
    loadBlocks: (s) => activeBlocksFor(t, s),
  });

  return {
    held,
    notice: held ? heldNotice(outcome.categories, sender) : null,
    message: {
      id: row.id,
      senderLabel: label,
      senderKind: sender,
      body,
      createdAt: row.created_at,
      mine: true,
      status: outcome.status,
      ...(held ? { notice: heldNotice(outcome.categories, sender) } : {}),
    },
  };
}

// ── Direct chats ─────────────────────────────────────────────────────────

export type DmTarget = { kind: string; id?: string; studentId?: string };

const NO_CHILD_DMS =
  "Children and families cannot message each other directly. Please use your class group, where a teacher is always present.";

/**
 * Open (or find) a direct chat. Allowed: staff → staff; staff → the family
 * of a child they teach (school-wide staff: any child); family → a teacher
 * of their child. Everything else — a child or family asking for another
 * child or family, staff asking for a child directly — is a 403.
 */
export async function openDirectChat(ctx: ApiAuthContext, actor: ChatActor, target: DmTarget): Promise<{ id: string; title: string }> {
  const kind = String(target.kind || "");
  if (kind === "student" || (actor.kind === "family" && kind !== "staff")) {
    throw new ApiError("forbidden", NO_CHILD_DMS, 403);
  }
  const t = await chatTenant();
  const roster = await loadChatRoster(ctx, actor.ay);
  const activeStaff = (id: string) => roster.staff.find((s) => s.id === id && s.status !== "inactive");

  if (actor.kind === "family") {
    const staffId = String(target.id || "");
    if (!activeStaff(staffId)) throw new ApiError("not_found", "That teacher was not found.", 404);
    if (!staffForChild(roster, actor.student.classId, actor.student.sectionId).includes(staffId)) {
      throw new ApiError("forbidden", "You can message the teachers of your child's class.", 403);
    }
    const id = parentDmId(staffId, actor.student.id);
    await upsertDm(t, {
      id,
      kind: "dm_parent",
      staff_ids: [staffId],
      household_id: actor.householdId,
      student_id: actor.student.id,
      title: parentLabel(actor.student.fullName, actor.section),
      created_by: actorKey(actor),
    });
    return { id, title: staffName(roster, staffId) };
  }

  if (kind === "staff") {
    const other = String(target.id || "");
    if (other === actor.staffId) throw new ApiError("bad_request", "Pick someone else to message.", 400);
    if (!activeStaff(other)) throw new ApiError("not_found", "That staff member was not found.", 404);
    const id = staffDmId(actor.staffId, other);
    const pair = [actor.staffId, other].sort();
    await upsertDm(t, {
      id,
      kind: "dm_staff",
      staff_ids: pair,
      household_id: "",
      student_id: "",
      title: pair.map((id) => (id === actor.staffId ? actor.name || staffName(roster, id) : staffName(roster, id))).join(" · "),
      created_by: actorKey(actor),
    });
    return { id, title: staffName(roster, other) };
  }

  if (kind === "parent") {
    const studentId = String(target.studentId || "");
    const r = await readStudentById(studentId);
    if (!r.ok) throw new ApiError("server_error", "Could not read the child's record — please try again.", 503);
    const s = r.student;
    if (!s || s.status !== "active" || s.academicYearCode !== actor.ay) throw new ApiError("not_found", "Child not found on this year's roll.", 404);
    const teaches = staffForChild(roster, s.classId, s.sectionId).includes(actor.staffId);
    if (!teaches && !actor.moderator) throw new ApiError("forbidden", "You can message the families of children you teach.", 403);
    if (!s.householdId) throw new ApiError("bad_request", "This child has no family record to message.", 400);
    const id = parentDmId(actor.staffId, s.id);
    const section = sectionLabel(roster, s.classId, s.sectionId);
    await upsertDm(t, {
      id,
      kind: "dm_parent",
      staff_ids: [actor.staffId],
      household_id: s.householdId,
      student_id: s.id,
      title: parentLabel(s.fullName, section),
      created_by: actorKey(actor),
    });
    return { id, title: parentLabel(s.fullName, section) };
  }
  throw new ApiError("bad_request", "Say who to message: a staff member or a child's family.", 400);
}

async function upsertDm(
  t: Tenant,
  row: { id: string; kind: "dm_staff" | "dm_parent"; staff_ids: string[]; household_id: string; student_id: string; title: string; created_by: string },
): Promise<void> {
  const { error } = await t.sb
    .from("school_chat_conversations")
    .upsert({ ...row, tenant_id: t.tenantId }, { onConflict: "id", ignoreDuplicates: true });
  if (error) dbFail("direct chat", error);
}

// ── Staff-made groups ────────────────────────────────────────────────────

const GROUP_MAX_STAFF = 200;

/** The sections a member of staff may add to a group: those they teach (staffForChild); a moderator, any. */
export function groupSectionsFor(roster: ChatRoster, staffId: string, moderator: boolean): { classId: string; sectionId: string; label: string }[] {
  const order = (classId: string) => roster.classes.find((c) => c.id === classId)?.sortOrder ?? 0;
  return roster.sections
    .filter((sec) => sec.isActive !== false && (moderator || staffForChild(roster, sec.classId, sec.id).includes(staffId)))
    .sort((a, b) => order(a.classId) - order(b.classId) || a.name.localeCompare(b.name))
    .map((sec) => ({ classId: sec.classId, sectionId: sec.id, label: sectionLabel(roster, sec.classId, sec.id) }));
}

/**
 * Make a group (staff only): a name, the staff picked (the maker is always
 * in it) and, optionally, one class section whose families READ it — the
 * old header chat's "class announcement". Any active member of staff may be
 * added (as for a direct chat); a section only by a teacher of it or a
 * moderator (stricter than the old chat, which let every office role pick
 * any section).
 */
export async function createStaffGroup(
  ctx: ApiAuthContext,
  actor: ChatActor,
  input: { title?: unknown; staffIds?: unknown; section?: unknown },
): Promise<{ id: string; title: string }> {
  if (actor.kind !== "staff") throw new ApiError("forbidden", "Only staff can make a group.", 403);
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) throw new ApiError("bad_request", "Give the group a name.", 400);
  if (title.length > 120) throw new ApiError("bad_request", "That name is too long (120 characters at most).", 400);
  const roster = await loadChatRoster(ctx, actor.ay);
  const picked = Array.isArray(input.staffIds) ? input.staffIds.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  const active = new Set(roster.staff.filter((s) => s.status !== "inactive").map((s) => s.id));
  for (const id of picked) if (!active.has(id)) throw new ApiError("not_found", "One of the staff picked was not found (or has left).", 404);
  const staffIds = [...new Set([actor.staffId, ...picked])].sort();

  let section: { classId: string; sectionId: string } | null = null;
  if (input.section != null && input.section !== "") {
    const sec = input.section as { classId?: unknown; sectionId?: unknown };
    const classId = String(sec.classId ?? "");
    const sectionId = String(sec.sectionId ?? "");
    const ok = groupSectionsFor(roster, actor.staffId, actor.moderator).some((s) => s.classId === classId && s.sectionId === sectionId);
    if (!ok) throw new ApiError("forbidden", "You can add only a class section you teach.", 403);
    section = { classId, sectionId };
  }
  // Two staff at least (the shape check of migration 20261029120000): a
  // group always has someone besides its maker to answer in it.
  if (staffIds.length < 2) throw new ApiError("bad_request", "Add at least one other member of staff.", 400);
  if (staffIds.length > GROUP_MAX_STAFF) throw new ApiError("bad_request", `A group can have ${GROUP_MAX_STAFF} staff at most.`, 400);

  const t = await chatTenant();
  const id = staffMadeGroupId(crypto.randomUUID().replace(/-/g, ""));
  const { error } = await t.sb.from("school_chat_conversations").insert({
    id,
    tenant_id: t.tenantId,
    kind: "group",
    academic_year_code: actor.ay,
    class_id: section?.classId ?? "",
    section_id: section?.sectionId ?? "",
    staff_ids: staffIds,
    title,
    created_by: actorKey(actor),
  });
  if (error) {
    // 23514 = the kind check without 'group': the migration is not applied yet.
    if (error.code === "23514") {
      console.error(`[school-chat] group insert refused by a check: ${error.message}`);
      throw new ApiError("server_error", "School chat is not set up for groups yet — the office has been told.", 503);
    }
    dbFail("group", error, true);
  }
  return { id, title };
}

// ── Changing a staff-made group ──────────────────────────────────────────

/** What the group screen shows a member of staff (readMessages → conversation.manage). */
export type GroupManage = {
  /** The group as this person read it; every change sends it back (409 if the group changed since). */
  rev: string;
  members: { id: string; name: string }[];
  creatorName: string;
  /** The maker has left (or was removed): only moderators can change it now. */
  creatorLeft: boolean;
  /** Rename, add / remove members, the class section: the maker (while in it) or a moderator. */
  canManage: boolean;
  /** Any member of staff in it, for themselves. */
  canLeave: boolean;
  /** "Class-Sec" of the group's section, or "". */
  sectionLabel: string;
  /** The caller's own staff id (their row in members). */
  me: string;
};

/**
 * The version of a group a change is made against: its staff, name and
 * section. Two people editing at once both send the version they read; the
 * second one's no longer matches → 409, nothing overwritten.
 */
export function groupRev(g: { staff_ids: string[]; title: string; class_id?: string; section_id?: string }): string {
  const key = JSON.stringify([[...g.staff_ids].sort(), g.title, g.class_id || "", g.section_id || ""]);
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

const isGroupMaker = (actor: Extract<ChatActor, { kind: "staff" }>, createdBy: string) => createdBy === `staff:${actor.staffId}`;

function groupManageFor(actor: Extract<ChatActor, { kind: "staff" }>, access: ConversationAccess, roster: ChatRoster): GroupManage {
  const makerId = access.createdBy.startsWith("staff:") ? access.createdBy.slice(6) : "";
  const member = access.staffIds.includes(actor.staffId);
  const creatorLeft = !makerId || !access.staffIds.includes(makerId);
  const name = (id: string) => (id === actor.staffId ? actor.name || staffName(roster, id) : roster.staff.find((s) => s.id === id)?.fullName || "Staff (no staff record)");
  return {
    rev: groupRev({ staff_ids: access.staffIds, title: access.title, class_id: access.section?.classId, section_id: access.section?.sectionId }),
    members: access.staffIds.map((id) => ({ id, name: name(id) })).sort((a, b) => a.name.localeCompare(b.name)),
    creatorName: makerId ? name(makerId) : "",
    creatorLeft,
    canManage: actor.moderator || (member && isGroupMaker(actor, access.createdBy)),
    canLeave: member,
    sectionLabel: access.section ? sectionLabel(roster, access.section.classId, access.section.sectionId) : "",
    me: actor.staffId,
  };
}

export type GroupOp = "rename" | "addStaff" | "removeStaff" | "setSection" | "clearSection" | "leave";
const GROUP_OPS: GroupOp[] = ["rename", "addStaff", "removeStaff", "setSection", "clearSection", "leave"];

const TOO_FEW = "A group needs at least two staff. Add someone else first, or ask a moderator to close it.";
const CHANGED = "This group was changed by someone else — reload it and try again.";

/**
 * Change a staff-made group (director, 30 Oct 2026: "after making chat
 * groups there is no option to edit the group and remove or add members").
 *
 *  - rename, addStaff, removeStaff, setSection, clearSection: the group's
 *    maker (while still in it) or a chat moderator; anyone else 403.
 *  - leave: any member of staff in it, for themselves. When the maker
 *    leaves, only moderators can change the group.
 *  - Staff added: active staff only (as createStaffGroup). A section: only
 *    one the person teaches, or a moderator (as createStaffGroup).
 *  - At least 2 staff, at most GROUP_MAX_STAFF (the DB check too).
 *  - One UPDATE, made only if the row still holds what this request read
 *    (staff, name, section) — and the caller's `rev` must be the version
 *    they saw. Otherwise 409, nothing changed.
 *  - Membership is read from staff_ids on every request, so whoever is
 *    removed loses read, send and push at once; whoever is added gains them.
 *  - Each change leaves a history line in the group ("Asha added Ravi"),
 *    best-effort: the change stands if the line cannot be written.
 */
export async function manageStaffGroup(
  ctx: ApiAuthContext,
  actor: ChatActor,
  input: { op?: unknown; conversationId?: unknown; rev?: unknown; title?: unknown; staffIds?: unknown; section?: unknown },
): Promise<{ id: string; title: string; rev: string; staffIds: string[]; section: { classId: string; sectionId: string } | null; left: boolean }> {
  if (actor.kind !== "staff") throw new ApiError("forbidden", "Only staff can change a group.", 403);
  const op = String(input.op ?? "") as GroupOp;
  if (!GROUP_OPS.includes(op)) throw new ApiError("bad_request", "Say what to change (rename, addStaff, removeStaff, setSection, clearSection or leave).", 400);
  const id = String(input.conversationId ?? "").trim();
  if (parseConversationId(id)?.kind !== "group") throw new ApiError("not_found", "No such group", 404);
  const rev = String(input.rev ?? "").trim();
  if (!rev) throw new ApiError("bad_request", "Reload the group first (rev missing).", 400);

  const t = await chatTenant();
  const row = await readConvRow(t, id);
  if (!row || row.kind !== "group") throw new ApiError("not_found", "No such group", 404);
  const member = row.staff_ids.includes(actor.staffId);
  if (op === "leave") {
    if (!member) throw new ApiError("bad_request", "You are not in this group.", 400);
  } else if (!actor.moderator && !(member && isGroupMaker(actor, row.created_by || ""))) {
    throw new ApiError("forbidden", "Only the staff member who made this group, or a chat moderator, can change it.", 403);
  }
  if (rev !== groupRev(row)) throw new ApiError("conflict", CHANGED, 409);

  const roster = await loadChatRoster(ctx, actor.ay);
  const who = (sid: string) => (sid === actor.staffId ? actor.name || staffName(roster, sid) : roster.staff.find((s) => s.id === sid)?.fullName || "a staff member");
  const me = actor.name || staffName(roster, actor.staffId);
  const picked = Array.isArray(input.staffIds) ? [...new Set(input.staffIds.map((x) => String(x ?? "").trim()).filter(Boolean))] : [];
  const names = (ids: string[]) => ids.map(who).join(", ");

  let staffIds = row.staff_ids;
  let title = row.title;
  let classId = row.class_id || "";
  let sectionId = row.section_id || "";
  let ay = row.academic_year_code || "";
  let note: string;
  switch (op) {
    case "rename": {
      title = String(input.title ?? "").replace(/\s+/g, " ").trim();
      if (!title) throw new ApiError("bad_request", "Give the group a name.", 400);
      if (title.length > 120) throw new ApiError("bad_request", "That name is too long (120 characters at most).", 400);
      if (title === row.title) throw new ApiError("bad_request", "That is already the group's name.", 400);
      note = `${me} renamed the group to "${title}"`;
      break;
    }
    case "addStaff": {
      const active = new Set(roster.staff.filter((s) => s.status !== "inactive").map((s) => s.id));
      const fresh = picked.filter((sid) => !row.staff_ids.includes(sid));
      if (!fresh.length) throw new ApiError("bad_request", picked.length ? "They are already in the group." : "Pick someone to add.", 400);
      for (const sid of fresh) if (!active.has(sid)) throw new ApiError("not_found", "One of the staff picked was not found (or has left).", 404);
      staffIds = [...row.staff_ids, ...fresh].sort();
      if (staffIds.length > GROUP_MAX_STAFF) throw new ApiError("bad_request", `A group can have ${GROUP_MAX_STAFF} staff at most.`, 400);
      note = `${me} added ${names(fresh)}`;
      break;
    }
    case "removeStaff": {
      if (!picked.length) throw new ApiError("bad_request", "Pick someone to remove.", 400);
      for (const sid of picked) if (!row.staff_ids.includes(sid)) throw new ApiError("bad_request", "One of them is not in the group.", 400);
      staffIds = row.staff_ids.filter((sid) => !picked.includes(sid));
      if (staffIds.length < 2) throw new ApiError("bad_request", TOO_FEW, 400);
      note = picked.length === 1 && picked[0] === actor.staffId ? `${me} left` : `${me} removed ${names(picked)}`;
      break;
    }
    case "leave": {
      staffIds = row.staff_ids.filter((sid) => sid !== actor.staffId);
      if (staffIds.length < 2) throw new ApiError("bad_request", TOO_FEW, 400);
      note = `${me} left`;
      break;
    }
    case "setSection": {
      const sec = (input.section ?? {}) as { classId?: unknown; sectionId?: unknown };
      classId = String(sec.classId ?? "");
      sectionId = String(sec.sectionId ?? "");
      const hit = groupSectionsFor(roster, actor.staffId, actor.moderator).find((x) => x.classId === classId && x.sectionId === sectionId);
      if (!hit) throw new ApiError("forbidden", "You can add only a class section you teach.", 403);
      if (classId === row.class_id && sectionId === row.section_id && ay === actor.ay) throw new ApiError("bad_request", "That is already the group's class section.", 400);
      ay = actor.ay;
      note = `${me} opened the group to ${hit.label} families (they can read it)`;
      break;
    }
    case "clearSection": {
      if (!row.class_id) throw new ApiError("bad_request", "This group has no class section.", 400);
      note = `${me} made the group staff only (${sectionLabel(roster, row.class_id, row.section_id || "")} families no longer see it)`;
      classId = "";
      sectionId = "";
      break;
    }
  }

  const now = new Date().toISOString();
  // One UPDATE, only if the row still holds exactly what was read above:
  // the same staff (as a set), name and section.
  const { data: upd, error } = await t.sb
    .from("school_chat_conversations")
    .update({ staff_ids: staffIds, title, class_id: classId, section_id: sectionId, academic_year_code: ay, last_message_at: now })
    .eq("tenant_id", t.tenantId)
    .eq("id", id)
    .eq("kind", "group")
    .contains("staff_ids", row.staff_ids)
    .containedBy("staff_ids", row.staff_ids)
    .eq("title", row.title)
    .eq("class_id", row.class_id || "")
    .eq("section_id", row.section_id || "")
    .select("id");
  if (error) {
    if (error.code === "23514") throw new ApiError("bad_request", TOO_FEW, 400);
    dbFail("group change", error, true);
  }
  if (!((upd ?? []) as { id: string }[]).length) throw new ApiError("conflict", CHANGED, 409);

  // The history line (best-effort; the change above already stands).
  const { error: nErr } = await t.sb.from("school_chat_messages").insert({
    tenant_id: t.tenantId,
    conversation_id: id,
    sender_kind: "staff",
    sender_id: GROUP_NOTE_SENDER,
    household_id: "",
    sender_label: "Group",
    body: note.slice(0, 2000),
    status: "visible",
    moderation: { by: "none", note: true, op, actor: actorKey(actor) },
    created_at: now,
  });
  if (nErr) console.warn(`[school-chat] group note not written (${op} on ${id}): ${nErr.message}`);

  const section = classId ? { classId, sectionId } : null;
  return { id, title, staffIds, section, rev: groupRev({ staff_ids: staffIds, title, class_id: classId, section_id: sectionId }), left: member && !staffIds.includes(actor.staffId) };
}

/** Who the caller can start a direct chat with. */
export async function chatContacts(
  ctx: ApiAuthContext,
  actor: ChatActor,
): Promise<{ staff: { id: string; name: string; role: string }[]; families: { studentId: string; label: string }[]; sections: { classId: string; sectionId: string; label: string }[] }> {
  const roster = await loadChatRoster(ctx, actor.ay);
  if (actor.kind === "family") {
    const { classId, sectionId } = actor.student;
    const sec = sectionGroups(roster, classId, sectionId);
    const role = (id: string) => {
      const cg = sec.find((g) => g.kind === "class");
      if (cg?.staffIds.includes(id)) return "Class teacher";
      const subs = sec.filter((g) => g.kind === "subject" && g.staffIds.includes(id)).map((g) => g.title.split(" · ")[1]);
      return subs.join(", ");
    };
    return {
      staff: staffForChild(roster, classId, sectionId).map((id) => ({ id, name: staffName(roster, id), role: role(id) })),
      families: [],
      sections: [],
    };
  }
  const staff = roster.staff
    .filter((s) => s.status !== "inactive" && s.id !== actor.staffId)
    .map((s) => ({ id: s.id, name: s.fullName, role: "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Families: the children of the sections this person is in a group of.
  const t = await chatTenant();
  const sections = new Map<string, { classId: string; sectionId: string }>();
  for (const g of staffGroups(roster, actor.staffId)) sections.set(`${g.classId}|${g.sectionId}`, { classId: g.classId, sectionId: g.sectionId });
  const families: { studentId: string; label: string }[] = [];
  for (const { classId, sectionId } of [...sections.values()].slice(0, 20)) {
    const label = sectionLabel(roster, classId, sectionId);
    for (const s of await sectionStudents(t, roster.ay, classId, sectionId)) families.push({ studentId: s.id, label: parentLabel(s.fullName, label) });
  }
  return { staff, families, sections: groupSectionsFor(roster, actor.staffId, actor.moderator) };
}

// ── Moderation ───────────────────────────────────────────────────────────

export function requireModerator(ctx: ApiAuthContext): Extract<ChatActor, { kind: "staff" }> {
  const staffId = isChatModerator(ctx) ? staffChatId(ctx) : "";
  if (!staffId) {
    throw new ApiError("forbidden", "Chat moderation needs the School chat moderation function (Masters → Roles).", 403);
  }
  return { kind: "staff", staffId, name: ctx.session.fullName, moderator: true, ay: staffWorkingYear(ctx) };
}

type Counts = { sent: number; held: number; removed: number; warned: number; flagged: number };
const zero = (): Counts => ({ sent: 0, held: 0, removed: 0, warned: 0, flagged: 0 });

async function behaviourCounts(t: Tenant, sinceIso: string): Promise<Map<string, Counts & { kind: string; id: string; categories: Record<string, number> }>> {
  const { data, error } = await t.sb
    .from("school_chat_moderation_log")
    .select("action, subject_kind, subject_id, categories")
    .eq("tenant_id", t.tenantId)
    .gte("created_at", sinceIso)
    .limit(10000);
  if (error) dbFail("moderation log", error);
  const out = new Map<string, Counts & { kind: string; id: string; categories: Record<string, number> }>();
  for (const r of (data ?? []) as { action: string; subject_kind: string; subject_id: string; categories: string[] }[]) {
    if (!r.subject_kind || !r.subject_id) continue;
    const key = `${r.subject_kind}:${r.subject_id}`;
    let c = out.get(key);
    if (!c) out.set(key, (c = { ...zero(), kind: r.subject_kind, id: r.subject_id, categories: {} }));
    if (r.action === "passed" || r.action.startsWith("held_") || r.action === "flagged_ai_unavailable") c.sent += 1;
    if (r.action.startsWith("held_")) c.held += 1;
    if (r.action === "remove") c.removed += 1;
    if (r.action === "warn") c.warned += 1;
    if (r.action === "flagged_ai_unavailable") c.flagged += 1;
    for (const cat of r.categories ?? []) c.categories[cat] = (c.categories[cat] || 0) + 1;
  }
  return out;
}

export type QueueItem = {
  id: string;
  conversationId: string;
  conversationTitle: string;
  senderLabel: string;
  senderKind: string;
  subjectKind: "staff" | "student" | "household";
  subjectId: string;
  householdId: string;
  body: string;
  status: "held" | "visible";
  flaggedStaff: boolean;
  categories: string[];
  reason: string;
  checkedBy: string;
  createdAt: string;
  urgent: boolean;
  history: Counts;
  repeat: boolean;
};

export async function moderationQueue(ctx: ApiAuthContext): Promise<{ items: QueueItem[] }> {
  requireModerator(ctx);
  const t = await chatTenant();
  const [{ data: held, error: hErr }, { data: flagged, error: fErr }] = await Promise.all([
    t.sb.from("school_chat_messages").select("id, conversation_id, sender_kind, sender_id, household_id, sender_label, body, status, moderation, created_at").eq("tenant_id", t.tenantId).eq("status", "held").order("created_at", { ascending: true }).limit(200),
    t.sb
      .from("school_chat_messages")
      .select("id, conversation_id, sender_kind, sender_id, household_id, sender_label, body, status, moderation, created_at")
      .eq("tenant_id", t.tenantId)
      .eq("status", "visible")
      .eq("review_decision", "")
      .eq("moderation->>flagged", "true")
      .order("created_at", { ascending: true })
      .limit(100),
  ]);
  if (hErr) dbFail("queue", hErr);
  if (fErr) dbFail("queue (flagged)", fErr);
  type Row = MsgRow & { conversation_id: string; moderation: { categories?: string[]; reason?: string; by?: string; flagged?: boolean } | null };
  const rows = [...((held ?? []) as Row[]), ...((flagged ?? []) as Row[])];
  const convIds = [...new Set(rows.map((r) => r.conversation_id))];
  const titles = new Map<string, string>();
  if (convIds.length) {
    const { data: convs, error } = await t.sb.from("school_chat_conversations").select("id, title").eq("tenant_id", t.tenantId).in("id", convIds);
    if (error) dbFail("queue titles", error);
    for (const c of (convs ?? []) as { id: string; title: string }[]) titles.set(c.id, c.title);
  }
  const counts = await behaviourCounts(t, new Date(Date.now() - 30 * 86400_000).toISOString());
  const items: QueueItem[] = rows.map((r) => {
    const subjectKind = (r.sender_kind === "parent" ? "household" : r.sender_kind) as QueueItem["subjectKind"];
    const c = counts.get(`${subjectKind}:${r.sender_id}`) ?? { ...zero(), categories: {} };
    const categories = r.moderation?.categories ?? [];
    return {
      id: r.id,
      conversationId: r.conversation_id,
      conversationTitle: titles.get(r.conversation_id) || r.conversation_id,
      senderLabel: r.sender_label,
      senderKind: r.sender_kind,
      subjectKind,
      subjectId: r.sender_id,
      householdId: r.household_id,
      body: r.body,
      status: r.status === "held" ? "held" : "visible",
      flaggedStaff: r.status === "visible",
      categories,
      reason: r.moderation?.reason || "",
      checkedBy: r.moderation?.by || "",
      createdAt: r.created_at,
      urgent: categories.includes("self_harm"),
      history: { sent: c.sent, held: c.held, removed: c.removed, warned: c.warned, flagged: c.flagged },
      repeat: isRepeatOffender(c),
    };
  });
  items.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.createdAt.localeCompare(b.createdAt));
  return { items };
}

export async function decideMessage(
  ctx: ApiAuthContext,
  messageId: string,
  decision: string,
  note: string,
): Promise<{ id: string; status: string }> {
  const mod = requireModerator(ctx);
  if (!["approve", "remove", "warn"].includes(decision)) throw new ApiError("bad_request", "Decision must be approve, remove or warn.", 400);
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) throw new ApiError("bad_request", "messageId required", 400);
  if (decision !== "approve" && note.trim().length < 3) throw new ApiError("bad_request", "Say why (a few words) — it is kept in the log.", 400);
  const t = await chatTenant();
  const { data, error } = await t.sb.rpc("school_chat_decide", {
    p_tenant: t.tenantId,
    p_message: messageId,
    p_decision: decision,
    p_actor: mod.staffId,
    p_actor_name: mod.name,
    p_note: note.trim().slice(0, 500),
  });
  if (error) dbFail("decide", error);
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; status: string; conversation_id: string } | undefined;
  if (!row?.id) throw new ApiError("conflict", "Someone has already decided this message — the queue has been refreshed.", 409);
  if (decision === "warn" || (decision === "approve" && row.status === "visible")) {
    // The decision is saved; a push problem never undoes it (best-effort, logged).
    const { data: m, error: mErr } = await t.sb
      .from("school_chat_messages")
      .select("household_id, sender_kind, sender_id, sender_label, body")
      .eq("tenant_id", t.tenantId)
      .eq("id", row.id)
      .maybeSingle();
    if (mErr) console.warn("[school-chat] decided message not re-read — no push:", mErr.message);
    const msg = m as { household_id: string; sender_kind: string; sender_id: string; sender_label: string; body: string } | null;
    if (msg && decision === "warn")
      void notifySchoolChat({
        kind: "warning",
        conversationId: row.conversation_id,
        title: "School chat",
        senderLabel: "",
        preview: "",
        urgent: false,
        flagged: false,
        staffIds: msg.sender_kind === "staff" ? [msg.sender_id] : [],
        group: null,
        ay: mod.ay,
        householdIds: msg.household_id ? [msg.household_id] : [],
        exceptHousehold: "",
        ctx,
        loadSection: async () => [],
        loadBlocks: (s) => activeBlocksFor(t, s),
      });
    if (msg && decision === "approve") {
      await pushApproved(ctx, t, row.conversation_id, msg).catch((e) => {
        console.warn("[school-chat] approved message not pushed:", e instanceof Error ? e.message : e);
      });
    }
  }
  return { id: row.id, status: row.status };
}

/**
 * An approved message reaches the conversation's members exactly like a
 * normal post: the same push, the same block filter (pushAudience), the
 * sender left out.
 */
async function pushApproved(
  ctx: ApiAuthContext,
  t: Tenant,
  conversationId: string,
  msg: { household_id: string; sender_kind: string; sender_id: string; sender_label: string; body: string },
): Promise<void> {
  const parsed = parseConversationId(conversationId);
  if (!parsed) return;
  const fromStaff = msg.sender_kind === "staff";
  let title = "";
  let staffIds: string[] = [];
  let group: { classId: string; sectionId: string } | null = null;
  let householdIds: string[] = [];
  let ay = "";
  if (parsed.kind === "class" || parsed.kind === "subject") {
    const roster = await loadChatRoster(ctx, parsed.ay);
    const g = groupFor(roster, parsed);
    if (!g) return; // the group no longer exists on this roster: nobody to push
    group = g;
    title = g.title;
    staffIds = g.staffIds;
    ay = roster.ay;
  } else {
    const conv = await readConvRow(t, conversationId);
    if (!conv) return;
    title = conv.title;
    staffIds = conv.staff_ids;
    householdIds = conv.kind === "dm_parent" && fromStaff ? [conv.household_id] : [];
    if (conv.kind === "group" && conv.class_id && conv.section_id) {
      group = { classId: conv.class_id, sectionId: conv.section_id };
      ay = conv.academic_year_code || "";
    }
  }
  await notifySchoolChat({
    kind: "message",
    conversationId,
    title,
    senderLabel: msg.sender_label,
    preview: msg.body,
    urgent: false,
    flagged: false,
    staffIds: staffIds.filter((id) => !(fromStaff && id === msg.sender_id)),
    group,
    ay,
    householdIds,
    exceptHousehold: fromStaff ? "" : msg.household_id,
    ctx,
    loadSection: (classId, sectionId) => sectionStudents(t, ay, classId, sectionId),
    loadBlocks: (s) => activeBlocksFor(t, s),
  });
}

export async function listBlocks(ctx: ApiAuthContext, includeLifted: boolean): Promise<{ blocks: (ChatBlock & { liftedAt: string | null; liftReason: string })[] }> {
  requireModerator(ctx);
  const t = await chatTenant();
  let q = t.sb
    .from("school_chat_blocks")
    .select("id, subject_kind, subject_id, mode, conversation_id, reason, created_at, created_by_name, lifted_at, lift_reason")
    .eq("tenant_id", t.tenantId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (!includeLifted) q = q.is("lifted_at", null);
  const { data, error } = await q;
  if (error) dbFail("blocks", error);
  return { blocks: ((data ?? []) as BlockRow[]).map((r) => ({ ...toBlock(r), liftedAt: r.lifted_at ?? null, liftReason: r.lift_reason ?? "" })) };
}

export async function setBlock(
  ctx: ApiAuthContext,
  input: { subjectKind: string; subjectId: string; mode: string; conversationId?: string; reason: string },
): Promise<{ id: string }> {
  const mod = requireModerator(ctx);
  const kind = input.subjectKind;
  if (kind !== "staff" && kind !== "student" && kind !== "household") throw new ApiError("bad_request", "Who: staff, student or household.", 400);
  if (input.mode !== "mute" && input.mode !== "block") throw new ApiError("bad_request", "Mode: mute or block.", 400);
  const subjectId = String(input.subjectId || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(subjectId)) throw new ApiError("bad_request", "Who to mute or block (subjectId).", 400);
  const reason = String(input.reason || "").trim();
  if (reason.length < 3) throw new ApiError("bad_request", "Say why (a few words) — it is kept in the log.", 400);
  if (kind === "staff" && subjectId === mod.staffId) throw new ApiError("bad_request", "You cannot mute or block yourself.", 400);
  const conversationId = String(input.conversationId || "").trim();
  if (conversationId && !parseConversationId(conversationId)) throw new ApiError("bad_request", "Unknown conversation.", 400);
  const t = await chatTenant();
  // The block and its log row in one transaction (school_chat_set_block): a
  // block that could not be logged is not made.
  const { data, error } = await t.sb.rpc("school_chat_set_block", {
    p_tenant: t.tenantId,
    p_subject_kind: kind,
    p_subject_id: subjectId,
    p_mode: input.mode,
    p_conversation: conversationId,
    p_reason: reason.slice(0, 500),
    p_actor: mod.staffId,
    p_actor_name: mod.name,
  });
  if (error) dbFail("block", error, true);
  const row = (Array.isArray(data) ? data[0] : data) as { id: string } | undefined;
  if (!row?.id) throw new ApiError("server_error", "The mute / block was not saved — please try again.", 503);
  return { id: row.id };
}

export async function liftBlock(ctx: ApiAuthContext, blockId: string, reason: string): Promise<{ id: string }> {
  const mod = requireModerator(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(blockId)) throw new ApiError("bad_request", "blockId required", 400);
  const t = await chatTenant();
  // The lift and its log row in one transaction (school_chat_lift_block).
  const { data, error } = await t.sb.rpc("school_chat_lift_block", {
    p_tenant: t.tenantId,
    p_block: blockId,
    p_actor: mod.staffId,
    p_actor_name: mod.name,
    p_reason: reason.trim().slice(0, 500),
  });
  if (error) dbFail("lift", error, true);
  const row = (Array.isArray(data) ? data[0] : data) as { id: string } | undefined;
  if (!row?.id) throw new ApiError("conflict", "That mute / block was already lifted.", 409);
  return { id: row.id };
}

export type BehaviourRow = Counts & { kind: string; id: string; label: string; categories: Record<string, number>; repeat: boolean; activeBlock: string };

/** Per-person counts for the last `days` days (the principal's weekly view). */
export async function behaviourSummary(days: number): Promise<{ days: number; since: string; totals: Counts; people: BehaviourRow[] }> {
  const t = await chatTenant();
  const d = Math.max(1, Math.min(90, Math.floor(days) || 7));
  const since = new Date(Date.now() - d * 86400_000).toISOString();
  const counts = await behaviourCounts(t, since);
  const ids = [...new Set([...counts.values()].map((c) => c.id))];
  const labels = new Map<string, string>();
  const blocks = new Map<string, string>();
  if (ids.length) {
    const [{ data: msgs, error: mErr }, { data: bl, error: bErr }] = await Promise.all([
      t.sb.from("school_chat_messages").select("sender_kind, sender_id, sender_label").eq("tenant_id", t.tenantId).in("sender_id", ids.slice(0, 500)).order("created_at", { ascending: false }).limit(2000),
      t.sb.from("school_chat_blocks").select("subject_kind, subject_id, mode, conversation_id").eq("tenant_id", t.tenantId).is("lifted_at", null).in("subject_id", ids.slice(0, 500)),
    ]);
    if (mErr) dbFail("labels", mErr);
    if (bErr) dbFail("blocks", bErr);
    for (const m of (msgs ?? []) as { sender_kind: string; sender_id: string; sender_label: string }[]) {
      const k = `${m.sender_kind === "parent" ? "household" : m.sender_kind}:${m.sender_id}`;
      if (!labels.has(k)) labels.set(k, m.sender_label);
    }
    for (const b of (bl ?? []) as { subject_kind: string; subject_id: string; mode: string; conversation_id: string }[]) {
      blocks.set(`${b.subject_kind}:${b.subject_id}`, `${b.mode}${b.conversation_id ? " (one chat)" : " (school-wide)"}`);
    }
  }
  const totals = zero();
  const people: BehaviourRow[] = [];
  for (const [key, c] of counts) {
    totals.sent += c.sent;
    totals.held += c.held;
    totals.removed += c.removed;
    totals.warned += c.warned;
    totals.flagged += c.flagged;
    if (c.held + c.removed + c.warned + c.flagged === 0 && !blocks.has(key)) continue;
    people.push({ ...c, label: labels.get(key) || `${c.kind} ${c.id}`, repeat: isRepeatOffender(c), activeBlock: blocks.get(key) || "" });
  }
  people.sort((a, b) => Number(b.repeat) - Number(a.repeat) || b.removed + b.warned + b.held - (a.removed + a.warned + a.held));
  return { days: d, since, totals, people };
}

/** Staff who may moderate (discipline.approve), worked out from the roster without a session. */
export function chatModeratorStaffIds(masters: MastersState, rbac: RbacState, ay: string): string[] {
  const out: string[] = [];
  for (const s of masters.staff ?? []) {
    if (s.status === "inactive") continue;
    try {
      const roleCode = staffRoleCodeFor({ fullName: s.fullName, staffId: s.id }, masters, "teacher", rbac);
      const session = { persona: "staff" as const, fullName: s.fullName, roleCode, staffId: s.id, tenantSlug: "", academicYearCode: ay };
      if (hasFeaturePermission(session, masters, CHAT_MODERATE_FEATURE, "approve", rbac)) out.push(s.id);
    } catch {
      /* not a moderator */
    }
  }
  return out;
}

