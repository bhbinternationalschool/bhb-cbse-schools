/**
 * Shared admissions (CRM parent) bot logic — used by web widget and WhatsApp Business API.
 * Audience: enquiry / registration parents only — not SIS student parents.
 */

import { TENANT } from "@/lib/types";

export type CrmBotQuickId =
  | "fee"
  | "register"
  | "docs"
  | "status"
  | "visit"
  | "human";

export const CRM_BOT_QUICK_PROMPTS: {
  id: CrmBotQuickId;
  label: string;
  waKeyword: string;
}[] = [
  { id: "fee", label: "Registration fee", waKeyword: "FEE" },
  { id: "register", label: "Register online", waKeyword: "REGISTER" },
  { id: "docs", label: "Documents needed", waKeyword: "DOCS" },
  { id: "status", label: "My application status", waKeyword: "STATUS" },
  { id: "visit", label: "Visit / counselling", waKeyword: "VISIT" },
  { id: "human", label: "Talk to admissions", waKeyword: "HUMAN" },
];

export function crmBotWelcomeText(): string {
  return [
    `Namaste — *${TENANT.shortName} Admissions* (WhatsApp / web).`,
    "",
    "I help *parents seeking admission* (enquiry & registration).",
    "Enrolled families: use Parent login for fees — not this bot.",
    "",
    "Reply with a keyword or ask in your words:",
    ...CRM_BOT_QUICK_PROMPTS.map((q) => `• *${q.waKeyword}* — ${q.label}`),
  ].join("\n");
}

export function detectCrmBotIntent(text: string): CrmBotQuickId | "unknown" {
  const t = (text || "").trim();
  const upper = t.toUpperCase();
  for (const q of CRM_BOT_QUICK_PROMPTS) {
    if (upper === q.waKeyword || upper.startsWith(`${q.waKeyword} `)) {
      return q.id;
    }
  }
  // Interactive button / list reply ids often come as fee, register, etc.
  const asId = t.toLowerCase() as CrmBotQuickId;
  if (CRM_BOT_QUICK_PROMPTS.some((q) => q.id === asId)) return asId;

  const low = t.toLowerCase();
  if (/fee|payment|pay|upi|amount|₹|rs\.?/.test(low)) return "fee";
  if (/register|registration|apply|admission form|sibling/.test(low))
    return "register";
  if (/document|docs|certificate|aadhaar|aadhar|birth|tc\b/.test(low))
    return "docs";
  if (/status|enquiry|application|lead|where.*form/.test(low)) return "status";
  if (/visit|campus|counsell|office|meet|tour/.test(low)) return "visit";
  if (
    /human|counsellor|counselor|staff|agent|person|call me|talk to|help desk|hi\b|hello|namaste|start|menu/.test(
      low,
    )
  ) {
    if (/hi\b|hello|namaste|start|menu/.test(low)) return "unknown"; // show menu
    return "human";
  }
  return "unknown";
}

export type CrmBotLeadContext = {
  childName?: string;
  enquiryNo?: string;
  applicationNo?: string;
  stageLabel?: string;
  feeAmountLabel?: string;
} | null;

export function replyCrmBotIntent(
  intent: CrmBotQuickId | "unknown",
  ctx: {
    registerUrl: string;
    lead?: CrmBotLeadContext;
  },
): { text: string; escalate: boolean } {
  const school = TENANT.nameDisplay;
  const registerUrl = ctx.registerUrl;
  const lead = ctx.lead || null;

  switch (intent) {
    case "fee":
      return {
        escalate: false,
        text: [
          `*Registration fee*`,
          `Fee is set per child. Pay online (UPI) after the register form.`,
          "",
          `Register & pay: ${registerUrl}`,
          lead?.feeAmountLabel
            ? `On file for *${lead.childName}*: ${lead.feeAmountLabel}`
            : "Desk will confirm the exact amount for your class.",
          "",
          `Menu: ${CRM_BOT_QUICK_PROMPTS.map((q) => q.waKeyword).join(" · ")}`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    case "register":
      return {
        escalate: false,
        text: [
          `*Online registration*`,
          `One parent can register multiple siblings. Fee is shown per student.`,
          "",
          `Start: ${registerUrl}`,
          "",
          "After payment, school verifies documents, then confirms admission.",
        ].join("\n"),
      };
    case "docs":
      return {
        escalate: false,
        text: [
          `*Documents usually required*`,
          "• Birth certificate",
          "• Child photo",
          "• Aadhaar (as applicable)",
          "• Transfer certificate (other-school transfers)",
          "• Category certificate (if applicable)",
          "",
          `Bring originals when you visit ${school}.`,
        ].join("\n"),
      };
    case "status":
      if (lead?.enquiryNo || lead?.childName) {
        return {
          escalate: false,
          text: [
            `*Your CRM lead*`,
            lead.childName ? `Child: *${lead.childName}*` : null,
            lead.enquiryNo ? `Lead no.: ${lead.enquiryNo}` : null,
            lead.stageLabel ? `Status: *${lead.stageLabel}*` : null,
            lead.applicationNo ? `Application: ${lead.applicationNo}` : null,
            "",
            "School will call / WhatsApp for next steps.",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }
      return {
        escalate: false,
        text: [
          "No CRM lead matched this WhatsApp number yet.",
          `Register: ${registerUrl}`,
          "Or reply *HUMAN* to talk to admissions.",
        ].join("\n"),
      };
    case "visit":
      return {
        escalate: false,
        text: [
          `*Campus visit / counselling*`,
          `${school}, ${TENANT.city}.`,
          "Share preferred date/time — a counsellor will confirm.",
          `Or register first: ${registerUrl}`,
        ].join("\n"),
      };
    case "human":
      return {
        escalate: true,
        text: [
          "Connecting you to *Admissions desk*.",
          "A counsellor will reply on this WhatsApp (CRM admissions channel).",
          "Please send: your name, child class sought, and question.",
        ].join("\n"),
      };
    default:
      return {
        escalate: false,
        text: crmBotWelcomeText(),
      };
  }
}

export function stageLabelForBot(
  stage: string,
): string {
  switch (stage) {
    case "enquiry":
      return "Open enquiry";
    case "applied":
      return "Registered";
    case "verified":
      return "Verified — awaiting admit";
    case "enrolled":
      return "Admitted";
    default:
      return stage || "—";
  }
}
