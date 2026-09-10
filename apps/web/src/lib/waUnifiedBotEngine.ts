/**
 * Unified school WhatsApp bot — greeting, role menus, visitor onboarding.
 */

import { TENANT } from "@/lib/types";
import type { WaResolvedIdentity, WaResolvedRole, WaRoleKind } from "@/lib/waRoleResolver";
import { CRM_BOT_QUICK_PROMPTS } from "@/lib/crmAdmissionBotEngine";
import { SIS_BOT_QUICK_PROMPTS } from "@/lib/sisParentBotEngine";
import { staffBotMenuText } from "@/lib/waStaffBotPrompts";

export type WaVisitorPurpose =
  | "admission"
  | "job"
  | "fee"
  | "timing"
  | "meeting"
  | "other"
  | "vendor"
  | "transport";

export const VISITOR_PURPOSE_OPTIONS: {
  id: WaVisitorPurpose;
  label: string;
  keyword: string;
}[] = [
  { id: "admission", label: "Admission / enquiry", keyword: "ADMISSION" },
  { id: "job", label: "Job / career", keyword: "JOB" },
  { id: "vendor", label: "Vendor / supplier", keyword: "VENDOR" },
  { id: "transport", label: "Transport / bus", keyword: "TRANSPORT" },
  { id: "fee", label: "Fee / payment", keyword: "FEE" },
  { id: "timing", label: "School timing / info", keyword: "TIMING" },
  { id: "meeting", label: "Meeting / visit", keyword: "MEETING" },
  { id: "other", label: "Something else", keyword: "OTHER" },
];

/**
 * The staff keyword bot answers a staff member only when they ask for it.
 *
 * It was answering everything the command desk stepped aside from, which
 * on a number staff also use to talk to the school meant it cut into
 * ordinary conversation — a greeting got a menu, a half-typed thought got
 * a canned answer about admissions. A parent or a visitor has nothing but
 * that bot, so for them it is unchanged; a staff member has the desk, and
 * the desk says nothing when a message is not a command.
 *
 * So they summon it: "school bot". It then answers them for
 * STAFF_BOT_WINDOW_MINUTES of quiet, or until they send "bot off".
 */
export const STAFF_BOT_WINDOW_MINUTES = 30;

export function parseStaffBotSwitch(text: string): "on" | "off" | null {
  const t = (text || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (
    /^(school ?bot|skool ?bot|school ?bot (start|on|chalu)|bot (on|start|chalu)|start bot|स्कूल ?बॉट|बॉट (चालू|शुरू))$/.test(
      t,
    )
  ) {
    return "on";
  }
  if (/^(bot off|bot band|stop bot|exit bot|bot stop|close bot|बॉट बंद)$/.test(t)) {
    return "off";
  }
  return null;
}

/** Is the staff bot still awake for this person? */
export function staffBotAwake(until: string | undefined, nowMs: number): boolean {
  const t = Date.parse(until || "");
  return Number.isFinite(t) && t > nowMs;
}

/**
 * A greeting that should reset to the top menu.
 *
 * `staff` exists because these words mean two different things depending
 * on who typed them. To a parent or a visitor "hi" means "show me the
 * menu", which is what this branch is for. From a staff member it is a
 * greeting to a colleague, and answering it with a menu is the bot
 * interrupting. "help" is the same: to staff it asks what the command
 * desk can do, and because this check runs BEFORE the desk is asked, it
 * was answered with the visitor menu and the desk was never reached —
 * which is what a director saw on the first day of the pilot.
 *
 * Staff keep the explicit ones — "menu", "main", "start" — so there is
 * always a way back to the old bot without remembering a new phrase.
 */
export function isUnifiedMenuCommand(
  text: string,
  opts?: { staff?: boolean },
): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (opts?.staff) return /^(menu|main|start)$/i.test(t);
  return /^(hi|hello|namaste|hey|start|menu|main|help)$/i.test(t);
}

