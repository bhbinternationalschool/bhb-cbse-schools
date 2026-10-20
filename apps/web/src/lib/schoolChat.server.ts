import "server-only";

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
 *  - A child's / family's message is checked before it is stored as
 *    visible; any failure of the check holds it (lib/schoolChatModeration.ts).
 *  - Every check and decision is logged with the original text.
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
import {
  allGroups,
  blockVerdict,
  groupFor,
  isRepeatOffender,
  parentDmId,
  parentLabel,
  parseConversationId,
  sectionGroups,
  sectionLabel,
  staffDmId,
  staffForChild,
  staffGroups,
  staffLabel,
  studentLabel,
  type ChatBlock,
  type ChatRoster,
  type ChatSubject,
  type GroupRef,
  type ParsedConversation,
} from "@/lib/schoolChat";
import { heldNotice, moderateMessage, type Classifier, type ModerationOutcome } from "@/lib/schoolChatModeration";
import { notifySchoolChat } from "@/lib/schoolChatNotify.server";

type Sb = NonNullable<Awaited<ReturnType<typeof getServerTenantContext>>>["sb"];
type Tenant = { sb: Sb; tenantId: string };

const NOT_SET_UP = "School chat is not set up on the server yet — the office has been told.";

export async function chatTenant(): Promise<Tenant> {
  const t = await getServerTenantContext();
  if (!t) throw new ApiError("server_error", "Could not reach the school database — please try again.", 503);
  return t;
}

/** A database error: a missing table is "not set up"; anything else is a 503. */
function dbFail(where: string, error: { message?: string; code?: string } | null): never {
  const msg = error?.message || "unknown";
  console.error(`[school-chat] ${where}: ${msg}`);
  if (error?.code === "42P01" || error?.code === "PGRST205" || /does not exist|schema cache/i.test(msg)) {
    throw new ApiError("server_error", NOT_SET_UP, 503);
  }
  throw new ApiError("server_error", "Could not read the chat — please try again.", 503);
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
    const staffId = ctx.session.staffId || "";
    if (!staffId) throw new ApiError("forbidden", "Sign in with your staff login to use school chat.", 403);
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
};

