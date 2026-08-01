/**
 * Teacher / staff WhatsApp attendance bot — intents & copy.
 */

import { TENANT } from "@/lib/types";

function formatDistanceLabel(distanceM: number): string {
  if (distanceM < 0) return "—";
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

export type StaffAttBotQuickId =
  | "in"
  | "out"
  | "status"
  | "attend"
  | "cancel"
  | "human";

export const STAFF_ATT_BOT_KEYWORDS: {
  id: StaffAttBotQuickId;
  label: string;
  waKeyword: string;
}[] = [
  { id: "in", label: "Punch in", waKeyword: "IN" },
  { id: "out", label: "Punch out", waKeyword: "OUT" },
  { id: "status", label: "Today's attendance", waKeyword: "STATUS" },
  { id: "attend", label: "Attendance help", waKeyword: "ATTEND" },
  { id: "cancel", label: "Cancel pending", waKeyword: "CANCEL" },
  { id: "human", label: "HR / office", waKeyword: "HUMAN" },
];

export function staffAttBotWelcomeText(staffName?: string): string {
  return [
    `*${TENANT.shortName}* staff attendance${staffName ? ` · ${staffName}` : ""}`,
    "",
    "Campus punch with *live location* (anti-proxy):",
    "• *IN* — punch in + 📍 location pin",
    "• *OUT* — punch out + 📍 location pin",
    "• *STATUS* — today's IN/OUT",
    "",
    "WhatsApp → 📎 → *Location* → *Send your current location*",
    "(Must be on school premises — GPS geofence.)",
  ].join("\n");
}

export function staffAttAskLocationText(action: "in" | "out"): string {
  const verb = action === "in" ? "punch IN" : "punch OUT";
  return [
    `*Share location to ${verb}*`,
    "",
    "Tap 📎 → *Location* → *Send your current location*.",
    "Saved places / home pins are not accepted — use live GPS at school.",
    "",
    "Reply *CANCEL* to abort.",
  ].join("\n");
}

export function detectStaffAttBotIntent(
  text: string,
): StaffAttBotQuickId | "unknown" {
  const t = (text || "").trim();
  const upper = t.toUpperCase();
  for (const q of STAFF_ATT_BOT_KEYWORDS) {
    if (upper === q.waKeyword || upper.startsWith(`${q.waKeyword} `)) {
      return q.id;
    }
  }
  const low = t.toLowerCase();
  if (/^punch\s*in|check\s*in|clock\s*in|^in$/.test(low)) return "in";
  if (/^punch\s*out|check\s*out|clock\s*out|^out$/.test(low)) return "out";
  if (/status|my attendance|today/.test(low)) return "status";
  if (/attend|attendance/.test(low)) return "attend";
  if (/^cancel|abort/.test(low)) return "cancel";
  if (/human|hr|office|help/.test(low)) return "human";
  return "unknown";
}

export function isStaffAttendanceKeyword(text: string): boolean {
  return detectStaffAttBotIntent(text) !== "unknown";
}

export function composeStaffAttPunchSuccess(opts: {
  kind: "in" | "out";
  time: string;
  distanceM: number;
  staffName: string;
  altMobile?: boolean;
}): string {
  const lines = [
    opts.kind === "in" ? "✅ *Punch IN recorded*" : "✅ *Punch OUT recorded*",
    `${opts.staffName} · ${opts.time} IST`,
    `📍 On campus (~${formatDistanceLabel(opts.distanceM)} from school)`,
  ];
  if (opts.altMobile) {
    lines.push("⚠ Registered via *alt mobile* — HR may verify.");
  }
  lines.push("", "Reply *STATUS* anytime.");
  return lines.join("\n");
}

export function composeStaffAttHumanReply(): string {
  return [
    "Connecting you to *HR / attendance desk*.",
    "Share your name, issue, and today's date.",
  ].join("\n");
}
