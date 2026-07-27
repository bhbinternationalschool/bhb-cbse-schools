/**
 * Server WhatsApp bot for SIS parents (enrolled households).
 */

import { promises as fs } from "fs";
import path from "path";
import {
  buildSchoolUpiPayUri,
  resolveSchoolCollectionsUpi,
} from "@/lib/admissions";
import {
  composeWhatsAppFeeReceipt,
  computeHouseholdDues,
  formatInr,
  loadFees,
  markWhatsAppReceiptSent,
  openFeeDues,
  type FeeDueLine,
} from "@/lib/fees";
import { loadMasters } from "@/lib/masters";
import {
  buildPaymentSharePayload,
  buildPaymentShareUrlAbsolute,
  composeWhatsAppPaymentLinkMessage,
  createPaymentLink,
} from "@/lib/payments";
import {
  classLabelForStudent,
  householdReceipts,
} from "@/lib/parentPortal";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  composeSisDuesReply,
  composeSisHumanReply,
  composeSisInfoReply,
  composeSisKidsReply,
  composeSisPayReply,
  composeSisReceiptsReply,
  detectSisBotIntent,
  sisBotWelcomeText,
  type SisBotChildLine,
  type SisBotDueLine,
} from "@/lib/sisParentBotEngine";
import { loadSis, type Household, type SisStudent } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";

export type WaSisBotMsg = {
  id: string;
  role: "parent" | "bot" | "staff";
  text: string;
  at: string;
  by: string;
  waMessageId?: string;
};

export type WaSisBotThread = {
  id: string;
  channel: "whatsapp";
  audience: "sis_parent";
  mobile: string;
  parentName: string;
  householdId: string;
  status: "bot" | "needs_staff" | "open" | "closed";
  messages: WaSisBotMsg[];
  createdAt: string;
  updatedAt: string;
  unreadStaff: number;
};

type Store = { version: 1; threads: WaSisBotThread[] };

const DATA_FILE = path.join(process.cwd(), ".data", "wa_sis_bot_threads.json");
let memory: Store = { version: 1, threads: [] };

function nid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso() {
  return new Date().toISOString();
}

export function publicAppOrigin(): string {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "https://bhbinternational.school";
  return env.replace(/\/$/, "");
}