/**
 * Should this message be answered with the welcome / greeting menu,
 * instead of being passed to whatever flow the sender is in?
 *
 * Pulled out of the server because the decision has bitten twice, both
 * times through the same door: `isUnifiedMenuCommand("")` is true, so a
 * message with NO TEXT reads as "show me the menu".
 *
 * - A visitor forwarding a link or dropping a photo used to be sent the
 *   whole welcome again on every one.
 * - A staff member's VOICE NOTE carries no text either, so every one was
 *   answered with the greeting and returned there — never reaching the
 *   command desk, where the transcription lives. Voice commands could
 *   not work: they were swallowed one step before the code for them.
 *
 * A voice note never asks for the menu. This used to hold for staff only,
 * so a parent who sent one got the welcome menu re-sent — every time, since
 * empty text reads as a menu command. Their words are transcribed now, and
 * when that fails the thread is handed to a person; either way the menu is
 * the wrong answer. A bare photo still gets the menu, exactly as before.
 */
export function shouldShowUnifiedMenu(opts: {
  text: string;
  staff: boolean;
  known: boolean;
  hasSession: boolean;
  hasAudio: boolean;
}): boolean {
  if (!opts.known && opts.hasSession && looksLikeForward(opts.text)) return false;
  if (!opts.text.trim() && opts.hasAudio) return false;
  return isUnifiedMenuCommand(opts.text, { staff: opts.staff });
}

/**
 * How many times the bot re-asks an unknown caller before it stops.
 *
 * Found on 2026-09-07: one number had been sent the purpose menu on every
 * message since 18 August — twenty-one messages, ten-plus replies, each
 * addressed to a Facebook URL that had been taken as the person's name.
 * The bot had no notion of giving up, so it never did.
 */
export const VISITOR_ASK_LIMIT = 3;

/** Longest a name may be. Anything past this is a message, not a name. */
export const VISITOR_NAME_MAX = 60;

const URL_LIKE =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|org|net|co|me|io|ly|app|share)\b\/?)/i;

/**
 * A forwarded link, broadcast or media drop — the single most common
 * thing an outsider sends a school's number, and never a question.
 *
 * The school's WhatsApp should log it and say nothing. Answering it is
 * how a "good morning" chain turns into a three-week correspondence with
 * a bot, which is exactly what it did.
 */
