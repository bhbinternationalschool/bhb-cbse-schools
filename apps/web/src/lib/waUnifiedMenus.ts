/**
 * Interactive WhatsApp menus (buttons / list rows) + text fallbacks.
 */

import { TENANT } from "@/lib/types";
import type { WaResolvedIdentity, WaResolvedRole } from "@/lib/waRoleResolver";
import { CRM_BOT_LABEL_HI, CRM_BOT_QUICK_PROMPTS } from "@/lib/crmAdmissionBotEngine";
import { SIS_BOT_LABEL_HI, SIS_BOT_QUICK_PROMPTS } from "@/lib/sisParentBotEngine";
import {
  STAFF_BOT_OFFICE_PROMPTS,
  STAFF_BOT_OWNER_PROMPTS,
} from "@/lib/waStaffBotPrompts";
import type { WaInteractiveMenu } from "@/lib/waInteractive";
import { VISITOR_PURPOSE_LABEL_HI, VISITOR_PURPOSE_OPTIONS } from "@/lib/waUnifiedBotEngine";
import { TRANSPORT_BOT_PROMPTS } from "@/lib/waTransportBotPrompts";

/**
 * `hindi` is decided by the caller from the family's own language (see
 * unifiedHindiFor in waUnifiedBotServer). It only ever applies to families
 * and unknown numbers; a staff menu is English whatever is passed.
 */
export function menuKnownUserGreeting(
  identity: WaResolvedIdentity,
  hindi = false,
): { menu: WaInteractiveMenu; textFallback: string } {
  const school = TENANT.nameDisplay;
  const who = identity.displayName ? ` ${identity.displayName}` : "";
  const body = hindi
    ? `नमस्ते${who} जी 🙏 — *${school}*\n\nआपका नंबर स्कूल के रिकॉर्ड में है। नीचे से चुनें:`
    : `Namaste${who} — *${school}*\n\nYour number is on our records. Choose an option:`;

  if (identity.roles.length === 1) {
    return roleFlowMenu(identity.roles[0]!, body, hindi);
  }

  const rows = identity.roles.map((r) => ({
    id: `role_${r.kind}`,
    title: r.pickKeyword.slice(0, 24),
    description: r.label.slice(0, 72),
  }));
  rows.push({ id: "menu_main", title: "MAIN MENU", description: "Start again" });

  const textFallback = [
    body,
    "",
    ...identity.roles.map(
      (r, i) => `${i + 1}. *${r.pickKeyword}* — ${r.label}`,
    ),
    "",
    "Reply with keyword or number · *MENU* anytime.",
  ].join("\n");

  return {
    menu: {
      kind: "list",
      body,
      buttonText: "Choose profile",
      sections: [{ title: "Your profiles", rows }],
    },
    textFallback,
  };
}

export function menuVisitorPurpose(
  visitorName: string,
  hindi = false,
): { menu: WaInteractiveMenu; textFallback: string } {
  const body = hindi
    ? `धन्यवाद, *${visitorName}* जी।\n\n*${TENANT.shortName}* से आपको किस बारे में मदद चाहिए?`
    : `Thank you, *${visitorName}*.\n\nWhat brings you to *${TENANT.shortName}*?`;
  const label = (p: (typeof VISITOR_PURPOSE_OPTIONS)[number]) =>
    hindi ? VISITOR_PURPOSE_LABEL_HI[p.id] : p.label;
  const rows = VISITOR_PURPOSE_OPTIONS.map((p) => ({
    id: `purpose_${p.id}`,
    title: p.keyword,
    description: label(p).slice(0, 72),
  }));
  const textFallback = [
    body,
    "",
    ...VISITOR_PURPOSE_OPTIONS.map((p) => `• *${p.keyword}* — ${label(p)}`),
  ].join("\n");
  return {
    menu: {
      kind: "list",
      body,
      buttonText: hindi ? "विकल्प चुनें" : "Select purpose",
      sections: [{ title: hindi ? "मुझे मदद चाहिए" : "I need help with", rows }],
    },
    textFallback,
  };
}

