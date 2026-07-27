/**
 * Field survey agent WhatsApp bot intents.
 * Full day can run on WhatsApp only (location pin + CAPTURE wizard).
 */

import { TENANT } from "@/lib/types";

export type SurveyBotQuickId =
  | "status"
  | "start"
  | "break"
  | "end"
  | "counts"
  | "beats"
  | "capture"
  | "cancel"
  | "link"
  | "human";

export const SURVEY_BOT_QUICK_PROMPTS: {
  id: SurveyBotQuickId;
  label: string;
  waKeyword: string;
}[] = [
  { id: "status", label: "My survey status", waKeyword: "STATUS" },
  { id: "start", label: "Start survey (+ GPS)", waKeyword: "START" },
  { id: "break", label: "Break / resume (+ GPS)", waKeyword: "BREAK" },
  { id: "end", label: "End survey day (+ GPS)", waKeyword: "END" },
  { id: "capture", label: "Capture household lead", waKeyword: "CAPTURE" },
  { id: "counts", label: "Today's counts", waKeyword: "COUNTS" },
  { id: "beats", label: "Beats list", waKeyword: "BEATS" },
  { id: "cancel", label: "Cancel pending step", waKeyword: "CANCEL" },
  { id: "link", label: "Optional web app link", waKeyword: "LINK" },
  { id: "human", label: "Talk to office", waKeyword: "HUMAN" },
];

export function surveyBotWelcomeText(agentName?: string): string {
  return [
    `Namaste${agentName ? ` ${agentName}` : ""} — *${TENANT.shortName} Field Survey* (WhatsApp).`,
    "",
    "Run your full survey day *here* — no app required.",
    "",
    "1) *BEATS* → *START CODE*",
    "2) Share your *live location* pin when asked (GPS punch)",
    "3) *CAPTURE* for each household",
    "4) *BREAK* / *END* + location pin",
    "",
    "Keywords:",
    ...SURVEY_BOT_QUICK_PROMPTS.map((q) => `• *${q.waKeyword}* — ${q.label}`),
    "",
    "Tip: WhatsApp → 📎 → Location → *Send your current location*.",
  ].join("\n");
}

export function surveyAskLocationText(action: string): string {
  return [
    `*GPS required for ${action}*`,
    "",
    "On WhatsApp: tap 📎 (or +) → *Location* → *Send your current location*.",
    "",
    "After we receive the pin, your timesheet is punched.",
    "Reply *CANCEL* to abort. *SKIPGPS* only if GPS unavailable (logged as no coords).",
  ].join("\n");
}

export function detectSurveyBotIntent(
  text: string,
): SurveyBotQuickId | "unknown" {
  const t = (text || "").trim();
  const upper = t.toUpperCase();
  for (const q of SURVEY_BOT_QUICK_PROMPTS) {
    if (upper === q.waKeyword || upper.startsWith(`${q.waKeyword} `)) {
      return q.id;
    }
  }
  const asId = t.toLowerCase() as SurveyBotQuickId;
  if (SURVEY_BOT_QUICK_PROMPTS.some((q) => q.id === asId)) return asId;

  const low = t.toLowerCase();
  if (/^cancel\b|abort|stop capture/.test(low)) return "cancel";
  if (/^capture\b|new lead|add household|enquir/.test(low)) return "capture";
  if (/start survey|begin survey|punch in|check ?in/.test(low)) return "start";
  if (/end survey|punch out|check ?out|finish day/.test(low)) return "end";
  if (/break|resume|end break/.test(low)) return "break";
  if (/^count|today.?s count|my count/.test(low)) return "counts";
  if (/^beat|area|route/.test(low)) return "beats";
  if (/link|field app/.test(low)) return "link";
  if (/status|where am i|session/.test(low)) return "status";
  if (/human|office|help desk|staff help/.test(low)) return "human";
  return "unknown";
}

/** Parse optional beat code from "START B1" / "START beat:…". */
export function parseSurveyStartBeatArg(text: string): string {
  const t = (text || "").trim();
  const m =
    t.match(/^START\s+(.+)$/i) || t.match(/^start\s+beat[:\s]+(.+)$/i);
  return (m?.[1] || "").trim();
}