async function readStore(): Promise<Store> {
  const { loadWaBotSlice } = await import("@/lib/waBotStore.server");
  const remote = await loadWaBotSlice<Store>("sis", memory);
  if (remote?.version === 1 && Array.isArray(remote.threads)) {
    memory = remote;
    return remote;
  }
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (parsed?.version === 1 && Array.isArray(parsed.threads)) {
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
  await saveWaBotSlice("sis", store);
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {
    /* */
  }
}

export function findHouseholdByWaMobile(mobile10: string): Household | null {
  const sis = loadSis();
  const m = mobile10.replace(/\D/g, "").slice(-10);
  if (m.length !== 10) return null;
  const byHh = sis.households.find(
    (h) =>
      h.whatsappMobile === m || h.mobile === m || h.altMobile === m,
  );
  if (byHh) return byHh;
  const st = sis.students.find(
    (s) => s.fatherMobile === m || s.motherMobile === m,
  );
  if (!st?.householdId) return null;
  return sis.households.find((h) => h.id === st.householdId) || null;
}

export function isSisRegisteredMobile(fromWaId: string): boolean {
  return !!findHouseholdByWaMobile(waNormalizeLocal10(fromWaId));
}

function childrenOf(hh: Household): SisStudent[] {
  return loadSis().students.filter(
    (s) => s.householdId === hh.id && s.status === "active",
  );
}

function flattenOpenDues(hhId: string): FeeDueLine[] {
  const rows = computeHouseholdDues(
    hhId,
    loadSis(),
    loadMasters(),
    loadFees(),
    { includeFuture: true },
  );
  return openFeeDues(rows.flatMap((r) => r.dues)).filter(
    (d) => d.balancePaise > 0,
  );
}

function dueStudentName(due: FeeDueLine): string {
  const st = loadSis().students.find((s) => s.id === due.studentId);
  return st?.fullName || due.label;
}

export async function listWaSisBotThreads(): Promise<WaSisBotThread[]> {
  const store = await readStore();
  return [...store.threads].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function staffReplyWaSisBot(opts: {
  threadId: string;
  text: string;
  by: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const body = opts.text.trim();
  if (!body) return { ok: false, reason: "Empty reply" };
  let store = await readStore();
  const thread = store.threads.find((t) => t.id === opts.threadId);
  if (!thread) return { ok: false, reason: "Thread not found" };
  const send = await sendWhatsAppText({ toMobile: thread.mobile, body });
  if (!send.ok && send.mode !== "stub") {
    return { ok: false, reason: send.error || "Send failed" };
  }
  const msg: WaSisBotMsg = {
    id: nid("wsm"),
    role: "staff",
    text: body,
    at: nowIso(),
    by: opts.by || "School office",
    waMessageId: send.providerId,
  };
  const next: WaSisBotThread = {
    ...thread,
    status: "open",
    unreadStaff: 0,
    updatedAt: nowIso(),
    messages: [...thread.messages, msg],
  };
  store = {
    ...store,
    threads: store.threads.map((t) => (t.id === thread.id ? next : t)),
  };
  await writeStore(store);
  if (!send.ok && send.mode === "stub") {
    return {
      ok: false,
      reason: `Saved locally but WhatsApp not configured: ${send.error}`,
    };
  }
  return { ok: true };
}

function findOrCreate(
  store: Store,
  mobile10: string,
  hh: Household,
  profileName?: string,
): { store: Store; thread: WaSisBotThread } {
  const open = store.threads.find(
    (t) => t.mobile === mobile10 && t.status !== "closed",
  );
  if (open) {
    return {
      store,
      thread: {
        ...open,
        householdId: hh.id,
        parentName: open.parentName || hh.guardianName || profileName || "",
      },
    };
  }
  const thread: WaSisBotThread = {
    id: nid("wst"),
    channel: "whatsapp",
    audience: "sis_parent",
    mobile: mobile10,
    parentName: hh.guardianName || profileName || "",
    householdId: hh.id,
    status: "bot",
    messages: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    unreadStaff: 0,
  };
  return {
    thread,
    store: { ...store, threads: [thread, ...store.threads] },
  };
}

async function buildBotReply(
  hh: Household,
  intent: ReturnType<typeof detectSisBotIntent>,
): Promise<{ text: string; escalate: boolean }> {
  const masters = loadMasters();
  const kids = childrenOf(hh);
  const childLines: SisBotChildLine[] = kids.map((s) => ({
    name: s.fullName,
    classLabel: classLabelForStudent(s, masters),
    admissionNo: s.admissionNo || "",
    status: s.status,
  }));

  switch (intent) {
    case "kids":
      return { escalate: false, text: composeSisKidsReply(childLines) };
    case "dues": {
      const dues = flattenOpenDues(hh.id);
      const dueLines: SisBotDueLine[] = dues.map((d) => ({
        studentName: dueStudentName(d),
        label: d.label,
        amountLabel: formatInr(d.balancePaise),
        dueOn: d.dueOn,
      }));
      const total = dues.reduce((s, d) => s + d.balancePaise, 0);
      return {
        escalate: false,
        text: composeSisDuesReply({
          guardianName: hh.guardianName,
          dueLines,
          totalPaise: total,
          includeFutureNote: true,
        }),
      };
    }
    case "pay": {
      const dues = flattenOpenDues(hh.id);
      if (dues.length === 0) {
        return {
          escalate: false,
          text: "No open dues to pay. Reply *DUES* to refresh.",
        };
      }
      const primary = kids[0];
      const created = createPaymentLink({
        householdId: hh.id,
        studentId: primary?.id || dues[0]!.studentId,
        studentName:
          kids.length > 1
            ? `${hh.guardianName || "Family"} (${kids.length} children)`
            : primary?.fullName || dueStudentName(dues[0]!),
        classLabel:
          kids.length === 1 && primary
            ? classLabelForStudent(primary, masters)
            : "Household",
        dues,
        createdBy: "SIS WhatsApp bot",
        note: "Created via parent WhatsApp PAY",
        expiresInDays: 7,
      });
      if (!created.ok) {
        return { escalate: false, text: created.error };
      }
      const upi = resolveSchoolCollectionsUpi(masters);
      const upiUri = buildSchoolUpiPayUri({
        vpa: upi.vpa,
        payeeName: upi.payeeName,
        amountPaise: created.link.amountPaise,
        note: `Fees ${created.link.code}`,
      });
      const payload = buildPaymentSharePayload(
        created.link,
        TENANT.nameDisplay,
        upi.vpa,
        upiUri,
      );
      const payUrl = buildPaymentShareUrlAbsolute(publicAppOrigin(), payload);
      const hint = composeWhatsAppPaymentLinkMessage(
        created.link,
        payUrl,
        TENANT.nameDisplay,
      );
      return {
        escalate: false,
        text: composeSisPayReply({
          amountPaise: created.link.amountPaise,
          payUrl,
          upiUri,
          code: created.link.code,
          studentHint: hint.split("\n").slice(3, 5).join("\n"),
        }),
      };
    }
    case "receipts": {
      const rows = householdReceipts(hh.id).map((v) => ({
        receiptNo: v.receiptNo,
        date: v.collectionDate,
        amountLabel: formatInr(v.totalPaise),
      }));
      return { escalate: false, text: composeSisReceiptsReply(rows) };
    }
    case "info":
      return { escalate: false, text: composeSisInfoReply() };
    case "human":
      return { escalate: true, text: composeSisHumanReply() };
    default:
      return { escalate: false, text: sisBotWelcomeText() };
  }
}

export async function handleWaSisBotInbound(opts: {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
}): Promise<{
  matched: boolean;
  replied: boolean;
  escalate: boolean;
  replyText: string;
  stub: boolean;
  error?: string;
}> {
  await ensureSchoolMirrorHydrated();
  const mobile10 = waNormalizeLocal10(opts.fromWaId);
  const hh = findHouseholdByWaMobile(mobile10);
  if (!hh) {
    return {
      matched: false,
      replied: false,
      escalate: false,
      replyText: "",
      stub: false,
    };
  }

  const text = (opts.text || "").trim();
  let store = await readStore();
  const opened = findOrCreate(store, mobile10, hh, opts.profileName);
  store = opened.store;
  let thread = opened.thread;

  const parentMsg: WaSisBotMsg = {
    id: nid("wsm"),
    role: "parent",
    text: text || "(open)",
    at: nowIso(),
    by: thread.parentName || "Parent",
    waMessageId: opts.waMessageId,
  };

  const isGreeting =
    !text || /^(hi|hello|namaste|hey|start|menu)$/i.test(text);
  const intent = isGreeting ? ("unknown" as const) : detectSisBotIntent(text);
  const bot = await buildBotReply(hh, intent);

  const botMsg: WaSisBotMsg = {
    id: nid("wsm"),
    role: "bot",
    text: bot.text,
    at: nowIso(),
    by: "SIS parent WA bot",
  };

  thread = {
    ...thread,
    status: bot.escalate
      ? "needs_staff"
      : thread.status === "closed"
        ? "bot"
        : thread.status || "bot",
    unreadStaff: bot.escalate ? thread.unreadStaff + 1 : thread.unreadStaff,
    messages: [...thread.messages, parentMsg, botMsg],
    updatedAt: nowIso(),
  };
  store = {
    ...store,
    threads: store.threads.map((t) => (t.id === thread.id ? thread : t)),
  };
  await writeStore(store);

  const send = await sendWhatsAppText({
    toMobile: mobile10,
    body: bot.text,
    clientMessageId: botMsg.id,
  });

  return {
    matched: true,
    replied: send.ok || send.mode === "stub",
    escalate: bot.escalate,
    replyText: bot.text,
    stub: !send.ok,
    error: send.ok ? undefined : send.error,
  };
}

/** After pay-link confirm — send receipt on WhatsApp Business API. */
export async function sendSisFeeReceiptOnWhatsApp(opts: {
  mobile: string;
  voucherId: string;
}): Promise<{ ok: boolean; error?: string }> {
  await ensureSchoolMirrorHydrated();
  const voucher = loadFees().vouchers.find((v) => v.id === opts.voucherId);
  if (!voucher) return { ok: false, error: "Voucher not found" };
  const text = composeWhatsAppFeeReceipt(voucher, loadSis(), loadMasters());
  const send = await sendWhatsAppText({
    toMobile: opts.mobile,
    body: text,
  });
  if (send.ok) {
    markWhatsAppReceiptSent(voucher.id);
  }
  return { ok: send.ok, error: send.error };
}