/**
 * First reply to a number the school does not know. Hindi by default — most
 * such numbers are local families — with one English line, because the
 * sender's language is exactly what the school cannot know yet.
 */
export function menuUnknownWelcome(hindi = true): {
  menu: WaInteractiveMenu;
  textFallback: string;
} {
  const body = hindi
    ? `नमस्ते 🙏 *${TENANT.nameDisplay}* में आपका स्वागत है।\n\nआपका नंबर अभी हमारे रिकॉर्ड में नहीं है। नीचे बटन दबाएँ या अपना *पूरा नाम* लिखकर भेजें।\n\n_English: tap below or reply with your full name._`
    : `Namaste — *${TENANT.nameDisplay}* welcomes you.\n\nYour number is not on file yet. Tap below or reply with your *full name*.`;
  const textFallback = [
    body,
    "",
    hindi
      ? "कृपया अपना पूरा नाम लिखें (जैसे: राजेश कुमार)।"
      : "Please reply with your full name (e.g. Rajesh Kumar).",
  ].join("\n");
  return {
    menu: {
      kind: "buttons",
      body,
      buttons: hindi
        ? [
            { id: "purpose_admission", title: "एडमिशन" },
            { id: "purpose_job", title: "नौकरी" },
            { id: "menu_main", title: "मुख्य मेनू" },
          ]
        : [
            { id: "purpose_admission", title: "Admission" },
            { id: "purpose_job", title: "Job enquiry" },
            { id: "menu_main", title: "Main menu" },
          ],
    },
    textFallback,
  };
}

function transportDriverMenu(
  headerBody?: string,
): { menu: WaInteractiveMenu; textFallback: string } {
  const body = headerBody || "*Transport driver*\n\nRoute & fleet desk.";
  const rows = TRANSPORT_BOT_PROMPTS.filter((p) => p.id !== "menu").map((p) => ({
    id: `transport_${p.id}`,
    title: p.waKeyword,
    description: p.label.slice(0, 72),
  }));
  const textFallback = [
    body,
    "",
    ...TRANSPORT_BOT_PROMPTS.filter((p) => p.id !== "menu").map(
      (p) => `• *${p.waKeyword}* — ${p.label}`,
    ),
    "",
    "*MENU* — main school menu",
  ].join("\n");
  return {
    menu: {
      kind: "list",
      body,
      buttonText: "Driver options",
      sections: [{ title: "Fleet", rows }],
    },
    textFallback,
  };
}

function roleFlowMenu(
  role: WaResolvedRole,
  headerBody?: string,
  hindi = false,
): { menu: WaInteractiveMenu; textFallback: string } {
  switch (role.kind) {
    case "owner":
      return staffMenu(true, role.staff?.fullName || "", headerBody);
    case "staff":
      return staffMenu(false, role.staff?.fullName || "", headerBody);
    case "parent":
      return parentMenu(role, headerBody, hindi);
    case "teacher":
      return teacherMenu(headerBody);
    case "survey":
      return surveyMenu(headerBody);
    case "admission_lead":
      return admissionMenu(headerBody, hindi);
    case "vendor":
      return {
        menu: {
          kind: "buttons",
          body: headerBody || "*Vendor desk*\n\nAccounts / purchase queries.",
          buttons: [
            { id: "purpose_vendor", title: "Bill / PO" },
            { id: "staff_human", title: "Talk to office" },
            { id: "menu_main", title: "Main menu" },
          ],
        },
        textFallback: `${headerBody || "*Vendor*"}\n\nReply bill/PO details · *HUMAN* · *MENU*`,
      };
    case "transport":
      return transportDriverMenu(headerBody);
    default:
      return {
        menu: { kind: "buttons", body: headerBody || "Menu", buttons: [] },
        textFallback: headerBody || "Menu",
      };
  }
}

