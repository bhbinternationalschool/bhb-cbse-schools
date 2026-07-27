/**
 * Class WhatsApp channels — ERP-managed (not Meta groups).
 * Teachers post → draft → YES confirms → fills ERP modules + broadcasts to parents/teachers.
 */

import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { listSectionParentContacts } from "@/lib/homework";
import { loadSis } from "@/lib/sis";
import {
  resolveClassTeachers,
  resolveSubjectTeachers,
} from "@/lib/staffResolve";
import { TENANT } from "@/lib/types";
import {
  classChannelHelpText,
  detectClassChannelIntent,
  type ClassChannelIntentKind,
  type ClassChannelParsed,
} from "@/lib/waClassChannelEngine";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";
import type { StaffRecord } from "@/lib/foundationMasters";

export type ClassChannelMemberRole =
  | "class_teacher"
  | "subject_teacher"
  | "parent";

export type ClassChannelMember = {
  role: ClassChannelMemberRole;
  name: string;
  mobile: string;
  staffId?: string;
  householdId?: string;
  subjectId?: string;
};

export type ClassChannelDraft = {
  id: string;
  channelId: string;
  kind: ClassChannelIntentKind;
  title: string;
  body: string;
  subjectId: string;
  subjectName: string;
  dueAt: string;
  eventDate: string;
  mediaNote: string;
  status: "pending" | "confirmed" | "cancelled" | "applied";
  createdAt: string;
  createdByStaffId: string;
  createdByName: string;
  createdByMobile: string;
  confirmedAt: string;
  broadcastCount: number;
  /** Client applies to homework/notices when confirmed */
  erpTarget: "homework" | "notice" | "none";
};

export type ClassChannel = {
  id: string;
  academicYearCode: string;
  classId: string;
  sectionId: string;
  label: string;
  members: ClassChannelMember[];
  updatedAt: string;
};

export type ClassChannelMsg = {
  id: string;
  role: "teacher" | "bot" | "office";
  text: string;
  at: string;
  by: string;
  waMessageId?: string;
  draftId?: string;
};

export type ClassChannelThread = {
  id: string;
  channelId: string;
  staffId: string;
  staffName: string;
  mobile: string;
  messages: ClassChannelMsg[];
  pendingDraftId: string;
  updatedAt: string;
  unreadOffice: number;
};

type Store = {
  version: 1;
  channels: ClassChannel[];
  drafts: ClassChannelDraft[];
  threads: ClassChannelThread[];
};

const DATA_FILE = path.join(process.cwd(), ".data", "wa_class_channels.json");
let memory: Store = { version: 1, channels: [], drafts: [], threads: [] };

function nid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso() {
  return new Date().toISOString();
}

async function readStore(): Promise<Store> {
  const { loadWaBotSlice } = await import("@/lib/waBotStore.server");
  const remote = await loadWaBotSlice<Store>("classChannel", memory);
  if (remote?.version === 1) {
    memory = {
      version: 1,
      channels: Array.isArray(remote.channels) ? remote.channels : [],
      drafts: Array.isArray(remote.drafts) ? remote.drafts : [],
      threads: Array.isArray(remote.threads) ? remote.threads : [],
    };
    return memory;
  }
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (parsed?.version === 1) {
      memory = {
        version: 1,
        channels: Array.isArray(parsed.channels) ? parsed.channels : [],
        drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
        threads: Array.isArray(parsed.threads) ? parsed.threads : [],
      };
      return memory;
    }
  } catch {
    /* */
  }
  return memory;
}

async function writeStore(store: Store): Promise<void> {
  memory = store;
  const { saveWaBotSlice } = await import("@/lib/waBotStore.server");
  await saveWaBotSlice("classChannel", store);
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {
    /* serverless */
  }
}

function staffMobile(s: StaffRecord): string {
  return waNormalizeLocal10(s.mobile || s.altMobile || "");
}

