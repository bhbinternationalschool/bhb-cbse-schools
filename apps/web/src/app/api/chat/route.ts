import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  actorCanPost,
  findOrCreateClassAnnouncement,
  findOrCreateStaffDm,
  findOrCreateStaffParentDm,
  normalizeErpChatState,
  threadsForActor,
  type ErpChatState,
} from "@/lib/erpChat";
import {
  canCreateClassAnnouncement,
  canParentChatWithStaff,
  canStaffChatWithParent,
  resolveChatActor,
  staffAllowedParentContacts,
  staffAllowedSections,
} from "@/lib/erpChatAccess";
import {
  loadErpChatServer,
  mergeErpChatServer,
  saveErpChatServer,
} from "@/lib/erpChatServer";
import { DEFAULT_AY, type MastersState } from "@/lib/masters";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";
import type { SisState } from "@/lib/sis";

export const runtime = "nodejs";

function filterStateForActor(
  state: ErpChatState,
  actorKey: string,
): ErpChatState {
  const threads = threadsForActor(actorKey, state);
  const ids = new Set(threads.map((t) => t.id));
  return {
    version: 2,
    threads,
    messages: state.messages.filter((m) => ids.has(m.threadId)),
  };
}

function mirrorMasters(raw: unknown): MastersState | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as MastersState;
}

function mirrorSis(raw: unknown): SisState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return raw as SisState;
}