function staffMenu(
  isOwner: boolean,
  name: string,
  headerBody?: string,
): { menu: WaInteractiveMenu; textFallback: string } {
  const prompts = isOwner ? STAFF_BOT_OWNER_PROMPTS : STAFF_BOT_OFFICE_PROMPTS;
  const body =
    headerBody ||
    `*${isOwner ? "Leadership" : "Staff"} desk* — ${name || "Team"}`;
  const rows = prompts
    .filter((p) => p.id !== "menu")
    .slice(0, 9)
    .map((p) => ({
      id: `staff_${p.id}`,
      title: p.waKeyword,
      description: p.label.slice(0, 72),
    }));
  const textFallback = [
    body,
    "",
    ...prompts
      .filter((p) => p.id !== "menu")
      .map((p) => `• *${p.waKeyword}* — ${p.label}`),
    "",
    "*MENU* — main school menu",
  ].join("\n");
  return {
    menu: {
      kind: "list",
      body,
      buttonText: "Staff options",
      sections: [{ title: "Quick actions", rows }],
    },
    textFallback,
  };
}

function parentMenu(
  role: WaResolvedRole,
  headerBody?: string,
  hindi = false,
): { menu: WaInteractiveMenu; textFallback: string } {
  const who = role.staff?.fullName || (hindi ? "अभिभावक" : "Guardian");
  const body = headerBody || (hindi ? `*अभिभावक सेवा* — ${who}` : `*Parent desk* — ${who}`);
  const label = (q: (typeof SIS_BOT_QUICK_PROMPTS)[number]) =>
    hindi ? SIS_BOT_LABEL_HI[q.id] : q.label;
  const rows = SIS_BOT_QUICK_PROMPTS.map((q) => ({
    id: `parent_${q.id}`,
    title: q.waKeyword,
    description: label(q).slice(0, 72),
  }));
  const textFallback = [
    body,
    "",
    ...SIS_BOT_QUICK_PROMPTS.map((q) => `• *${q.waKeyword}* — ${label(q)}`),
  ].join("\n");
  return {
    menu: {
      kind: "list",
      body,
      buttonText: hindi ? "अभिभावक सेवाएँ" : "Parent services",
      sections: [{ title: hindi ? "नामांकित परिवारों के लिए" : "For enrolled families", rows }],
    },
    textFallback,
  };
}

function teacherMenu(
  headerBody?: string,
): { menu: WaInteractiveMenu; textFallback: string } {
  const body = headerBody || "*Class teacher*\n\nDraft HW / notices for your class.";
  return {
    menu: {
      kind: "buttons",
      body,
      buttons: [
        { id: "teacher_att", title: "Attendance IN/OUT" },
        { id: "teacher_hw", title: "Homework" },
        { id: "teacher_notice", title: "Notice" },
      ],
    },
    textFallback: `${body}\n\n• *IN* / *OUT* — attendance punch (📍 location)\n• *HW* 8A Maths: …\n• *NOTICE* …\n• *MENU*`,
  };
}

function surveyMenu(
  headerBody?: string,
): { menu: WaInteractiveMenu; textFallback: string } {
  const body = headerBody || "*Field survey team*";
  return {
    menu: {
      kind: "buttons",
      body,
      buttons: [
        { id: "survey_status", title: "Status" },
        { id: "survey_capture", title: "Capture lead" },
        { id: "menu_main", title: "Main menu" },
      ],
    },
    textFallback: `${body}\n\n• *STATUS* · *CAPTURE* · *MENU*`,
  };
}

