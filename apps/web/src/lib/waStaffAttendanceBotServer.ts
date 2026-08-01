/**
 * Server WhatsApp bot — teacher / staff campus attendance (IN/OUT + GPS).
 */

import { promises as fs } from "fs";
import path from "path";
import type { StaffRecord } from "@/lib/foundationMasters";
import { loadMasters } from "@/lib/masters";
import {
  applyWhatsAppStaffPunch,
  staffAttendanceStatusForWa,
} from "@/lib/staffAttendance.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { findStaffByMobile } from "@/lib/waRoleResolver";
import {
  composeStaffAttHumanReply,
  composeStaffAttPunchSuccess,
  detectStaffAttBotIntent,
  staffAttAskLocationText,
  staffAttBotWelcomeText,
} from "@/lib/waStaffAttendanceBotEngine";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";

export type WaStaffAttPending = { kind: "punch_in" } | { kind: "punch_out" };

export type WaStaffAttBotThread = {
  id: string;
  channel: "whatsapp";
  audience: "staff_attendance";
  mobile: string;
  staffId: string;
  staffName: string;
  pending: WaStaffAttPending | null;
  status: "bot" | "needs_staff" | "closed";
  messages: { id: string; role: string; text: string; at: string }[];
  updatedAt: string;
};

type Store = { version: 1; threads: WaStaffAttBotThread[] };

const DATA_FILE = path.join(
  process.cwd(),
  ".data",
  "wa_staff_attendance_bot.json",
);
let memory: Store = { version: 1, threads: [] };

function nid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso() {
  return new Date().toISOString();
}

async function readStore(): Promise<Store> {
  const { loadWaBotSlice } = await import("@/lib/waBotStore.server");
  const remote = await loadWaBotSlice<Store>("staffAtt", memory);
  if (remote?.version === 1 && Array.isArray(remote.threads)) {
    memory = remote;
    return remote;
  }
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (parsed?.version === 1) {
      memory = parsed;
      return parsed;
    }
  } catch {
    /* */
  }
  return memory;
}

async function writeStore(store: Store) {
  memory = store;
  const { saveWaBotSlice } = await import("@/lib/waBotStore.server");
  await saveWaBotSlice("staffAtt", store);
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {
    /* */
  }
}

function findStaffForMobile(mobile10: string): StaffRecord | null {
  return findStaffByMobile(loadMasters(), mobile10);
}

function openThread(
  store: Store,
  mobile10: string,
  staff: StaffRecord,
): { store: Store; thread: WaStaffAttBotThread } {
  const open = store.threads.find(
    (t) => t.mobile === mobile10 && t.status !== "closed",
  );
  if (open) {
    return {
      store,
      thread: {
        ...open,
        staffId: staff.id,
        staffName: staff.fullName,
      },
    };
  }
  const thread: WaStaffAttBotThread = {
    id: nid("wat"),
    channel: "whatsapp",
    audience: "staff_attendance",
    mobile: mobile10,
    staffId: staff.id,
    staffName: staff.fullName,
    pending: null,
    status: "bot",
    messages: [],
    updatedAt: nowIso(),
  };
  return {
    store: { ...store, threads: [thread, ...store.threads] },
    thread,
  };
}

export function shouldRouteStaffAttendance(opts: {
  text: string;
  location?: { lat: number; lng: number } | null;
  hasPending?: boolean;
}): boolean {
  if (opts.hasPending) return true;
  if (opts.location) return true;
  return detectStaffAttBotIntent(opts.text) !== "unknown";
}

export async function handleWaStaffAttendanceInbound(opts: {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  location?: {
    lat: number;
    lng: number;
    name?: string;
    address?: string;
    accuracyM?: number;
  };
  fromUnified?: boolean;
}): Promise<{
  handled: boolean;
  replied: boolean;
  escalate: boolean;
  replyText: string;
  stub: boolean;
  error?: string;
}> {
  await ensureSchoolMirrorHydrated();
  const mobile10 = waNormalizeLocal10(opts.fromWaId);
  const staff = findStaffForMobile(mobile10);
  if (!staff) {
    return {
      handled: false,
      replied: false,
      escalate: false,
      replyText: "",
      stub: false,
    };
  }

  let store = await readStore();
  const opened = openThread(store, mobile10, staff);
  store = opened.store;
  let thread = opened.thread;

  const text = (opts.text || "").trim();
  const intent = detectStaffAttBotIntent(text);
  const routed = shouldRouteStaffAttendance({
    text,
    location: opts.location,
    hasPending: !!thread.pending,
  });

  if (!routed && opts.fromUnified) {
    return {
      handled: false,
      replied: false,
      escalate: false,
      replyText: "",
      stub: false,
    };
  }

  if (!routed) {
    return {
      handled: false,
      replied: false,
      escalate: false,
      replyText: "",
      stub: false,
    };
  }

  let replyText = "";
  let escalate = false;
  let pending = thread.pending;

  if (intent === "cancel") {
    pending = null;
    replyText = "Attendance step cancelled. Reply *IN*, *OUT*, or *STATUS*.";
  } else if (intent === "human") {
    pending = null;
    escalate = true;
    replyText = composeStaffAttHumanReply();
  } else if (intent === "status" || intent === "attend") {
    pending = null;
    replyText =
      intent === "attend"
        ? staffAttBotWelcomeText(staff.fullName)
        : await staffAttendanceStatusForWa(staff.id);
  } else if (opts.location && pending) {
    const kind = pending.kind === "punch_in" ? "in" : "out";
    const result = await applyWhatsAppStaffPunch({
      staff,
      mobile10,
      kind,
      geo: {
        lat: opts.location.lat,
        lng: opts.location.lng,
        accuracyM: opts.location.accuracyM,
        name: opts.location.name,
        address: opts.location.address,
      },
    });
    pending = null;
    if (!result.ok) {
      replyText = result.error;
    } else {
      replyText = composeStaffAttPunchSuccess({
        kind: result.kind,
        time: result.time,
        distanceM: result.distanceM,
        staffName: staff.fullName,
        altMobile: result.altMobile,
      });
    }
  } else if (opts.location && !pending) {
    replyText =
      "Reply *IN* or *OUT* first, then share your location pin.";
  } else if (intent === "in") {
    pending = { kind: "punch_in" };
    replyText = staffAttAskLocationText("in");
  } else if (intent === "out") {
    pending = { kind: "punch_out" };
    replyText = staffAttAskLocationText("out");
  } else if (!text && !opts.location) {
    replyText = staffAttBotWelcomeText(staff.fullName);
  } else {
    replyText = staffAttBotWelcomeText(staff.fullName);
  }

  thread = {
    ...thread,
    pending,
    status: escalate ? "needs_staff" : "bot",
    updatedAt: nowIso(),
    messages: [
      ...thread.messages,
      {
        id: nid("msg"),
        role: "staff",
        text: text || (opts.location ? "📍 location" : "(open)"),
        at: nowIso(),
      },
      { id: nid("msg"), role: "bot", text: replyText, at: nowIso() },
    ],
  };
  store = {
    ...store,
    threads: store.threads.map((t) => (t.id === thread.id ? thread : t)),
  };
  await writeStore(store);

  const send = await sendWhatsAppText({
    toMobile: mobile10,
    body: replyText,
  });

  return {
    handled: true,
    replied: send.ok || send.mode === "stub",
    escalate,
    replyText,
    stub: !send.ok,
    error: send.ok ? undefined : send.error,
  };
}