function matchClassSection(
  masters: MastersState,
  classHint: string,
  sectionHint: string,
): { classId: string; sectionId: string; label: string } | null {
  if (!classHint) return null;
  const classes = masters.classes ?? [];
  const sections = masters.sections ?? [];
  const cls = classes.find((c) => {
    const n = (c.name || "").toLowerCase().replace(/\s+/g, "");
    const hint = classHint.toLowerCase();
    return (
      n === hint ||
      n.includes(hint) ||
      n.replace(/[^0-9]/g, "") === hint.replace(/[^0-9]/g, "")
    );
  });
  if (!cls) return null;
  const secs = sections.filter((s) => s.classId === cls.id);
  let sec =
    secs.find((s) => {
      const n = (s.name || "").toUpperCase().replace(/\s+/g, "");
      return (
        n === sectionHint ||
        n.endsWith(sectionHint) ||
        n.startsWith(sectionHint)
      );
    }) || null;
  if (!sec && sectionHint) return null;
  if (!sec) sec = secs[0] || null;
  if (!sec) return null;
  return {
    classId: cls.id,
    sectionId: sec.id,
    label: `${cls.name || cls.id} · ${sec.name || ""}`.trim(),
  };
}

function matchSubject(
  masters: MastersState,
  hint: string,
): { id: string; name: string } | null {
  if (!hint) return null;
  const subjects = masters.subjects ?? [];
  const h = hint.toLowerCase();
  const hit = subjects.find((s) => {
    const en = (s.nameEn || "").toLowerCase();
    const code = (s.code || "").toLowerCase();
    return en === h || en.includes(h) || code === h;
  });
  if (!hit) return null;
  return { id: hit.id, name: hit.nameEn || hit.code || hit.id };
}