function admissionMenu(
  headerBody?: string,
  hindi = false,
): { menu: WaInteractiveMenu; textFallback: string } {
  const body = headerBody || (hindi ? "*एडमिशन जानकारी*" : "*Admission enquiry*");
  const label = (q: (typeof CRM_BOT_QUICK_PROMPTS)[number]) =>
    hindi ? CRM_BOT_LABEL_HI[q.id] : q.label;
  const rows = CRM_BOT_QUICK_PROMPTS.map((q) => ({
    id: `admission_${q.id}`,
    title: q.waKeyword,
    description: label(q).slice(0, 72),
  }));
  const textFallback = [
    body,
    "",
    ...CRM_BOT_QUICK_PROMPTS.map((q) => `• *${q.waKeyword}* — ${label(q)}`),
  ].join("\n");
  return {
    menu: {
      kind: "list",
      body,
      buttonText: hindi ? "एडमिशन मदद" : "Admission help",
      sections: [{ title: hindi ? "जानकारी और रजिस्ट्रेशन" : "Enquiry & registration", rows }],
    },
    textFallback,
  };
}

/** Map interactive button/list id → text command for existing engines. */
export function interactiveIdToText(id: string): string | null {
  const raw = (id || "").trim();
  if (!raw) return null;
  if (raw === "menu_main") return "MENU";
  if (raw.startsWith("role_")) {
    const kind = raw.slice(5);
    const map: Record<string, string> = {
      owner: "DIRECTOR",
      staff: "STAFF",
      teacher: "TEACHER",
      parent: "PARENT",
      survey: "SURVEY",
      admission_lead: "ADMISSION",
      transport: "TRANSPORT",
    };
    return map[kind] || kind.toUpperCase();
  }
  if (raw.startsWith("purpose_")) {
    return raw.slice(8).toUpperCase();
  }
  if (raw.startsWith("staff_")) {
    const sub = raw.slice(6);
    const hit = STAFF_BOT_OWNER_PROMPTS.find((q) => q.id === sub);
    return hit?.waKeyword || sub.toUpperCase();
  }
  if (raw.startsWith("transport_")) return raw.slice(10).toUpperCase();
  if (raw.startsWith("parent_")) {
    const sub = raw.slice(7);
    const hit = SIS_BOT_QUICK_PROMPTS.find((q) => q.id === sub);
    return hit?.waKeyword || sub.toUpperCase();
  }
  if (raw.startsWith("admission_")) {
    const sub = raw.slice(10);
    const hit = CRM_BOT_QUICK_PROMPTS.find((q) => q.id === sub);
    return hit?.waKeyword || sub.toUpperCase();
  }
  if (raw === "teacher_att") return "ATTEND";
  if (raw === "teacher_hw") return "HW";
  if (raw === "teacher_notice") return "NOTICE";
  if (raw === "survey_status") return "STATUS";
  if (raw === "survey_capture") return "CAPTURE";
  if (raw === "staff_human") return "HUMAN";
  return null;
}

export function roleFlowInteractiveMenu(
  flow: string,
  displayName: string,
  hindi = false,
): { menu: WaInteractiveMenu; textFallback: string } | null {
  const fakeRole = (kind: WaResolvedRole["kind"]): WaResolvedRole => ({
    kind,
    label: kind,
    pickKeyword: kind.toUpperCase(),
  });
  switch (flow) {
    case "owner":
      return staffMenu(true, displayName);
    case "staff":
      return staffMenu(false, displayName);
    case "parent":
      return parentMenu(fakeRole("parent"), undefined, hindi);
    case "teacher":
      return teacherMenu();
    case "survey":
      return surveyMenu();
    case "admission_lead":
    case "admission":
      return admissionMenu(undefined, hindi);
    case "vendor":
      return {
        menu: {
          kind: "buttons",
          body: `*Vendor desk* — ${displayName}`,
          buttons: [
            { id: "purpose_vendor", title: "Bill / PO" },
            { id: "staff_human", title: "Talk to office" },
            { id: "menu_main", title: "Main menu" },
          ],
        },
        textFallback: `*Vendor* — ${displayName}\n\nShare invoice/PO · *HUMAN* · *MENU*`,
      };
    case "transport":
      return transportDriverMenu(`*Transport driver* — ${displayName}`);
    default:
      return null;
  }
}
