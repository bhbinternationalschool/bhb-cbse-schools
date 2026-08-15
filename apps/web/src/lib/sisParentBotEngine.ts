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
  | "human"
  | "complaint";

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
  { id: "complaint", label: "Raise a complaint", waKeyword: "COMPLAINT" },
];

export function sisBotWelcomeText(multiChild = false): string {
  const payHint = multiChild
    ? "• *PAY* — all children · *PAY 1* / *PAY 2* — one child (GPay / UPI)"
    : "• *PAY* — GPay / UPI pay link";
  return [
    `Namaste — *${TENANT.shortName}* parent assistant (SIS).`,
    "",
    "For *enrolled students* linked to this WhatsApp number.",
    "Admission / enquiry parents: use the admissions WhatsApp separately.",
    "",
    "Reply with a keyword:",
    ...SIS_BOT_QUICK_PROMPTS.filter((q) => q.id !== "pay").map(
      (q) => `• *${q.waKeyword}* — ${q.label}`,
    ),
    payHint,
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
  if (/complain|complaint|grievance|shikayat/.test(low)) return "complaint";
  if (/^pay\b|upi|payment link|clear due/.test(low)) return "pay";
  if (/due|outstanding|balance|arrear|fee/.test(low)) return "dues";
  if (/receipt|paid|voucher/.test(low)) return "receipts";
  if (/child|kid|son|daughter|student|class/.test(low)) return "kids";
  if (/info|address|timing|contact|phone|office/.test(low)) return "info";
  if (/human|staff|office|help|counsellor|call me|agent/.test(low))
    return "human";
  return "unknown";
}

export type SisPayChildRef = { id: string; name: string };

export type SisPaySelection =
  | { scope: "all" }
  | { scope: "child"; studentId: string; studentName: string }
  | { scope: "invalid"; message: string };

/** Parse PAY / PAY 1 / PAY Rahul for per-child payment. */
export function parseSisPaySelection(
  text: string,
  children: SisPayChildRef[],
): SisPaySelection {
  const trimmed = (text || "").trim();
  const rest = trimmed.replace(/^pay\s*/i, "").trim();
  if (!rest || /^ALL$/i.test(rest)) {
    return { scope: "all" };
  }
  const num = rest.match(/^(\d+)$/);
  if (num) {
    const idx = Number(num[1]) - 1;
    if (idx < 0 || idx >= children.length) {
      return {
        scope: "invalid",
        message: `Child #${num[1]} not found. Reply *KIDS* for the list.`,
      };
    }
    const c = children[idx]!;
    return { scope: "child", studentId: c.id, studentName: c.name };
  }
  const q = rest.toLowerCase();
  const hit = children.find((c) => {
    const n = c.name.toLowerCase();
    return n === q || n.startsWith(q) || n.includes(q);
  });
  if (hit) {
    return { scope: "child", studentId: hit.id, studentName: hit.name };
  }
  return {
    scope: "invalid",
    message: `Could not match *${rest}*. Reply *KIDS*, then *PAY 1* or *PAY <first name>*.`,
  };
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
      sisBotWelcomeText(false),
    ].join("\n");
  }
  const payLine =
    children.length > 1
      ? "Reply *DUES* · *PAY* (all) · *PAY 1* / *PAY 2* per child — pay via GPay / UPI."
      : "Reply *DUES* for fee balance · *PAY* for a GPay / UPI link.";
  return [
    `*Your children at ${TENANT.shortName}*`,
    "",
    ...children.map(
      (c, i) =>
        `${i + 1}. *${c.name}* · ${c.classLabel || "—"} · Adm ${c.admissionNo || "—"} (${c.status})`,
    ),
    "",
    payLine,
  ].join("\n");
}

export function composeSisDuesReply(opts: {
  guardianName: string;
  dueLines: SisBotDueLine[];
  totalPaise: number;
  runningMonthOnly?: boolean;
  childFilterName?: string;
}): string {
  const scope =
    opts.childFilterName != null
      ? ` · ${opts.childFilterName}`
      : "";
  if (opts.dueLines.length === 0) {
    return [
      `*Fee dues${scope}* · ${opts.guardianName || "Parent"}`,
      "",
      "No open dues till the current running month. Thank you!",
      "Reply *RECEIPTS* for recent payments.",
    ].join("\n");
  }
  const max = 12;
  const shown = opts.dueLines.slice(0, max);
  const payHint =
    opts.childFilterName != null
      ? `Reply *PAY ${opts.childFilterName.split(" ")[0]}* for this child's link.`
      : "Reply *PAY* for all children · *PAY 1* / *PAY 2* for one child.";
  return [
    `*Fee dues${scope}* · ${opts.guardianName || "Parent"}`,
    opts.runningMonthOnly
      ? "(Till current running month — future instalments excluded)"
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
    payHint,
    "",
    "_After GPay payment, tap *Confirm paid* on the link for instant receipt._",
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeSisPayReply(opts: {
  amountPaise: number;
  payUrl: string;
  upiUri?: string;
  code: string;
  studentHint: string;
  autoSettle?: boolean;
}): string {
  const lines = [
    `*${TENANT.shortName}* · Fee pay link ${opts.code}`,
    opts.studentHint,
    `Amount: *${formatInr(opts.amountPaise)}*`,
    "",
    opts.autoSettle
      ? "Pay online (Razorpay — receipt sent here automatically):"
      : "Pay with *Google Pay / UPI* (GPay, PhonePe, Paytm):",
    opts.payUrl,
  ];
  if (opts.upiUri && !opts.autoSettle) {
    lines.push("", "Or open GPay / UPI directly:", opts.upiUri);
    lines.push(
      "",
      "Steps:",
      "1️⃣ Pay in GPay / UPI app",
      "2️⃣ Return to the link",
      "3️⃣ Tap *Confirm paid* — ledger updates & receipt sent here",
    );
  } else if (opts.autoSettle) {
    lines.push(
      "",
      "No need to tap confirm — fee ledger & receipt update when payment succeeds.",
    );
  } else {
    lines.push(
      "",
      "After you pay on the link, the fee ledger updates and we send your receipt here.",
    );
  }
  return lines.join("\n");
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
    "Full digital receipt is sent after GPay / UPI payment (tap *Confirm paid* on the link).",
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
    "Pay fees: reply *PAY* → GPay / UPI → tap *Confirm paid* on the link.",
    "Multi-child: *PAY 1* · *PAY 2* per child.",
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
