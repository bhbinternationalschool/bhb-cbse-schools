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

/**
 * One of the menu's own keywords, typed as the whole message — "FEE",
 * "timing", "Staff." — or "unknown".
 *
 * Exact on purpose. detectStaffBotIntent also reads substrings ("attendance"
 * anywhere is the staff snapshot, "hi" inside "which" is the menu), and on
 * 29 Sep 2026 that would have answered "Mere class ka attendance lena hai"
 * with the staff attendance snapshot. The menu promises its keywords work;
 * this is what keeps that promise without the guessing.
 */
export function detectStaffBotKeyword(text: string): StaffBotQuickId | "unknown" {
  const upper = (text || "").trim().toUpperCase().replace(/[.!?।]+$/, "").trim();
  if (!upper) return "unknown";
  for (const q of STAFF_BOT_OWNER_PROMPTS) {
    if (upper === q.waKeyword) return q.id;
  }
  if (upper === "MAIN MENU") return "menu";
  return "unknown";
}
