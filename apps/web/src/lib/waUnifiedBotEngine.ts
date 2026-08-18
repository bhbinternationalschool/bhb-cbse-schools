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

export function isUnifiedMenuCommand(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  return /^(hi|hello|namaste|hey|start|menu|main|help)$/i.test(t);
}

export function detectVisitorPurpose(text: string): WaVisitorPurpose | null {
  const upper = (text || "").trim().toUpperCase();
  for (const p of VISITOR_PURPOSE_OPTIONS) {
    if (upper === p.keyword || upper.startsWith(`${p.keyword} `)) {
      return p.id;
    }
  }
  const low = (text || "").toLowerCase();
  if (/admission|enquiry|register|apply|seat/.test(low)) return "admission";
  if (/job|career|vacancy|resume|hiring|teacher job/.test(low)) return "job";
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