export function buildChannelMembers(
  masters: MastersState,
  classId: string,
  sectionId: string,
  ay: string,
): ClassChannelMember[] {
  const members: ClassChannelMember[] = [];
  const seen = new Set<string>();

  function add(m: ClassChannelMember) {
    const mob = waNormalizeLocal10(m.mobile);
    if (!mob || mob.length !== 10) return;
    const key = `${m.role}:${mob}:${m.staffId || m.householdId || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    members.push({ ...m, mobile: mob });
  }

  for (const t of resolveClassTeachers(masters, classId, sectionId, ay)) {
    add({
      role: "class_teacher",
      name: t.fullName,
      mobile: staffMobile(t),
      staffId: t.id,
    });
  }
  for (const t of resolveSubjectTeachers(masters, classId, sectionId, ay)) {
    add({
      role: "subject_teacher",
      name: t.fullName,
      mobile: staffMobile(t),
      staffId: t.id,
    });
  }
  const sis = loadSis();
  for (const p of listSectionParentContacts(sectionId, ay, sis)) {
    add({
      role: "parent",
      name: p.guardianName,
      mobile: p.mobile,
      householdId: p.householdId,
    });
  }
  return members;
}

export async function syncClassChannels(
  ay = DEFAULT_AY,
): Promise<ClassChannel[]> {
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  const store = await readStore();
  const sections = (masters.sections ?? []).filter((s) => {
    const cls = (masters.classes ?? []).find((c) => c.id === s.classId);
    return !!cls;
  });
  const next: ClassChannel[] = [];
  for (const sec of sections) {
    const cls = (masters.classes ?? []).find((c) => c.id === sec.classId);
    if (!cls) continue;
    const id = `ch_${ay}_${sec.id}`;
    const prev = store.channels.find((c) => c.id === id);
    next.push({
      id,
      academicYearCode: ay,
      classId: cls.id,
      sectionId: sec.id,
      label: `${cls.name || cls.id} · ${sec.name || ""}`.trim(),
      members: buildChannelMembers(masters, cls.id, sec.id, ay),
      updatedAt: nowIso(),
    });
    void prev;
  }
  store.channels = next;
  await writeStore(store);
  return next;
}

export function findTeacherByMobile(
  masters: MastersState,
  fromWaId: string,
): StaffRecord | null {
  const mob = waNormalizeLocal10(fromWaId);
  if (!mob) return null;
  return (
    (masters.staff ?? []).find((s) => {
      if (s.status !== "active") return false;
      const m = staffMobile(s);
      return m === mob;
    }) || null
  );
}

export function isClassChannelTeacherMobile(fromWaId: string): boolean {
  try {
    const masters = loadMasters();
    const staff = findTeacherByMobile(masters, fromWaId);
    if (!staff) return false;
    const hasClass = (staff.classTeacherLinks ?? []).length > 0;
    const hasSub = (staff.subjectTeachingLinks ?? []).length > 0;
    return hasClass || hasSub;
  } catch {
    return false;
  }
}

function teacherChannels(
  store: Store,
  staff: StaffRecord,
  ay: string,
): ClassChannel[] {
  const classIds = new Set<string>();
  const sectionKeys = new Set<string>();
  for (const l of staff.classTeacherLinks ?? []) {
    if (l.academicYearCode && l.academicYearCode !== ay) continue;
    sectionKeys.add(`${l.classId}|${l.sectionId}`);
  }
  for (const l of staff.subjectTeachingLinks ?? []) {
    if (l.academicYearCode && l.academicYearCode !== ay) continue;
    if (l.sectionId) sectionKeys.add(`${l.classId}|${l.sectionId}`);
    else classIds.add(l.classId);
  }
  return store.channels.filter((c) => {
    if (c.academicYearCode !== ay) return false;
    if (sectionKeys.has(`${c.classId}|${c.sectionId}`)) return true;
    if (classIds.has(c.classId)) return true;
    return false;
  });
}

function resolveChannelForParsed(
  store: Store,
  staff: StaffRecord,
  parsed: ClassChannelParsed,
  masters: MastersState,
  ay: string,
): ClassChannel | null {
  const linked = teacherChannels(store, staff, ay);
  if (parsed.classHint) {
    const hit = matchClassSection(
      masters,
      parsed.classHint,
      parsed.sectionHint,
    );
    if (hit) {
      const ch =
        store.channels.find(
          (c) =>
            c.academicYearCode === ay &&
            c.classId === hit.classId &&
            c.sectionId === hit.sectionId,
        ) || null;
      if (ch && linked.some((l) => l.id === ch.id)) return ch;
      if (ch) return ch; // allow if channel exists
    }
  }
  if (linked.length === 1) return linked[0]!;
  return null;
}

async function ensureThread(
  store: Store,
  channel: ClassChannel,
  staff: StaffRecord,
  mobile: string,
): Promise<ClassChannelThread> {
  let t = store.threads.find(
    (x) => x.channelId === channel.id && x.staffId === staff.id,
  );
  if (!t) {
    t = {
      id: nid("cct"),
      channelId: channel.id,
      staffId: staff.id,
      staffName: staff.fullName,
      mobile,
      messages: [],
      pendingDraftId: "",
      updatedAt: nowIso(),
      unreadOffice: 0,
    };
    store.threads.unshift(t);
  }
  return t;
}

function erpTargetFor(kind: ClassChannelIntentKind): ClassChannelDraft["erpTarget"] {
  if (kind === "homework" || kind === "classwork") return "homework";
  if (
    kind === "notice" ||
    kind === "holiday" ||
    kind === "exam" ||
    kind === "timing"
  ) {
    return "notice";
  }
  return "none";
}

function composeDraftPreview(draft: ClassChannelDraft, channel: ClassChannel): string {
  return [
    `Draft · ${draft.kind.toUpperCase()} · ${channel.label}`,
    draft.subjectName ? `Subject: ${draft.subjectName}` : "",
    `Title: ${draft.title}`,
    draft.body,
    draft.dueAt ? `Due: ${draft.dueAt}` : "",
    draft.eventDate ? `Date: ${draft.eventDate}` : "",
    draft.mediaNote ? `Media: ${draft.mediaNote}` : "",
    "",
    "Reply YES to publish to ERP + WhatsApp parents/teachers.",
    "Reply NO to cancel.",
  ]
    .filter(Boolean)
    .join("\n");
}

function composeBroadcast(draft: ClassChannelDraft, channel: ClassChannel): string {
  const head =
    draft.kind === "homework" || draft.kind === "classwork"
      ? `📚 ${draft.kind === "classwork" ? "Classwork" : "Homework"} · ${channel.label}`
      : draft.kind === "holiday"
        ? `🏖 Holiday · ${TENANT.nameDisplay}`
        : draft.kind === "exam"
          ? `📝 Exam · ${channel.label}`
          : draft.kind === "timing"
            ? `⏰ Timing · ${TENANT.nameDisplay}`
            : `📢 Notice · ${channel.label}`;
  return [
    head,
    draft.subjectName ? `Subject: ${draft.subjectName}` : "",
    draft.title,
    draft.body,
    draft.dueAt ? `Due: ${draft.dueAt}` : "",
    draft.eventDate ? `Date: ${draft.eventDate}` : "",
    draft.mediaNote ? `(Attachment noted)` : "",
    "",
    `— ${draft.createdByName} · ${TENANT.nameDisplay}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function broadcastClassChannelDraft(
  draftId: string,
): Promise<{ ok: true; sent: number; stub: number } | { ok: false; error: string }> {
  const store = await readStore();
  const draft = store.drafts.find((d) => d.id === draftId);
  if (!draft) return { ok: false, error: "Draft not found" };
  if (draft.status !== "confirmed" && draft.status !== "applied") {
    return { ok: false, error: "Draft not confirmed" };
  }
  const channel = store.channels.find((c) => c.id === draft.channelId);
  if (!channel) return { ok: false, error: "Channel not found" };

  const body = composeBroadcast(draft, channel);
  const targets = channel.members.filter((m) => m.role === "parent");
  // Also notify co-teachers except author
  for (const m of channel.members) {
    if (m.role === "parent") continue;
    if (m.mobile === draft.createdByMobile) continue;
    if (!targets.some((t) => t.mobile === m.mobile)) targets.push(m);
  }

  let sent = 0;
  let stub = 0;
  for (const t of targets) {
    const r = await sendWhatsAppText({ toMobile: t.mobile, body });
    if (r.ok) sent += 1;
    else stub += 1;
  }
  draft.broadcastCount = sent + stub;
  await writeStore(store);
  return { ok: true, sent, stub };
}

export async function confirmClassChannelDraft(input: {
  draftId: string;
  by?: string;
}): Promise<
  | {
      ok: true;
      draft: ClassChannelDraft;
      broadcast: { sent: number; stub: number };
    }
  | { ok: false; error: string }
> {
  const store = await readStore();
  const draft = store.drafts.find((d) => d.id === input.draftId);
  if (!draft) return { ok: false, error: "Draft not found" };
  if (draft.status === "cancelled") {
    return { ok: false, error: "Draft was cancelled" };
  }
  draft.status = "confirmed";
  draft.confirmedAt = nowIso();
  // clear pending on threads
  for (const t of store.threads) {
    if (t.pendingDraftId === draft.id) t.pendingDraftId = "";
  }
  await writeStore(store);
  const bc = await broadcastClassChannelDraft(draft.id);
  if (!bc.ok) {
    return { ok: true, draft, broadcast: { sent: 0, stub: 0 } };
  }
  return {
    ok: true,
    draft,
    broadcast: { sent: bc.sent, stub: bc.stub },
  };
}

export async function cancelClassChannelDraft(
  draftId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = await readStore();
  const draft = store.drafts.find((d) => d.id === draftId);
  if (!draft) return { ok: false, error: "Draft not found" };
  draft.status = "cancelled";
  for (const t of store.threads) {
    if (t.pendingDraftId === draft.id) t.pendingDraftId = "";
  }
  await writeStore(store);
  return { ok: true };
}

export async function markClassChannelDraftApplied(
  draftId: string,
): Promise<void> {
  const store = await readStore();
  const draft = store.drafts.find((d) => d.id === draftId);
  if (!draft) return;
  if (draft.status === "confirmed") draft.status = "applied";
  await writeStore(store);
}

export async function listClassChannelState() {
  await syncClassChannels();
  const store = await readStore();
  return {
    channels: store.channels,
    drafts: store.drafts
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100),
    threads: store.threads
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 80),
  };
}

