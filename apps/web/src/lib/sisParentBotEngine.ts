/**
 * SIS enrolled parent WhatsApp bot intents.
 * Audience: households registered in SIS — not CRM admissions.
 */

import { formatInr } from "@/lib/masters";
import { TENANT } from "@/lib/types";

export type SisBotQuickId =
  | "kids"
  | "dues"
  | "pay"
  | "receipts"
  | "info"
  | "human";

export const SIS_BOT_QUICK_PROMPTS: {
  id: SisBotQuickId;
  label: string;
  waKeyword: string;
}[] = [
  { id: "kids", label: "My children", waKeyword: "KIDS" },
  { id: "dues", label: "Fee dues", waKeyword: "DUES" },
  { id: "pay", label: "Pay fees", waKeyword: "PAY" },
  { id: "receipts", label: "Recent receipts", waKeyword: "RECEIPTS" },
  { id: "info", label: "School info", waKeyword: "INFO" },
  { id: "human", label: "Talk to office", waKeyword: "HUMAN" },
];

export function sisBotWelcomeText(): string {
  return [
    `Namaste — *${TENANT.shortName}* parent assistant (SIS).`,
    "",
    "For *enrolled students* linked to this WhatsApp number.",
    "Admission / enquiry parents: use the admissions WhatsApp separately.",
    "",
    "Reply with a keyword:",
    ...SIS_BOT_QUICK_PROMPTS.map((q) => `• *${q.waKeyword}* — ${q.label}`),
  ].join("\n");
}

export function detectSisBotIntent(text: string): SisBotQuickId | "unknown" {
  const t = (text || "").trim();
  const upper = t.toUpperCase();
  for (const q of SIS_BOT_QUICK_PROMPTS) {
    if (upper === q.waKeyword || upper.startsWith(`${q.waKeyword} `)) {
      return q.id;
    }
  }
  const asId = t.toLowerCase() as SisBotQuickId;
  if (SIS_BOT_QUICK_PROMPTS.some((q) => q.id === asId)) return asId;

  const low = t.toLowerCase();
  if (/pay|upi|payment link|clear due/.test(low)) return "pay";
  if (/due|outstanding|balance|arrear|fee/.test(low)) return "dues";
  if (/receipt|paid|voucher/.test(low)) return "receipts";
  if (/child|kid|son|daughter|student|class/.test(low)) return "kids";
  if (/info|address|timing|contact|phone|office/.test(low)) return "info";
  if (/human|staff|office|help|counsellor|call me|agent/.test(low))
    return "human";
  return "unknown";
}

export type SisBotChildLine = {
  name: string;
  classLabel: string;
  admissionNo: string;
  status: string;
};

export type SisBotDueLine = {
  studentName: string;
  label: string;
  amountLabel: string;
  dueOn: string;
};

export function composeSisKidsReply(children: SisBotChildLine[]): string {
  if (children.length === 0) {
    return [
      "No active students found for this WhatsApp number.",
      "Ask the school office to update your household mobile / WhatsApp in SIS.",
      "",
      sisBotWelcomeText(),
    ].join("\n");
  }
  return [
    `*Your children at ${TENANT.shortName}*`,
    "",
    ...children.map(
      (c, i) =>
        `${i + 1}. *${c.name}* · ${c.classLabel || "—"} · Adm ${c.admissionNo || "—"} (${c.status})`,
    ),
    "",
    "Reply *DUES* for fee balance · *PAY* for a UPI pay link.",
  ].join("\n");
}

export function composeSisDuesReply(opts: {
  guardianName: string;
  dueLines: SisBotDueLine[];
  totalPaise: number;
  includeFutureNote?: boolean;
}): string {
  if (opts.dueLines.length === 0) {
    return [
      `*Fee dues* · ${opts.guardianName || "Parent"}`,
      "",
      "No open dues right now. Thank you!",
      "Reply *RECEIPTS* for recent payments · *PAY* for advance / other months once billed.",
    ].join("\n");
  }
  const max = 12;
  const shown = opts.dueLines.slice(0, max);
  return [
    `*Fee dues* · ${opts.guardianName || "Parent"}`,
    opts.includeFutureNote
      ? "(Includes current + upcoming billed instalments)"
      : "(Open balances)",
    "",
    ...shown.map(
      (d) =>
        `• ${d.studentName}: ${d.label} — *${d.amountLabel}* (due ${d.dueOn})`,
    ),
    opts.dueLines.length > max
      ? `…and ${opts.dueLines.length - max} more line(s)`
      : null,
    "",
    `*Total to pay: ${formatInr(opts.totalPaise)}*`,
    "",
    "Reply *PAY* for UPI pay link + QR page. Ledger updates when payment is confirmed.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeSisPayReply(opts: {
  amountPaise: number;
  payUrl: string;
  upiUri: string;
  code: string;
  studentHint: string;
}): string {
  return [
    `*${TENANT.shortName}* · Fee pay link ${opts.code}`,
    opts.studentHint,
    `Amount: *${formatInr(opts.amountPaise)}*`,
    "",
    "Pay online (UPI QR + button):",
    opts.payUrl,
    "",
    "Or open UPI app:",
    opts.upiUri,
    "",
    "After you pay on the link, the fee ledger updates and we send your receipt here.",
  ].join("\n");
}

export function composeSisReceiptsReply(
  rows: { receiptNo: string; date: string; amountLabel: string }[],
): string {
  if (rows.length === 0) {
    return "No fee receipts yet for this household. Reply *PAY* when ready.";
  }
  return [
    "*Recent fee receipts*",
    "",
    ...rows.slice(0, 8).map(
      (r) => `• ${r.receiptNo} · ${r.date} · *${r.amountLabel}*`,
    ),
    "",
    "Full digital receipt is sent after each WhatsApp / UPI payment.",
  ].join("\n");
}

export function composeSisInfoReply(): string {
  return [
    `*${TENANT.nameDisplay}*`,
    TENANT.city,
    TENANT.publicPortal ? `Portal: ${TENANT.publicPortal}` : null,
    "",
    "Fee office hours: school working days (confirm with front office).",
    "Parent web portal: /parent (demo login) for fees & subjects.",
    "",
    "Menu: " + SIS_BOT_QUICK_PROMPTS.map((q) => q.waKeyword).join(" · "),
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeSisHumanReply(): string {
  return [
    "Connecting you to *school office*.",
    "A staff member will reply on this WhatsApp.",
    "Please share: child name, class, and your question.",
  ].join("\n");
}
