/**
 * Staff / director WhatsApp quick replies (leadership & office).
 */

import { TENANT } from "@/lib/types";
import {
  composeAdmissionsWhatsAppSnapshot,
  composeFeeWhatsAppSnapshot,
  composeLeadershipWhatsAppReport,
  composeStaffAttendanceWhatsAppSnapshot,
} from "@/lib/waLeadershipReports.server";
import { generateTutorText } from "@/lib/aiLlm.server";

export type StaffBotQuickId =
  | "reports"
  | "admissions"
  | "staff"
  | "fee"
  | "meeting"
  | "timing"
  | "human"
  | "menu";

export const STAFF_BOT_OWNER_PROMPTS: {
  id: StaffBotQuickId;
  label: string;
  waKeyword: string;
}[] = [
  { id: "reports", label: "Today summary", waKeyword: "REPORTS" },
  { id: "admissions", label: "Admissions / leads", waKeyword: "ADMISSIONS" },
  { id: "staff", label: "Staff snapshot", waKeyword: "STAFF" },
  { id: "fee", label: "Fee collection", waKeyword: "FEE" },
  { id: "meeting", label: "Meeting / visit", waKeyword: "MEETING" },
  { id: "timing", label: "School timing", waKeyword: "TIMING" },
  { id: "human", label: "Talk to office", waKeyword: "HUMAN" },
  { id: "menu", label: "Main menu", waKeyword: "MENU" },
];

export const STAFF_BOT_OFFICE_PROMPTS = STAFF_BOT_OWNER_PROMPTS.filter(
  (p) => p.id !== "reports",
);

export function detectStaffBotIntent(text: string): StaffBotQuickId | "unknown" {
  const upper = (text || "").trim().toUpperCase();
  for (const q of STAFF_BOT_OWNER_PROMPTS) {
    if (upper === q.waKeyword || upper.startsWith(`${q.waKeyword} `)) {
      return q.id;
    }
  }
  const low = (text || "").toLowerCase();
  if (/report|summary|dashboard/.test(low)) return "reports";
  if (/admission|lead|enquiry|crm/.test(low)) return "admissions";
  if (/staff|attendance|payroll|leave/.test(low)) return "staff";
  if (/fee|collection|defaulter/.test(low)) return "fee";
  if (/meet|visit|appointment|counsell/.test(low)) return "meeting";
  if (/timing|time|hours|open|close/.test(low)) return "timing";
  if (/human|help|call/.test(low)) return "human";
  if (/menu|start|hello|hi/.test(low)) return "menu";
  return "unknown";
}

export function replyStaffBotIntent(
  intent: StaffBotQuickId | "unknown",
  ctx: { fullName: string; isOwner: boolean },
): { text: string; escalate: boolean } {
  const name = ctx.fullName || "Sir/Madam";
  const prompts = ctx.isOwner
    ? STAFF_BOT_OWNER_PROMPTS
    : STAFF_BOT_OFFICE_PROMPTS;
  const menu = prompts.map((q) => `• *${q.waKeyword}* — ${q.label}`).join("\n");

  switch (intent) {
    case "reports":
      return {
        escalate: false,
        text: composeLeadershipWhatsAppReport(),
      };
    case "admissions":
      return {
        escalate: false,
        text: [
          composeAdmissionsWhatsAppSnapshot(),
          "",
          menu,
        ].join("\n"),
      };
    case "staff":
      return {
        escalate: false,
        text: [composeStaffAttendanceWhatsAppSnapshot(), "", menu].join("\n"),
      };
    case "fee":
      return {
        escalate: false,
        text: [composeFeeWhatsAppSnapshot(), "", menu].join("\n"),
      };
    case "meeting":
      return {
        escalate: true,
        text: [
          `*Meeting / visit request*`,
          "",
          "Noted for the office. Someone will call you shortly.",
          `School: ${TENANT.schoolAddress}`,
          "",
          menu,
        ].join("\n"),
      };
    case "timing":
      return {
        escalate: false,
        text: [
          `*School timing* — ${TENANT.nameDisplay}`,
          "",
          "Office hours: Mon–Sat, typically 8:00 AM – 2:00 PM (confirm with office for your campus).",
          "Parent queries on fees: reply *PARENT* on this number.",
          "",
          menu,
        ].join("\n"),
      };
    case "human":
      return {
        escalate: true,
        text: [
          `Connecting you to the school office, ${name}.`,
          "A staff member will reply here as soon as possible.",
        ].join("\n"),
      };
    case "menu":
      return { escalate: false, text: staffBotMenuText(ctx) };
    default:
      return { escalate: false, text: staffBotMenuText(ctx) };
  }
}

/**
 * LLM fallback for staff/leadership messages the keyword matcher doesn't
 * recognize. Staff already have full ERP access, so this only points them
 * to the right quick-command — it must never invent a live number, name, or
 * date since staff may act on it operationally. Returns null on any
 * failure — caller keeps the existing menu, this is a graceful upgrade.
 */
async function tryStaffAiFallback(
  text: string,
  ctx: { fullName: string; isOwner: boolean },
): Promise<string | null> {
  const system = `You are a WhatsApp assistant for school staff/leadership at ${TENANT.nameDisplay}.
You do NOT have access to live school data (headcounts, amounts, names, dates) — you may only tell staff which existing quick-reply keyword to use: REPORTS, ADMISSIONS, STAFF, FEE, MEETING, TIMING, HUMAN, or MENU.
Never invent or guess a number, name, or date yourself.
If none of those keywords fit the question, tell them to reply *HUMAN* or open the ERP app.
Keep the reply under 300 characters, plain text (no markdown headers).`;

  const userMessage = `Staff member: ${ctx.fullName || "Team member"} (${ctx.isOwner ? "owner/leadership" : "staff"})
Message: "${text}"`;

  try {
    const r = await generateTutorText({ system, userMessage });
    if (!r.ok) return null;
    return r.text.trim() || null;
  } catch {
    return null;
  }
}

/** Same as replyStaffBotIntent, but tries an LLM fallback for genuinely
 * unrecognized free text instead of always showing the quick-command menu. */
export async function replyStaffBotIntentWithAi(
  intent: StaffBotQuickId | "unknown",
  text: string,
  ctx: { fullName: string; isOwner: boolean },
): Promise<{ text: string; escalate: boolean }> {
  const base = replyStaffBotIntent(intent, ctx);
  const trimmed = text.trim();
  if (
    intent === "unknown" &&
    trimmed.length > 3 &&
    !/^(hi|hello|namaste|hey|start|menu|main)$/i.test(trimmed)
  ) {
    const aiReply = await tryStaffAiFallback(text, ctx);
    if (aiReply) return { text: aiReply, escalate: false };
  }
  return base;
}

export function staffBotMenuText(ctx: {
  fullName: string;
  isOwner: boolean;
}): string {
  const prompts = ctx.isOwner
    ? STAFF_BOT_OWNER_PROMPTS
    : STAFF_BOT_OFFICE_PROMPTS;
  const role = ctx.isOwner ? "Leadership" : "Staff";
  return [
    `*${role} desk* — ${ctx.fullName || "Team"}`,
    "",
    "Reply with a keyword:",
    ...prompts
      .filter((p) => p.id !== "menu")
      .map((q) => `• *${q.waKeyword}* — ${q.label}`),
    "",
    "Type *MENU* anytime for this list · *MAIN* for school main menu.",
  ].join("\n");
}