export type ConversationAccess = {
  id: string;
  kind: ParsedConversation["kind"];
  title: string;
  /** Staff who belong to it (push). */
  staffIds: string[];
  /** The group, for class / subject. */
  group: GroupRef | null;
  /** dm_parent: the family + child. */
  householdId: string;
  studentId: string;
  /** true = a moderator looking in, not a member. */
  oversight: boolean;
  /** How the caller speaks here. */
  speakAs: "staff" | "student" | "parent";
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
    .select("id, kind, staff_ids, household_id, student_id, title, last_message_at")
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
      access: { id: group.id, kind: group.kind, title: group.title, staffIds: group.staffIds, group, householdId: "", studentId: "", oversight, speakAs },
    };
  }

  const row = await readConvRow(t, conversationId);
  if (!row) throw new ApiError("not_found", "No such conversation", 404);
  if (parsed.kind === "dm_staff") {
    if (actor.kind !== "staff") refuse();
    const a = actor as Extract<ChatActor, { kind: "staff" }>;
    const member = row.staff_ids.includes(a.staffId);
    if (!member && !a.moderator) refuse();
    const other = row.staff_ids.find((id) => id !== a.staffId) || row.staff_ids[0]!;
    return {
      roster,
      access: { id: row.id, kind: "dm_staff", title: member ? staffName(roster, other) : row.title, staffIds: row.staff_ids, group: null, householdId: "", studentId: "", oversight: !member, speakAs: "staff" },
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
      householdId: row.household_id,
      studentId: row.student_id,
      oversight,
      speakAs: actor.kind === "family" ? "parent" : "staff",
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

  // Direct chats.
  let dmq = t.sb
    .from("school_chat_conversations")
    .select("id, kind, staff_ids, household_id, student_id, title, last_message_at")
    .eq("tenant_id", t.tenantId)
    .in("kind", ["dm_staff", "dm_parent"])
    .limit(300);
  dmq = actor.kind === "family" ? dmq.eq("household_id", actor.householdId).eq("student_id", actor.student.id) : dmq.contains("staff_ids", [actor.staffId]);
  const { data: dms, error: dmErr } = await dmq;
  if (dmErr) dbFail("direct chats", dmErr);

  const items: { id: string; kind: ParsedConversation["kind"]; title: string; oversight: boolean }[] = [
    ...groups.map((g) => ({ id: g.id, kind: g.kind, title: g.title, oversight: oversightIds.has(g.id) })),
    ...((dms ?? []) as ConvRow[]).map((r) => ({
      id: r.id,
      kind: r.kind as ParsedConversation["kind"],
      title:
        actor.kind === "family"
          ? staffName(roster, r.staff_ids[0]!)
          : r.kind === "dm_staff"
            ? staffName(roster, r.staff_ids.find((id) => id !== actor.staffId) || "")
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
      if (!mine && m.created_at > (readAt.get(m.conversation_id) || "")) unread.set(m.conversation_id, (unread.get(m.conversation_id) || 0) + 1);
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
};

function isMine(actor: ChatActor, m: Pick<MsgRow, "sender_kind" | "sender_id" | "household_id">): boolean {
  return actor.kind === "staff" ? m.sender_kind === "staff" && m.sender_id === actor.staffId : m.sender_kind !== "staff" && m.household_id === actor.householdId;
}

export async function readMessages(
  ctx: ApiAuthContext,
  actor: ChatActor,
  conversationId: string,
): Promise<{ conversation: ConversationAccess & { canSend: boolean; muted: boolean; moderator: boolean }; messages: ChatMessageOut[] }> {
  const t = await chatTenant();
  const { access } = await accessConversation(ctx, t, actor, conversationId);
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
  for (const m of rows) {
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
      ...(m.status === "held" ? { notice: mine ? heldNotice(m.moderation?.categories ?? []) : "Held for review — only you (a moderator) and the sender see it." } : {}),
    });
  }
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
  return { conversation: { ...access, canSend: verdict.canSend && !access.oversight, muted: !verdict.canSend, moderator: seeAll }, messages };
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
    const timeout = new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: `no answer in ${AI_TIMEOUT_MS / 1000} s` }), AI_TIMEOUT_MS),
    );
    const r = await Promise.race([generateChatModerationJson({ text, where, requester }), timeout]);
    return r.ok ? { ok: true, verdict: r.verdict, engine: r.engine, generationId: r.generationId } : { ok: false, error: r.error };
  };
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
  const asParent = access.speakAs === "parent";
  const subjects = subjectsOf(actor, asParent);
  const verdict = blockVerdict(await activeBlocksFor(t, subjects), subjects, access.id);
  if (!verdict.canSend) {
    const subject = subjects[0]!;
    await t.sb.from("school_chat_moderation_log").insert({
      tenant_id: t.tenantId,
      conversation_id: access.id,
      action: "send_refused",
      subject_kind: subject.kind,
      subject_id: subject.id,
      reason: verdict.by ? `${verdict.by.mode}: ${verdict.by.reason}` : "",
      original_text: body,
    });
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
  const outcome: ModerationOutcome = await moderateMessage(body, {
    sender,
    where: access.title,
    classify: e2eStub() ?? routerClassifier(requester),
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
    group: access.group,
    ay: roster.ay,
    householdIds: access.kind === "dm_parent" && actor.kind === "staff" ? [access.householdId] : [],
    exceptHousehold: actor.kind === "family" ? actor.householdId : "",
    ctx,
    loadSection: (classId, sectionId) => sectionStudents(t, roster.ay, classId, sectionId),
  });

  return {
    held,
    notice: held ? heldNotice(outcome.categories) : null,
    message: {
      id: row.id,
      senderLabel: label,
      senderKind: sender,
      body,
      createdAt: row.created_at,
      mine: true,
      status: outcome.status,
      ...(held ? { notice: heldNotice(outcome.categories) } : {}),
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
      title: `${staffName(roster, pair[0]!)} · ${staffName(roster, pair[1]!)}`,
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

/** Who the caller can start a direct chat with. */
export async function chatContacts(
  ctx: ApiAuthContext,
  actor: ChatActor,
): Promise<{ staff: { id: string; name: string; role: string }[]; families: { studentId: string; label: string }[] }> {
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
  return { staff, families };
}

// ── Moderation ───────────────────────────────────────────────────────────

export function requireModerator(ctx: ApiAuthContext): Extract<ChatActor, { kind: "staff" }> {
  if (!isChatModerator(ctx) || !ctx.session.staffId) {
    throw new ApiError("forbidden", "Chat moderation needs the School chat moderation function (Masters → Roles).", 403);
  }
  return { kind: "staff", staffId: ctx.session.staffId, name: ctx.session.fullName, moderator: true, ay: staffWorkingYear(ctx) };
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
    if (r.action === "passed" || r.action.startsWith("held_") || r.action === "flagged_staff") c.sent += 1;
    if (r.action.startsWith("held_")) c.held += 1;
    if (r.action === "remove") c.removed += 1;
    if (r.action === "warn") c.warned += 1;
    if (r.action === "flagged_staff") c.flagged += 1;
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
  if (decision === "warn") {
    const { data: m } = await t.sb.from("school_chat_messages").select("household_id, sender_kind, sender_id").eq("id", row.id).maybeSingle();
    const msg = m as { household_id: string; sender_kind: string; sender_id: string } | null;
    if (msg)
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
      });
  }
  return { id: row.id, status: row.status };
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
  const { data, error } = await t.sb
    .from("school_chat_blocks")
    .insert({
      tenant_id: t.tenantId,
      subject_kind: kind,
      subject_id: subjectId,
      mode: input.mode,
      conversation_id: conversationId,
      reason: reason.slice(0, 500),
      created_by: mod.staffId,
      created_by_name: mod.name,
    })
    .select("id")
    .single();
  if (error) dbFail("block", error);
  await t.sb.from("school_chat_moderation_log").insert({
    tenant_id: t.tenantId,
    conversation_id: conversationId,
    action: input.mode,
    actor: mod.staffId,
    actor_name: mod.name,
    subject_kind: kind,
    subject_id: subjectId,
    reason: reason.slice(0, 500),
  });
  return { id: (data as { id: string }).id };
}

export async function liftBlock(ctx: ApiAuthContext, blockId: string, reason: string): Promise<{ id: string }> {
  const mod = requireModerator(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(blockId)) throw new ApiError("bad_request", "blockId required", 400);
  const t = await chatTenant();
  const { data, error } = await t.sb
    .from("school_chat_blocks")
    .update({ lifted_at: new Date().toISOString(), lifted_by: mod.staffId, lift_reason: reason.trim().slice(0, 500) })
    .eq("tenant_id", t.tenantId)
    .eq("id", blockId)
    .is("lifted_at", null)
    .select("id, subject_kind, subject_id, mode, conversation_id")
    .maybeSingle();
  if (error) dbFail("lift", error);
  const row = data as { id: string; subject_kind: string; subject_id: string; mode: string; conversation_id: string } | null;
  if (!row) throw new ApiError("conflict", "That mute / block was already lifted.", 409);
  await t.sb.from("school_chat_moderation_log").insert({
    tenant_id: t.tenantId,
    conversation_id: row.conversation_id,
    action: row.mode === "mute" ? "unmute" : "unblock",
    actor: mod.staffId,
    actor_name: mod.name,
    subject_kind: row.subject_kind,
    subject_id: row.subject_id,
    reason: reason.trim().slice(0, 500),
  });
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