export async function handleWaClassChannelInbound(msg: {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  mediaNote?: string;
}): Promise<{
  escalate: boolean;
  replied: boolean;
  stub?: boolean;
  error?: string;
}> {
  await syncClassChannels();
  const masters = loadMasters();
  const ay = DEFAULT_AY;
  const staff = findTeacherByMobile(masters, msg.fromWaId);
  if (!staff) {
    return { escalate: false, replied: false, error: "Not a teacher" };
  }
  const mobile = waNormalizeLocal10(msg.fromWaId);
  const store = await readStore();
  const subjectNames = (masters.subjects ?? []).map(
    (s) => s.nameEn || s.code || "",
  );
  const parsed = detectClassChannelIntent(msg.text || msg.mediaNote || "", {
    subjectNames,
  });

  // Prefer any linked channel for thread continuity
  const linked = teacherChannels(store, staff, ay);
  let channel =
    resolveChannelForParsed(store, staff, parsed, masters, ay) ||
    linked[0] ||
    null;

  if (!channel && linked.length === 0) {
    const reply =
      "You are not linked as class/subject teacher on any section yet. Ask office to set Staff → Duties.";
    const send = await sendWhatsAppText({ toMobile: mobile, body: reply });
    return {
      escalate: true,
      replied: true,
      stub: !send.ok,
      error: send.ok ? undefined : send.error,
    };
  }

  // For help without channel, use first linked
  if (!channel) channel = linked[0]!;

  const thread = await ensureThread(store, channel, staff, mobile);
  thread.messages.push({
    id: nid("ccm"),
    role: "teacher",
    text: msg.text || msg.mediaNote || "(media)",
    at: nowIso(),
    by: staff.fullName,
    waMessageId: msg.waMessageId,
  });
  thread.updatedAt = nowIso();
  thread.unreadOffice += 1;

  let replyText = "";

  if (parsed.kind === "help") {
    replyText = [
      classChannelHelpText(TENANT.nameDisplay),
      "",
      `Your channels: ${linked.map((c) => c.label).join(", ") || "none"}`,
    ].join("\n");
  } else if (parsed.kind === "members") {
    const ch =
      resolveChannelForParsed(store, staff, parsed, masters, ay) || channel;
    const parents = ch.members.filter((m) => m.role === "parent").length;
    const teachers = ch.members.filter((m) => m.role !== "parent").length;
    replyText = `${ch.label}\nTeachers: ${teachers}\nParents (WhatsApp): ${parents}\nTotal members: ${ch.members.length}`;
  } else if (parsed.kind === "confirm") {
    const draftId = thread.pendingDraftId;
    if (!draftId) {
      replyText = "No pending draft. Send HW / NOTICE / … first.";
    } else {
      await writeStore(store);
      const conf = await confirmClassChannelDraft({
        draftId,
        by: staff.fullName,
      });
      if (!conf.ok) {
        replyText = conf.error;
      } else {
        replyText = `Published · notified ~${conf.broadcast.sent + conf.broadcast.stub} contacts (${conf.broadcast.sent} sent${conf.broadcast.stub ? `, ${conf.broadcast.stub} stub` : ""}).\nERP will pick this up in Class channels / Homework / Notices.`;
        const fresh = await readStore();
        const th = fresh.threads.find((t) => t.id === thread.id);
        if (th) {
          th.messages.push({
            id: nid("ccm"),
            role: "bot",
            text: replyText,
            at: nowIso(),
            by: "bot",
            draftId: conf.draft.id,
          });
          th.updatedAt = nowIso();
          await writeStore(fresh);
        }
        const send = await sendWhatsAppText({
          toMobile: mobile,
          body: replyText,
        });
        return {
          escalate: false,
          replied: true,
          stub: !send.ok,
          error: send.ok ? undefined : send.error,
        };
      }
    }
  } else if (parsed.kind === "cancel") {
    if (thread.pendingDraftId) {
      await cancelClassChannelDraft(thread.pendingDraftId);
      replyText = "Draft cancelled.";
    } else {
      replyText = "No pending draft to cancel.";
    }
  } else if (
    parsed.kind === "homework" ||
    parsed.kind === "classwork" ||
    parsed.kind === "notice" ||
    parsed.kind === "holiday" ||
    parsed.kind === "exam" ||
    parsed.kind === "timing"
  ) {
    const ch =
      resolveChannelForParsed(store, staff, parsed, masters, ay) || channel;
    if (!ch) {
      replyText =
        linked.length > 1
          ? `You teach multiple classes. Include class+section, e.g. HW ${linked[0]?.label.replace(" · ", "") || "8A"} Maths: …`
          : "Could not resolve class channel. Include class like 8A.";
    } else {
      const sub = matchSubject(masters, parsed.subjectHint);
      // Prefer subject from teacher's links if only one for this section
      let subjectId = sub?.id || "";
      let subjectName = sub?.name || parsed.subjectHint || "";
      if (!subjectId && (parsed.kind === "homework" || parsed.kind === "classwork")) {
        const links = (staff.subjectTeachingLinks ?? []).filter(
          (l) =>
            l.classId === ch.classId &&
            (!l.sectionId || l.sectionId === ch.sectionId) &&
            (!l.academicYearCode || l.academicYearCode === ay),
        );
        if (links.length === 1) {
          subjectId = links[0]!.subjectId;
          subjectName =
            (masters.subjects ?? []).find((s) => s.id === subjectId)?.nameEn ||
            "";
        }
      }

      if (
        (parsed.kind === "homework" || parsed.kind === "classwork") &&
        !subjectId
      ) {
        replyText =
          "Please include subject, e.g. HW 8A Maths: Exercise 4 due Monday";
      } else {
        const draft: ClassChannelDraft = {
          id: nid("ccd"),
          channelId: ch.id,
          kind: parsed.kind,
          title: parsed.title || kindTitle(parsed.kind),
          body: parsed.body || parsed.title,
          subjectId,
          subjectName,
          dueAt: parsed.dueAt,
          eventDate: parsed.eventDate,
          mediaNote: msg.mediaNote || "",
          status: "pending",
          createdAt: nowIso(),
          createdByStaffId: staff.id,
          createdByName: staff.fullName,
          createdByMobile: mobile,
          confirmedAt: "",
          broadcastCount: 0,
          erpTarget: erpTargetFor(parsed.kind),
        };
        store.drafts.unshift(draft);
        thread.pendingDraftId = draft.id;
        thread.channelId = ch.id;
        replyText = composeDraftPreview(draft, ch);
      }
    }
  } else {
    replyText = [
      "Could not understand. Try:",
      "HW 8A Maths: …",
      "NOTICE 8A: …",
      "Or send HELP",
    ].join("\n");
  }

  thread.messages.push({
    id: nid("ccm"),
    role: "bot",
    text: replyText,
    at: nowIso(),
    by: "bot",
    draftId: thread.pendingDraftId || undefined,
  });
  thread.updatedAt = nowIso();
  await writeStore(store);

  const send = await sendWhatsAppText({ toMobile: mobile, body: replyText });
  return {
    escalate: false,
    replied: true,
    stub: !send.ok,
    error: send.ok ? undefined : send.error,
  };
}