export async function GET() {
  const session = await getDemoSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const mirror = await ensureSchoolMirrorLoaded();
  const masters = mirrorMasters(mirror.masters);
  if (!masters) {
    return NextResponse.json({
      ok: true,
      state: { version: 2, threads: [], messages: [] },
      warning: "School mirror empty — open ERP once to sync masters/SIS",
    });
  }
  const actor = resolveChatActor(session, masters, mirrorSis(mirror.sis));
  if (!actor) {
    return NextResponse.json(
      { error: "Could not resolve chat identity" },
      { status: 403 },
    );
  }
  const state = await loadErpChatServer();
  return NextResponse.json({
    ok: true,
    actor,
    state: filterStateForActor(state, actor.key),
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    action?: string;
    state?: unknown;
    threadId?: string;
    text?: string;
    peerStaffId?: string;
    householdId?: string;
    staffId?: string;
    sectionId?: string;
    title?: string;
    memberStaffIds?: string[];
    academicYearCode?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mirror = await ensureSchoolMirrorLoaded();
  const masters = mirrorMasters(mirror.masters);
  const sis = mirrorSis(mirror.sis);
  if (!masters) {
    return NextResponse.json(
      { error: "School data not mirrored yet" },
      { status: 503 },
    );
  }

  const actor = resolveChatActor(session, masters, sis);
  if (!actor) {
    return NextResponse.json(
      { error: "Could not resolve chat identity" },
      { status: 403 },
    );
  }

  const ay =
    body.academicYearCode?.trim() ||
    session.academicYearCode ||
    DEFAULT_AY;

  const action = body.action || "";

  if (action === "sync") {
    const incoming = normalizeErpChatState(body.state);
    const merged = await mergeErpChatServer(incoming);
    return NextResponse.json({
      ok: true,
      actor,
      state: filterStateForActor(merged, actor.key),
    });
  }

  if (action === "mark_read") {
    if (!body.threadId) {
      return NextResponse.json({ error: "threadId required" }, { status: 400 });
    }
    let state = await loadErpChatServer();
    const messages = state.messages.map((m) => {
      if (m.threadId !== body.threadId) return m;
      if (m.fromActorKey === actor.key) return m;
      if (m.readBy.includes(actor.key)) return m;
      return { ...m, readBy: [...m.readBy, actor.key] };
    });
    state = await saveErpChatServer({ ...state, messages });
    return NextResponse.json({
      ok: true,
      state: filterStateForActor(state, actor.key),
    });
  }

  if (action === "send") {
    if (!body.threadId || !body.text?.trim()) {
      return NextResponse.json(
        { error: "threadId and text required" },
        { status: 400 },
      );
    }
    let state = await loadErpChatServer();
    const thread = state.threads.find((t) => t.id === body.threadId);
    if (!thread || !thread.participantIds.includes(actor.key)) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    if (!actorCanPost(thread, actor.key)) {
      return NextResponse.json(
        { error: "You cannot post in this chat" },
        { status: 403 },
      );
    }
    const at = new Date().toISOString();
    const message = {
      id: `ecm_${Math.random().toString(36).slice(2, 10)}`,
      threadId: thread.id,
      fromActorKey: actor.key,
      fromActorKind: actor.kind,
      text: body.text.trim().slice(0, 4000),
      at,
      readBy: [actor.key],
    };
    const updatedThread = { ...thread, updatedAt: at };
    state = await saveErpChatServer({
      ...state,
      threads: [
        updatedThread,
        ...state.threads.filter((t) => t.id !== thread.id),
      ],
      messages: [...state.messages, message],
    });
    return NextResponse.json({
      ok: true,
      message,
      state: filterStateForActor(state, actor.key),
    });
  }

  if (action === "open_staff_dm") {
    if (actor.kind !== "staff" || !actor.staffId) {
      return NextResponse.json({ error: "Staff only" }, { status: 403 });
    }
    if (!body.peerStaffId) {
      return NextResponse.json(
        { error: "peerStaffId required" },
        { status: 400 },
      );
    }
    let state = await loadErpChatServer();
    const r = findOrCreateStaffDm(actor.staffId, body.peerStaffId, state);
    state = await saveErpChatServer(r.state);
    return NextResponse.json({
      ok: true,
      thread: r.thread,
      state: filterStateForActor(state, actor.key),
    });
  }

  if (action === "open_parent_dm") {
    const householdId = body.householdId || actor.householdId;
    const staffId =
      body.staffId || (actor.kind === "staff" ? actor.staffId : undefined);
    if (!householdId || !staffId) {
      return NextResponse.json(
        { error: "householdId and staffId required" },
        { status: 400 },
      );
    }
    if (actor.kind === "staff") {
      if (!canStaffChatWithParent(actor, householdId, masters, ay, sis)) {
        return NextResponse.json(
          { error: "No access to this parent" },
          { status: 403 },
        );
      }
    } else if (actor.kind === "parent") {
      if (actor.householdId !== householdId) {
        return NextResponse.json(
          { error: "Not your household" },
          { status: 403 },
        );
      }
      if (!canParentChatWithStaff(householdId, staffId, masters, ay, sis)) {
        return NextResponse.json(
          { error: "Teacher not assigned" },
          { status: 403 },
        );
      }
    }
    let state = await loadErpChatServer();
    const r = findOrCreateStaffParentDm({
      staffId,
      householdId,
      academicYearCode: ay,
      state,
    });
    state = await saveErpChatServer(r.state);
    return NextResponse.json({
      ok: true,
      thread: r.thread,
      state: filterStateForActor(state, actor.key),
    });
  }

  if (action === "create_group") {
    if (actor.kind !== "staff" || !actor.staffId) {
      return NextResponse.json({ error: "Staff only" }, { status: 403 });
    }
    const title = (body.title || "").trim().slice(0, 120);
    const members = [
      ...new Set(
        [actor.staffId, ...(body.memberStaffIds || [])].filter(Boolean),
      ),
    ];
    if (!title) {
      return NextResponse.json(
        { error: "Group name required" },
        { status: 400 },
      );
    }
    if (members.length < 2) {
      return NextResponse.json(
        { error: "Add at least one other staff member" },
        { status: 400 },
      );
    }
    let state = await loadErpChatServer();
    const now = new Date().toISOString();
    const thread = {
      id: `grp_${Math.random().toString(36).slice(2, 10)}`,
      kind: "staff_group" as const,
      title,
      participantIds: [...members].sort(),
      participants: members.map((id) => ({
        actorKey: id,
        actorKind: "staff" as const,
        canPost: true,
      })),
      classId: "",
      sectionId: "",
      householdId: "",
      academicYearCode: ay,
      createdBy: actor.staffId,
      updatedAt: now,
      createdAt: now,
    };
    state = await saveErpChatServer({
      ...state,
      threads: [thread, ...state.threads],
    });
    return NextResponse.json({
      ok: true,
      thread,
      state: filterStateForActor(state, actor.key),
    });
  }

  if (action === "open_announcement") {
    if (actor.kind !== "staff" || !actor.staffId) {
      return NextResponse.json({ error: "Staff only" }, { status: 403 });
    }
    if (!body.sectionId) {
      return NextResponse.json(
        { error: "sectionId required" },
        { status: 400 },
      );
    }
    if (!canCreateClassAnnouncement(actor, body.sectionId, masters, ay)) {
      return NextResponse.json(
        { error: "Section not assigned" },
        { status: 403 },
      );
    }
    const staff = (masters.staff ?? []).find((s) => s.id === actor.staffId);
    const section = staffAllowedSections(
      staff,
      masters,
      ay,
      actor.roleCodes,
    ).find((s) => s.sectionId === body.sectionId);
    if (!section) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }
    const parents = staffAllowedParentContacts(actor, masters, ay, sis).filter(
      (p) => p.sectionIds.includes(body.sectionId!),
    );
    let state = await loadErpChatServer();
    const r = findOrCreateClassAnnouncement({
      section,
      academicYearCode: ay,
      createdBy: actor.staffId,
      parentHouseholdIds: parents.map((p) => p.householdId),
      state,
    });
    if (!r.thread.participantIds.includes(actor.staffId)) {
      const participants = [
        ...r.thread.participants,
        {
          actorKey: actor.staffId,
          actorKind: "staff" as const,
          canPost: true,
        },
      ];
      const thread = {
        ...r.thread,
        participants,
        participantIds: [
          ...new Set([...r.thread.participantIds, actor.staffId]),
        ].sort(),
      };
      state = await saveErpChatServer({
        ...r.state,
        threads: [thread, ...r.state.threads.filter((t) => t.id !== thread.id)],
      });
      return NextResponse.json({
        ok: true,
        thread,
        state: filterStateForActor(state, actor.key),
      });
    }
    state = await saveErpChatServer(r.state);
    return NextResponse.json({
      ok: true,
      thread: r.thread,
      state: filterStateForActor(state, actor.key),
    });
  }

  if (action === "directory") {
    if (actor.kind === "staff") {
      const parents = staffAllowedParentContacts(actor, masters, ay, sis);
      const sections = staffAllowedSections(
        (masters.staff ?? []).find((s) => s.id === actor.staffId),
        masters,
        ay,
        actor.roleCodes,
      );
      return NextResponse.json({ ok: true, actor, parents, sections });
    }
    return NextResponse.json({
      ok: true,
      actor,
      parents: [],
      sections: [],
    });
  }

  return NextResponse.json(
    { error: `Unknown action: ${action}` },
    { status: 400 },
  );
}
