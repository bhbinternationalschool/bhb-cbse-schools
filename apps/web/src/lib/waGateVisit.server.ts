/**
 * Gate visit over WhatsApp — the same procedure as the /visit QR page, but
 * inside a WhatsApp chat with the school number (second QR on the poster:
 * wa.me/<school>?text=VISIT).
 *
 *   VISIT  → lookup by sender's mobile (SIS parents / admission leads)
 *          → purpose list → check-in → visitor number + in-time
 *   OUT    → check-out of the open visit
 *
 * Runs before every other bot flow so an existing parent/staff session
 * cannot swallow the gate keywords. Replies are bilingual (English + Hindi)
 * because the visitor's language is unknown.
 */

import { TENANT } from "@/lib/types";
import type { WaInteractiveMenu } from "@/lib/waInteractive";
import { VISITOR_PURPOSES, type VisitorEntry, type VisitorPurpose } from "@/lib/visitors";
import { VISITOR_PURPOSE_HI } from "@/lib/visitorI18n";
import {
  lookupVisitorMobile,
  selfServiceCheckIn,
  selfServiceCheckOut,
  type VisitorLookup,
} from "@/lib/visitorSelfService.server";

/** Pending state kept on the unified WhatsApp session. */
export type WaGateVisitPending = {
  step: "name" | "purpose";
  name: string;
  linkedTo: string;
  startedAt: string;
};

const PENDING_TTL_MS = 30 * 60 * 1000;

/** Prefilled text behind the poster's WhatsApp QR. */
export const WA_GATE_START_TEXT = "VISIT";

// (?=\s|$|[^\p{L}]) instead of \b — \b is ASCII-only and never matches after Devanagari.
const START_RE = /^(visit|check\s*-?\s*in|checkin|gate|विज़िट|विजिट|चेक\s*-?\s*इन)(?=\s|$|[^\p{L}])/iu;
const OUT_RE = /^(out|check\s*-?\s*out|checkout|exit|leaving|बाहर|चेक\s*-?\s*आउट)(?=\s|$|[^\p{L}])/iu;

export type WaGateReply =
  | { text: string }
  | { menu: { menu: WaInteractiveMenu; textFallback: string } };

export type WaGateResult = {
  handled: boolean;
  /** New pending state (null = clear). Only meaningful when handled. */
  pending?: WaGateVisitPending | null;
  replies: WaGateReply[];
  audience: string;
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}

function purposeLabel(p: VisitorPurpose): string {
  return VISITOR_PURPOSES.find((x) => x.value === p)?.label || p;
}

function linkedToText(l: VisitorLookup): string {
  if (l.parentOf.length > 0) {
    return `Parent of ${l.parentOf.map((p) => `${p.studentName}${p.classLabel ? ` (${p.classLabel})` : ""}`).join(", ")}`;
  }
  if (l.leads.length > 0) return `Admission lead: ${l.leads.map((x) => x.childName).join(", ")}`;
  return "";
}

function purposeMenu(name: string): { menu: WaInteractiveMenu; textFallback: string } {
  const body = `Welcome, *${name}* 🙏\n\nPurpose of visit?\nआने का कारण चुनें`;
  const rows = VISITOR_PURPOSES.map((p) => ({
    id: `gate_p_${p.value}`,
    title: p.label.slice(0, 24),
    description: (VISITOR_PURPOSE_HI[p.value] || p.label).slice(0, 72),
  }));
  const textFallback = [
    body,
    "",
    "Reply with a number / नंबर भेजें:",
    ...VISITOR_PURPOSES.map((p, i) => `${i + 1}. ${p.label} — ${VISITOR_PURPOSE_HI[p.value] || ""}`),
  ].join("\n");
  return {
    menu: { kind: "list", body, buttonText: "Select / चुनें", sections: [{ title: "Purpose · उद्देश्य", rows }] },
    textFallback,
  };
}