export function looksLikeForward(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (!URL_LIKE.test(t)) return false;
  // A link with a real question around it is still a question. Strip the
  // links and count what was actually said.
  const said = t
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/[^\p{L}\p{M}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  // Opening with the link is the tell. Nobody asking a school a question
  // leads with a bare URL, and a forward that carries a caption tends to
  // carry it AFTER the link — which is how "…/1BkJUpZ93g/good morning
  // have a glorious day" arrived. So a message that starts with a link
  // gets a wider benefit of the doubt before it counts as a question.
  const opensWithLink = /^\s*(https?:\/\/|www\.)/i.test(t);
  return said < (opensWithLink ? 8 : 5);
}

export type VisitorNameRead =
  | { ok: true; name: string }
  | { ok: false; reason: "empty" | "too_short" | "too_long" | "link" | "not_a_name" };

/**
 * Read a reply as somebody's name, or refuse it.
 *
 * It used to accept anything of two characters or more, so a forwarded
 * Facebook link plus "good morning have a glorious day" became a
 * visitor's name and was then read back to them, in bold, on every reply
 * for three weeks. A name the office cannot use is worse than no name:
 * it looks like a record and is not one.
 */
export function readVisitorName(text: string): VisitorNameRead {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return { ok: false, reason: "empty" };
  if (URL_LIKE.test(t)) return { ok: false, reason: "link" };
  if (t.length < 2) return { ok: false, reason: "too_short" };
  if (t.length > VISITOR_NAME_MAX) return { ok: false, reason: "too_long" };
  const words = t.split(" ").filter(Boolean);
  // Nobody's name is eight words long; that is a sentence about something.
  if (words.length > 6) return { ok: false, reason: "too_long" };
  // Mostly letters, or it is a phone number, an emoji or a price list.
  // Marks count as letters: Devanagari carries its vowels as combining
  // marks, so counting only \p{L} makes सुनीता शर्मा half punctuation and
  // rejects a perfectly ordinary name.
  const letters = (t.match(/[\p{L}\p{M}]/gu) || []).length;
  if (letters < 2 || letters / t.length < 0.6) {
    return { ok: false, reason: "not_a_name" };
  }
  return { ok: true, name: t };
}

/** What to say when a reply could not be read as a name. */
export function visitorNameRetryText(
  reason: Exclude<VisitorNameRead, { ok: true }>["reason"],
): string {
  switch (reason) {
    case "link":
      return "Please send your *name* first (e.g. Rajesh Kumar), then tell us what you need.";
    case "too_long":
      return "Please send just your *full name* (e.g. Rajesh Kumar) — you can tell us the rest next.";
    default:
      return "Please reply with your *full name* (e.g. Rajesh Kumar).";
  }
}

export function detectVisitorPurpose(text: string): WaVisitorPurpose | null {
  const upper = (text || "").trim().toUpperCase();
  for (const p of VISITOR_PURPOSE_OPTIONS) {
    if (upper === p.keyword || upper.startsWith(`${p.keyword} `)) {
      return p.id;
    }
  }
  const low = (text || "").toLowerCase();
  // Job before admission, because "apply" belongs to both and admission
  // held it. "I want to apply for a teacher vacancy" was being read as an
  // admission enquiry — which does not merely answer the wrong thing, it
  // writes a fake lead with an enquiry number into the admissions
  // pipeline for the office to chase. The job words here are specific;
  // none of them appears in an ordinary admission enquiry.
  if (/job|career|vacancy|resume|cv\b|hiring|recruit/.test(low)) return "job";
  if (/admission|enquiry|register|apply|seat/.test(low)) return "admission";
  if (/vendor|supplier|purchase|quotation|bill|gst/.test(low)) return "vendor";
  if (/transport|bus|route|pickup|drop|driver|fleet/.test(low)) return "transport";
  if (/fee|pay|dues|payment|receipt/.test(low)) return "fee";
  if (/timing|time|hours|when open|school time/.test(low)) return "timing";
  if (/meet|visit|appointment|counsell|principal/.test(low)) return "meeting";
  if (/other|help|human/.test(low)) return "other";
  return null;
}

function roleMenuBlock(role: WaResolvedRole): string {
  switch (role.kind) {
    case "owner":
      return staffBotMenuText({
        fullName: role.staff?.fullName || "",
        isOwner: true,
      });
    case "staff":
      return staffBotMenuText({
        fullName: role.staff?.fullName || "",
        isOwner: false,
      });
    case "teacher":
      return [
        "*Class teacher*",
        "• *HW* — Homework draft (e.g. HW 8A Maths: …)",
        "• *NOTICE* — Class notice draft",
        "• *HOLIDAY* · *EXAM* · *TIMING*",
        "• *MENU* — Main school menu",
      ].join("\n");
    case "parent":
      return [
        "*Enrolled parent*",
        ...SIS_BOT_QUICK_PROMPTS.map((q) => `• *${q.waKeyword}* — ${q.label}`),
        "• *MENU* — Main school menu",
      ].join("\n");
    case "survey":
      return [
        "*Field survey team*",
        "• *STATUS* — Today's progress",
        "• *CAPTURE* — New lead at location",
        "• *MENU* — Main school menu",
      ].join("\n");
    case "admission_lead":
      return [
        "*Admission enquiry*",
        ...CRM_BOT_QUICK_PROMPTS.map((q) => `• *${q.waKeyword}* — ${q.label}`),
        "• *MENU* — Main school menu",
      ].join("\n");
    default:
      return "";
  }
}

export function composeUnifiedSchoolGreeting(identity: WaResolvedIdentity): string {
  const school = TENANT.nameDisplay;
  const who = identity.displayName ? ` ${identity.displayName}` : "";

  if (!identity.isKnown) {
    return [
      `Namaste${who} — *${school}* welcomes you on WhatsApp.`,
      "",
      "Your number is not on our school records yet.",
      "Please reply with your *full name* (e.g. Rajesh Kumar).",
    ].join("\n");
  }

  const lines = [
    `Namaste${who} — *${school}*.`,
    "",
    "Your number is linked in our system.",
  ];

  if (identity.roles.length === 1) {
    lines.push("", roleMenuBlock(identity.roles[0]!));
    return lines.join("\n");
  }

  lines.push("", "You have more than one profile. Reply with a number or keyword:");
  identity.roles.forEach((r, i) => {
    lines.push(`${i + 1}. *${r.pickKeyword}* — ${r.label}`);
  });
  lines.push("", "Example: reply *PARENT* or *DIRECTOR* · *MENU* anytime.");
  return lines.join("\n");
}

export function composeRolePickPrompt(identity: WaResolvedIdentity): string {
  const lines = [
    `*Choose profile* — ${TENANT.shortName}`,
    "",
  ];
  identity.roles.forEach((r, i) => {
    lines.push(`${i + 1}. *${r.pickKeyword}* — ${r.label}`);
  });
  lines.push("", "Reply with the number or keyword.");
  return lines.join("\n");
}

export function composeActiveFlowHint(
  flow: WaRoleKind | WaVisitorPurpose,
  displayName: string,
): string {
  const name = displayName || "there";
  switch (flow) {
    case "owner":
    case "staff":
      return staffBotMenuText({
        fullName: displayName,
        isOwner: flow === "owner",
      });
    case "teacher":
      return `*Teacher mode* — ${name}\n\n*IN* / *OUT* + location · *STATUS* · *HW 8A Maths…* · *MENU*`;
    case "parent":
      return `*Parent mode* — ${name}\n\nReply *KIDS* · *DUES* · *PAY* (GPay/UPI) · *PAY 1* · *RECEIPTS* · *HUMAN* · *MENU*`;
    case "survey":
      return `*Survey mode* — ${name}\n\nReply *STATUS* · *CAPTURE* · *MENU*`;
    case "admission":
    case "admission_lead":
      return `*Admission mode* — ${name}\n\nReply *FEE* · *REGISTER* · *DOCS* · *STATUS* · *VISIT* · *HUMAN* · *MENU*`;
    case "job":
      return [
        `*Job / career* — ${name}`,
        "",
        "Share qualification & role interest in your next message.",
        "HR will contact you. Reply *HUMAN* for office.",
      ].join("\n");
    case "vendor":
      return [
        `*Vendor / supplier* — ${name}`,
        "",
        "Share company name, GSTIN (if any), and what you supply.",
        "Accounts will respond. Reply *HUMAN* for purchase desk.",
      ].join("\n");
    case "transport":
      return [
        `*Transport* — ${name}`,
        "",
        "For route / pickup queries, share student name & area.",
        "Transport desk: Mon–Sat office hours. Reply *HUMAN* for callback.",
      ].join("\n");
    case "fee":
      return [
        `*Fee enquiry* — ${name}`,
        "",
        "If your child is already enrolled, reply *MENU* then choose *PARENT* → *DUES* / *PAY*.",
        "For new admission fee, reply *ADMISSION*.",
        "Reply *HUMAN* for accounts office.",
      ].join("\n");
    case "timing":
      return [
        `*School timing* — ${TENANT.nameDisplay}`,
        "",
        "Office: Mon–Sat, typically 8:00 AM – 2:00 PM (confirm with office).",
        `Address: ${TENANT.schoolAddress}`,
        "Reply *MENU* for other options.",
      ].join("\n");
    case "meeting":
      return [
        `*Meeting / visit* — ${name}`,
        "",
        "Please share preferred date & time in your next message.",
        "Admissions office will confirm. Reply *HUMAN* for urgent help.",
      ].join("\n");
    case "other":
      return `*Help desk* — ${name}\n\nPlease describe your query. Reply *HUMAN* to reach staff.`;
    default:
      return composeUnifiedSchoolGreeting({
        mobile10: "",
        displayName,
        isKnown: true,
        roles: [],
      });
  }
}

export function composeCollectPurposePrompt(visitorName: string): string {
  return [
    `Thank you, *${visitorName}*.`,
    "",
    "What brings you to *" + TENANT.shortName + "* today?",
    "",
    ...VISITOR_PURPOSE_OPTIONS.map(
      (p) => `• *${p.keyword}* — ${p.label}`,
    ),
  ].join("\n");
}

export function flowKindFromRole(role: WaResolvedRole): WaRoleKind {
  return role.kind;
}

export function flowKindFromVisitorPurpose(
  purpose: WaVisitorPurpose,
): WaRoleKind | WaVisitorPurpose {
  if (purpose === "admission") return "admission_lead";
  return purpose;
}