function kindTitle(kind: ClassChannelIntentKind): string {
  switch (kind) {
    case "homework":
      return "Homework";
    case "classwork":
      return "Classwork";
    case "holiday":
      return "Holiday";
    case "exam":
      return "Exam";
    case "timing":
      return "School timing";
    default:
      return "Notice";
  }
}

/** Demo / office: create a pending draft without WhatsApp */
export async function officeCreateClassChannelDraft(input: {
  channelId: string;
  kind: ClassChannelIntentKind;
  title: string;
  body: string;
  subjectId?: string;
  subjectName?: string;
  dueAt?: string;
  byStaffId?: string;
  byName: string;
}): Promise<{ ok: true; draft: ClassChannelDraft } | { ok: false; error: string }> {
  await syncClassChannels();
  const store = await readStore();
  const channel = store.channels.find((c) => c.id === input.channelId);
  if (!channel) return { ok: false, error: "Channel not found" };
  const draft: ClassChannelDraft = {
    id: nid("ccd"),
    channelId: channel.id,
    kind: input.kind,
    title: input.title.trim() || kindTitle(input.kind),
    body: input.body.trim() || input.title.trim(),
    subjectId: input.subjectId || "",
    subjectName: input.subjectName || "",
    dueAt: input.dueAt || "",
    eventDate: "",
    mediaNote: "",
    status: "pending",
    createdAt: nowIso(),
    createdByStaffId: input.byStaffId || "",
    createdByName: input.byName || "Office",
    createdByMobile: "",
    confirmedAt: "",
    broadcastCount: 0,
    erpTarget: erpTargetFor(input.kind),
  };
  if (
    (draft.kind === "homework" || draft.kind === "classwork") &&
    !draft.subjectId
  ) {
    return { ok: false, error: "Subject required for homework" };
  }
  store.drafts.unshift(draft);
  await writeStore(store);
  return { ok: true, draft };
}
