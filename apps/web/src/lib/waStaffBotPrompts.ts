/**
 * Owner / office WhatsApp quick-reply catalogue — client-safe.
 *
 * Split out of waStaffBotEngine.ts (which imports aiLlm.server and the
 * leadership report composers → next/headers) so client code that only
 * needs the menu (waChatbotFlows, waUnifiedMenus) never pulls the
 * server-only LLM router into the browser bundle.
 */

export type StaffBotQuickId =
  | "in"
  | "out"
  | "att_status"
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
  { id: "in", label: "Attendance punch IN (📍 location)", waKeyword: "IN" },
  { id: "out", label: "Attendance punch OUT", waKeyword: "OUT" },
  { id: "att_status", label: "My attendance today", waKeyword: "STATUS" },
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

/** Keyword menu shown to a staff / leadership WhatsApp user — pure text. */
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