function passText(e: VisitorEntry, opts: { alreadyIn: boolean }): string {
  const head = opts.alreadyIn
    ? "ℹ️ You are already checked in.\nआप पहले से चेक-इन हैं।"
    : "✅ You are checked in.\nआपका चेक-इन हो गया।";
  return [
    head,
    "",
    `*Visitor number / विज़िटर नंबर:*\n*${e.visitorNo || e.id}*`,
    `👤 ${e.visitorName}`,
    `📌 ${purposeLabel(e.purpose)}${e.linkedTo ? `\n${e.linkedTo}` : ""}`,
    `🕒 In time / आने का समय: ${fmtTime(e.inTime)}`,
    "",
    "Show this message at the gate.\nयह संदेश गेट पर दिखाएँ।",
    "",
    "When leaving, send *OUT* to check out.\nजाते समय *OUT* भेजें।",
  ].join("\n");
}

function outButtons(body: string): { menu: WaInteractiveMenu; textFallback: string } {
  return {
    menu: { kind: "buttons", body, buttons: [{ id: "gate_out", title: "Check out / बाहर" }] },
    textFallback: body,
  };
}

function detectPurpose(text: string): VisitorPurpose | null {
  const t = text.trim();
  const m = /^gate_p_(\w+)$/.exec(t);
  if (m && VISITOR_PURPOSES.some((p) => p.value === m[1])) return m[1] as VisitorPurpose;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= VISITOR_PURPOSES.length) return VISITOR_PURPOSES[n - 1]!.value;
  const low = t.toLowerCase();
  for (const p of VISITOR_PURPOSES) {
    if (low === p.value || low === p.label.toLowerCase()) return p.value;
    const hi = VISITOR_PURPOSE_HI[p.value];
    if (hi && t === hi) return p.value;
  }
  if (/admission|दाखिला|प्रवेश|enquir/.test(low)) return "admission";
  if (/meet|staff|teacher|principal|मिल|शिक्षक/.test(low)) return "meeting";
  if (/vendor|supplier|विक्रेता|सप्लाय/.test(low)) return "vendor";
  if (/deliver|courier|parcel|डिलीवरी/.test(low)) return "delivery";
  if (/job|interview|नौकरी|इंटरव्यू/.test(low)) return "job_interview";
  if (/other|अन्य/.test(low)) return "other";
  return null;
}

async function startVisit(mobile10: string, profileName: string | undefined): Promise<WaGateResult> {
  const lookup = await lookupVisitorMobile(mobile10);
  if (!lookup) {
    return {
      handled: true,
      pending: null,
      audience: "gate_visit",
      replies: [{ text: "Sorry, the gate system is unavailable right now. Please check in at the gate.\nअभी सिस्टम उपलब्ध नहीं है, कृपया गेट पर चेक-इन करवाएँ।" }],
    };
  }
  if (lookup.openVisit) {
    return {
      handled: true,
      pending: null,
      audience: "gate_visit",
      replies: [{ menu: outButtons(passText(lookup.openVisit, { alreadyIn: true })) }],
    };
  }
  const name = (lookup.suggestedName || profileName || "").trim();
  const linkedTo = linkedToText(lookup);
  if (!name) {
    return {
      handled: true,
      pending: { step: "name", name: "", linkedTo, startedAt: new Date().toISOString() },
      audience: "gate_visit",
      replies: [{ text: `Welcome to *${TENANT.name}* 🙏\n\nPlease send your full name.\nकृपया अपना पूरा नाम भेजें।` }],
    };
  }
  const intro = linkedTo ? `${linkedTo}\n\n` : "";
  const menu = purposeMenu(name);
  return {
    handled: true,
    pending: { step: "purpose", name, linkedTo, startedAt: new Date().toISOString() },
    audience: "gate_visit",
    replies: [{ menu: { menu: { ...menu.menu, body: `${intro}${menu.menu.body}`.slice(0, 1024) }, textFallback: `${intro}${menu.textFallback}` } }],
  };
}

async function finishCheckIn(mobile10: string, pending: WaGateVisitPending, purpose: VisitorPurpose): Promise<WaGateResult> {
  const r = await selfServiceCheckIn({
    mobile: mobile10,
    visitorName: pending.name,
    purpose,
    linkedTo: pending.linkedTo,
    source: "whatsapp",
  });
  if (!r.ok) {
    return {
      handled: true,
      pending: null,
      audience: "gate_visit",
      replies: [{ text: `Sorry, the check-in could not be saved (${r.error}). Please check in at the gate.\nचेक-इन सेव नहीं हो सका, कृपया गेट पर चेक-इन करवाएँ।` }],
    };
  }
  return {
    handled: true,
    pending: null,
    audience: "gate_visit",
    replies: [{ menu: outButtons(passText(r.entry, { alreadyIn: r.alreadyIn })) }],
  };
}

async function checkOut(mobile10: string): Promise<WaGateResult> {
  const r = await selfServiceCheckOut({ mobile: mobile10 });
  if (!r.ok) {
    return {
      handled: true,
      pending: null,
      audience: "gate_visit",
      replies: [{ text: `No open visit found for this number.\nइस नंबर पर कोई खुली विज़िट नहीं मिली।\n\nSend *${WA_GATE_START_TEXT}* to check in.\nचेक-इन के लिए *${WA_GATE_START_TEXT}* भेजें।` }],
    };
  }
  return {
    handled: true,
    pending: null,
    audience: "gate_visit",
    replies: [{
      text: [
        "✅ Checked out. Thank you for visiting!",
        "आपका चेक-आउट हो गया। धन्यवाद!",
        "",
        `*${r.entry.visitorNo || r.entry.id}* · ${r.entry.visitorName}`,
        `🕒 In / अंदर: ${fmtTime(r.entry.inTime)} · Out / बाहर: ${fmtTime(r.entry.outTime || new Date().toISOString())}`,
      ].join("\n"),
    }],
  };
}

/**
 * Decide whether this inbound message belongs to the gate flow and produce
 * the replies. `pending` is the sender's saved gate state (if any).
 */
export async function handleWaGateVisit(opts: {
  mobile10: string;
  /** Interactive id or plain text as received. */
  rawText: string;
  profileName?: string;
  pending: WaGateVisitPending | null | undefined;
}): Promise<WaGateResult> {
  const raw = (opts.rawText || "").trim();
  const none: WaGateResult = { handled: false, replies: [], audience: "" };
  if (!raw) return none;

  let pending = opts.pending ?? null;
  if (pending && Date.now() - new Date(pending.startedAt).getTime() > PENDING_TTL_MS) pending = null;

  if (raw === "gate_out" || OUT_RE.test(raw)) return checkOut(opts.mobile10);
  if (raw === "gate_new" || START_RE.test(raw)) return startVisit(opts.mobile10, opts.profileName);

  if (pending?.step === "name") {
    const name = raw.replace(/\s+/g, " ").trim();
    if (name.length < 2 || /^\d+$/.test(name)) {
      return { handled: true, pending, audience: "gate_visit", replies: [{ text: "Please send your full name (letters).\nकृपया अपना पूरा नाम भेजें।" }] };
    }
    const next: WaGateVisitPending = { ...pending, step: "purpose", name };
    return { handled: true, pending: next, audience: "gate_visit", replies: [{ menu: purposeMenu(name) }] };
  }

  if (pending?.step === "purpose") {
    const purpose = detectPurpose(raw);
    if (!purpose) {
      return { handled: true, pending, audience: "gate_visit", replies: [{ menu: purposeMenu(pending.name) }] };
    }
    return finishCheckIn(opts.mobile10, pending, purpose);
  }

  // A purpose tap without a session (e.g. after server restart) → restart.
  if (raw.startsWith("gate_p_")) return startVisit(opts.mobile10, opts.profileName);
  return none;
}
