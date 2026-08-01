/**
 * ERP floating AI assistant — local knowledge + navigation helper.
 * Offline: no external LLM. Chips & links respect RBAC + role.
 */

import { TENANT } from "@/lib/types";
import type { MastersState } from "@/lib/masters";
import {
  RBAC_MODULES,
  canAccessHref,
  canAccessModule,
  hasPermission,
  inferRoleCodes,
  loadRbac,
  resolveSessionRoles,
  type RbacAction,
  type RbacModule,
  type SessionLike,
} from "@/lib/rbac";

export type ErpAiRole = "user" | "assistant" | "system";

export type ErpAiLink = {
  label: string;
  href: string;
};

export type ErpAiMessage = {
  id: string;
  role: Exclude<ErpAiRole, "system">;
  text: string;
  at: string;
  links?: ErpAiLink[];
  /** Contextual first-visit page tour */
  guideId?: string;
  pageLabel?: string;
  steps?: string[];
};

export type ErpAiQuickPrompt = {
  id: string;
  label: string;
  prompt: string;
  /** Module that must be viewable (and usually the focus of the tip) */
  module: RbacModule;
  /** Extra action required (e.g. edit to arrange substitutes) */
  action?: RbacAction;
  /**
   * Prefer / boost for these role codes (principal, teacher, accounts…).
   * Empty = all roles that pass permission.
   */
  preferRoles?: string[];
  /** If set, only these role codes see the chip (still need permission) */
  onlyRoles?: string[];
};

export type ErpAiChatContext = {
  session: SessionLike;
  masters: MastersState | null;
};

type KnowledgeEntry = {
  id: string;
  keywords: string[];
  title: string;
  answer: string;
  links?: ErpAiLink[];
  /** Gate knowledge + links on this module when set */
  module?: RbacModule;
  /** Need edit (or other) to get the full “how to do” answer */
  action?: RbacAction;
};

function nid() {
  return `msg_${Math.random().toString(36).slice(2, 10)}`;
}

/** Catalog of chips — filtered per user via quickPromptsForUser */
export const ERP_AI_QUICK_PROMPT_CATALOG: ErpAiQuickPrompt[] = [
  {
    id: "tt_build",
    label: "Build timetable",
    prompt: "How do I make a timetable with auto-assign?",
    module: "timetable",
    action: "edit",
    preferRoles: ["principal", "admin", "office", "owner"],
  },
  {
    id: "tt_view",
    label: "My timetable",
    prompt: "How do I see my teaching periods in the timetable?",
    module: "timetable",
    action: "view",
    preferRoles: ["teacher"],
    onlyRoles: ["teacher"],
  },
  {
    id: "subs",
    label: "Arrange substitutes",
    prompt: "How do I auto-arrange substitute teachers for absentees?",
    module: "timetable",
    action: "edit",
    preferRoles: ["principal", "admin", "office", "owner"],
  },
  {
    id: "papers",
    label: "Exam question papers",
    prompt: "How do I create an exam question paper with AI?",
    module: "exams",
    action: "edit",
    preferRoles: ["teacher", "principal", "admin", "office", "owner"],
  },
  {
    id: "marks",
    label: "Enter marks",
    prompt: "How do I enter exam marks for my class?",
    module: "exams",
    action: "edit",
    preferRoles: ["teacher", "principal", "admin", "office"],
  },
  {
    id: "att",
    label: "Mark attendance",
    prompt: "How do I mark class attendance and send absent nudges?",
    module: "attendance",
    action: "edit",
    preferRoles: ["teacher", "principal", "admin", "office"],
  },
  {
    id: "att_exceptions",
    label: "Attendance exceptions",
    prompt: "How does attendance lock and the exceptions panel work?",
    module: "attendance",
    action: "edit",
    preferRoles: ["principal", "admin", "office", "owner"],
  },
  {
    id: "homework",
    label: "Post homework",
    prompt: "How do I post homework for my class?",
    module: "homework",
    action: "edit",
    preferRoles: ["teacher"],
  },
  {
    id: "fees",
    label: "Collect fees",
    prompt: "Where do I collect fees and print receipts?",
    module: "fees",
    action: "view",
    preferRoles: ["accounts", "office", "admin", "principal", "owner"],
  },
  {
    id: "defaulters",
    label: "Fee defaulters",
    prompt: "How do I follow up fee defaulters?",
    module: "fees",
    action: "view",
    preferRoles: ["accounts", "office", "admin", "principal", "owner"],
  },
  {
    id: "admissions",
    label: "Admissions CRM",
    prompt: "How do I manage admissions enquiries?",
    module: "admissions",
    action: "view",
    preferRoles: ["admin", "office", "principal", "owner"],
  },
  {
    id: "students",
    label: "Student roster",
    prompt: "Where is the student SIS roster?",
    module: "students",
    action: "view",
    preferRoles: ["teacher", "office", "admin", "principal"],
  },
  {
    id: "payroll",
    label: "Payroll",
    prompt: "How do I run payroll and payslips?",
    module: "payroll",
    action: "view",
    preferRoles: ["principal", "owner", "admin"],
  },
  {
    id: "accounts",
    label: "Accounts books",
    prompt: "Where are cashbook and ledgers?",
    module: "accounts",
    action: "view",
    preferRoles: ["accounts", "principal", "owner"],
  },
  {
    id: "masters",
    label: "Masters setup",
    prompt: "What should I configure in Masters first?",
    module: "masters",
    action: "view",
    preferRoles: ["principal", "admin", "owner"],
  },
  {
    id: "nav",
    label: "Modules I can open",
    prompt: "List the main modules I can open",
    module: "home",
    action: "view",
  },
];

const KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: "home",
    keywords: ["home", "hub", "start", "dashboard", "where"],
    title: "Home hub",
    answer:
      "Open Home for the school operations hub — tiles for every module you are allowed to see. Use the search bar in the header to jump to a module, student, or staff member.",
    links: [{ label: "Open Home", href: "/home" }],
    module: "home",
  },
  {
    id: "timetable",
    keywords: [
      "timetable",
      "time table",
      "period",
      "bell",
      "auto assign",
      "auto-assign",
      "schedule",
      "grid",
    ],
    title: "Timetable",
    answer:
      "Timetable → Setup sets bell periods and weekdays (can pull from Masters school timing). By class places subjects/teachers; Auto-assign (AI) fills from Masters class subjects + Staff duties (NEP fallback if no map). Publish freezes a snapshot. Holidays and exam date-sheet sittings block teaching on those days.",
    links: [
      { label: "Timetable", href: "/timetable" },
      { label: "Auto-assign", href: "/timetable?tab=auto" },
    ],
    module: "timetable",
  },
  {
    id: "substitutes",
    keywords: [
      "substitute",
      "substitution",
      "absent teacher",
      "cover",
      "replacement",
    ],
    title: "Substitute teachers",
    answer:
      "Timetable → Substitutes. Pick a date — absentees come from Staff attendance (A/LE/HD) and approved leave (or add manually). Auto-arrange finds free teachers (subject+class first). Edit any row, then Save. By teacher shows pink SUBSTITUTE cells and struck-through absent lessons for that date.",
    links: [{ label: "Substitutes", href: "/timetable?tab=subs" }],
    module: "timetable",
    action: "edit",
  },
  {
    id: "exams",
    keywords: ["exam", "marks", "mark entry", "report card", "promotion"],
    title: "Exams & marks",
    answer:
      "Exams has Mark entry, Date-sheet, Question papers, Report cards, Results, and Exams & policy. Create terms under Exams & policy, enter marks by class/section, then print report cards (fee hold may apply).",
    links: [
      { label: "Exams", href: "/exams" },
      { label: "Mark entry", href: "/exams?tab=marks" },
    ],
    module: "exams",
  },
  {
    id: "datesheet",
    keywords: ["date sheet", "datesheet", "exam sitting", "exam duration"],
    title: "Exam date-sheet",
    answer:
      "Exams → Date-sheet: add class + subject + date + start time + duration. Overlapping bell periods show as EXAM blocks on the timetable and are skipped by auto-assign / substitutes for that day.",
    links: [{ label: "Date-sheet", href: "/exams?tab=datesheet" }],
    module: "exams",
  },
  {
    id: "papers",
    keywords: [
      "question paper",
      "paper",
      "set a",
      "set b",
      "formula",
      "print paper",
      "paper code",
      "ai draft",
    ],
    title: "Question papers",
    answer:
      "Exams → Question papers: create a paper (exam + class + subject). Header uses school logo/name, duration, max marks. Use AI draft by hardness, or type questions, add formulas/icons, upload pictures, make sections and Sets A/B/C. Each paper gets a unique code (e.g. EP-2025-26-…). Preview / Print logs copy count.",
    links: [{ label: "Question papers", href: "/exams?tab=papers" }],
    module: "exams",
    action: "edit",
  },
  {
    id: "attendance",
    keywords: [
      "attendance",
      "absent",
      "nudge",
      "whatsapp",
      "cutoff",
      "lock",
      "exception",
    ],
    title: "Attendance",
    answer:
      "Attendance marks the daily register. After cutoff, teachers are locked; office/principal can override. Absent WhatsApp nudge opens wa.me with a composed message. Exceptions panel tracks late marks, overrides, and disputes.",
    links: [
      { label: "Attendance", href: "/attendance" },
      { label: "Exceptions", href: "/attendance?tab=exceptions" },
    ],
    module: "attendance",
  },
  {
    id: "fees",
    keywords: ["fee", "fees", "receipt", "collect", "defaulter", "pay link"],
    title: "Fees",
    answer:
      "Fee Take collects payments and prints receipts. Defaulters playbook helps recovery. Masters holds fee structure / concessions.",
    links: [
      { label: "Fee Take", href: "/fees" },
      { label: "Defaulters", href: "/fees/defaulters" },
    ],
    module: "fees",
  },
  {
    id: "students",
    keywords: ["student", "sis", "admission", "roster", "udi"],
    title: "Students (SIS)",
    answer:
      "Students module is the SIS roster — profiles, imports, siblings, tags, upgrades. Admissions handles new enquiries/CRM before they become SIS students.",
    links: [
      { label: "Students", href: "/students" },
      { label: "Admissions", href: "/admissions" },
    ],
    module: "students",
  },
  {
    id: "staff",
    keywords: ["staff", "teacher", "leave", "payroll", "salary", "duty"],
    title: "Staff & payroll",
    answer:
      "Staff holds profiles, duties (subject teaching links used by timetable AI), leave, and appraisals. Payroll runs payslips when you have payroll permission.",
    links: [
      { label: "Staff", href: "/staff" },
      { label: "Payroll", href: "/payroll" },
    ],
    module: "staff",
  },
  {
    id: "masters",
    keywords: [
      "masters",
      "holiday",
      "timing",
      "class",
      "section",
      "subject",
      "role",
      "permission",
    ],
    title: "Masters",
    answer:
      "Masters is the control plane: classes, sections, subjects, fee heads, school timing, holidays (session-wise), roles & permissions.",
    links: [{ label: "Masters", href: "/masters" }],
    module: "masters",
  },
  {
    id: "homework",
    keywords: ["homework", "diary", "assignment"],
    title: "Homework",
    answer:
      "Homework lets teachers post diary work by class. Parents can see it on the parent portal / class WhatsApp when channels are set up.",
    links: [{ label: "Homework", href: "/homework" }],
    module: "homework",
  },
  {
    id: "comms",
    keywords: [
      "notice",
      "circular",
      "whatsapp",
      "comms",
      "gallery",
      "news",
      "channel",
    ],
    title: "Communications",
    answer:
      "Comms covers notices, news, gallery, and class WhatsApp channels.",
    links: [
      { label: "Comms", href: "/comms" },
      { label: "Class WhatsApp", href: "/comms?tab=channels" },
    ],
    module: "notices",
  },
  {
    id: "certificates",
    keywords: ["certificate", "tc", "bonafide", "character"],
    title: "Certificates",
    answer:
      "Certificates issues TC, bonafide, character, and fee clearance letters with print-ready school branding.",
    links: [{ label: "Certificates", href: "/certificates" }],
    module: "certificates",
  },
  {
    id: "session",
    keywords: ["session", "academic year", "ay", "closed", "read only"],
    title: "Academic session",
    answer:
      "The header session selector scopes Holidays, Timetable, Exams, and more. Closed sessions are read-only — switch to the current year to save changes.",
    links: [{ label: "Home", href: "/home" }],
    module: "home",
  },
  {
    id: "modules",
    keywords: ["module", "list", "menu", "navigate", "open"],
    title: "Main modules",
    answer:
      "Ask “List the main modules I can open” for your personal list. Or say “open fees / timetable / exams”.",
    links: [{ label: "Home", href: "/home" }],
    module: "home",
  },
  {
    id: "accounts",
    keywords: ["accounts", "cashbook", "ledger", "daybook", "pnl"],
    title: "Accounts",
    answer:
      "Accounts holds school books — cashbook, day book, ledgers, trial balance, P&L and balance sheet.",
    links: [{ label: "Accounts", href: "/accounts" }],
    module: "accounts",
  },
  {
    id: "payroll",
    keywords: ["payroll", "payslip", "salary"],
    title: "Payroll",
    answer:
      "Payroll runs the salary cycle — payslips, advances, bank file and statutory remit.",
    links: [{ label: "Payroll", href: "/payroll" }],
    module: "payroll",
  },
  {
    id: "admissions",
    keywords: ["admission", "enquiry", "crm", "registration"],
    title: "Admissions",
    answer:
      "Admissions covers campaigns, enquiry CRM, registration, RTE/EWS and admission reports.",
    links: [{ label: "Admissions", href: "/admissions" }],
    module: "admissions",
  },
];

const OPEN_MAP: { re: RegExp; href: string; label: string }[] = [
  { re: /\b(timetable|time[- ]?table)\b/, href: "/timetable", label: "Timetable" },
  { re: /\bsubstitut/, href: "/timetable?tab=subs", label: "Substitutes" },
  { re: /\b(exam|mark|paper|date[- ]?sheet)\b/, href: "/exams", label: "Exams" },
  { re: /\bquestion paper/, href: "/exams?tab=papers", label: "Question papers" },
  { re: /\battendance\b/, href: "/attendance", label: "Attendance" },
  { re: /\bfee/, href: "/fees", label: "Fee Take" },
  { re: /\bstudent|sis\b/, href: "/students", label: "Students" },
  { re: /\bstaff|teacher\b/, href: "/staff", label: "Staff" },
  { re: /\bpayroll|salary\b/, href: "/payroll", label: "Payroll" },
  { re: /\bmaster/, href: "/masters", label: "Masters" },
  { re: /\bhomework\b/, href: "/homework", label: "Homework" },
  { re: /\b(comms|notice|whatsapp)\b/, href: "/comms", label: "Comms" },
  { re: /\bcertificate|bonafide|\btc\b/, href: "/certificates", label: "Certificates" },
  { re: /\badmission|enquiry\b/, href: "/admissions", label: "Admissions" },
  { re: /\baccounts|cashbook|ledger\b/, href: "/accounts", label: "Accounts" },
  { re: /\bhome\b/, href: "/home", label: "Home" },
];

function roleCodes(ctx: ErpAiChatContext): string[] {
  const rbac = loadRbac();
  const roles = resolveSessionRoles(rbac, ctx.session, ctx.masters);
  if (roles.length) return roles.map((r) => r.code);
  return inferRoleCodes(ctx.session, ctx.masters);
}

function roleLabel(ctx: ErpAiChatContext): string {
  const codes = roleCodes(ctx);
  const rbac = loadRbac();
  const names = codes
    .map((c) => rbac.roles.find((r) => r.code === c)?.name || c)
    .filter(Boolean);
  return names[0] || ctx.session.roleCode || "Staff";
}

function allowedModule(
  ctx: ErpAiChatContext,
  module: RbacModule,
  action: RbacAction = "view",
): boolean {
  return hasPermission(ctx.session, ctx.masters, module, action);
}

function filterLinks(
  ctx: ErpAiChatContext,
  links: ErpAiLink[] | undefined,
): ErpAiLink[] | undefined {
  if (!links?.length) return undefined;
  const ok = links.filter((l) =>
    canAccessHref(ctx.session, ctx.masters, l.href),
  );
  return ok.length ? ok : undefined;
}

export function quickPromptsForUser(ctx: ErpAiChatContext): ErpAiQuickPrompt[] {
  const codes = new Set(roleCodes(ctx));
  const scored: { p: ErpAiQuickPrompt; score: number }[] = [];

  for (const p of ERP_AI_QUICK_PROMPT_CATALOG) {
    const action = p.action || "view";
    if (!allowedModule(ctx, p.module, action)) continue;
    if (p.onlyRoles?.length && !p.onlyRoles.some((r) => codes.has(r))) {
      continue;
    }
    let score = 0;
    if (p.preferRoles?.length) {
      if (p.preferRoles.some((r) => codes.has(r))) score += 20;
      else score -= 2; // still allowed, just lower
    }
    // Prefer edit chips slightly for people who can edit
    if (action === "edit") score += 3;
    scored.push({ p, score });
  }

  scored.sort((a, b) => b.score - a.score || a.p.label.localeCompare(b.p.label));
  // Cap chips so the bar stays usable
  return scored.slice(0, 8).map((s) => s.p);
}

export function accessibleModuleLinks(ctx: ErpAiChatContext): ErpAiLink[] {
  return RBAC_MODULES.filter(
    (m) => m.href && canAccessModule(ctx.session, ctx.masters, m.id),
  )
    .filter((m) => canAccessHref(ctx.session, ctx.masters, m.href!))
    .slice(0, 12)
    .map((m) => ({ label: m.label, href: m.href! }));
}

function welcomeLinks(ctx: ErpAiChatContext): ErpAiLink[] {
  const candidates: ErpAiLink[] = [
    { label: "Timetable", href: "/timetable" },
    { label: "Exams", href: "/exams" },
    { label: "Question papers", href: "/exams?tab=papers" },
    { label: "Attendance", href: "/attendance" },
    { label: "Fee Take", href: "/fees" },
    { label: "Homework", href: "/homework" },
    { label: "Students", href: "/students" },
    { label: "Accounts", href: "/accounts" },
  ];
  return filterLinks(ctx, candidates)?.slice(0, 3) || [
    { label: "Home", href: "/home" },
  ];
}

export function erpAiWelcome(ctx: ErpAiChatContext): ErpAiMessage {
  const who = ctx.session.fullName?.split(" ")[0] || "there";
  const role = roleLabel(ctx);
  const chips = quickPromptsForUser(ctx);
  const chipHint = chips
    .slice(0, 3)
    .map((c) => c.label)
    .join(", ");

  return {
    id: nid(),
    role: "assistant",
    at: new Date().toISOString(),
    text: `Namaste ${who} — I’m the ${TENANT.shortName} ERP assistant.\n\nSigned in as **${role}**. I only show shortcuts for modules you can access.\n\n${
      chipHint
        ? `Try: ${chipHint}.`
        : "Ask a question, or say “open home”."
    } Offline guides — not ChatGPT.`,
    links: welcomeLinks(ctx),
  };
}

function scoreEntry(entry: KnowledgeEntry, q: string): number {
  const parts = q.toLowerCase().split(/\s+/).filter((p) => p.length > 1);
  let score = 0;
  for (const kw of entry.keywords) {
    if (q.includes(kw)) score += kw.length > 6 ? 12 : 8;
    for (const p of parts) {
      if (kw.includes(p) || p.includes(kw)) score += 3;
    }
  }
  if (q.includes(entry.title.toLowerCase())) score += 10;
  return score;
}

function deniedModuleReply(title: string): ErpAiMessage {
  return {
    id: nid(),
    role: "assistant",
    at: new Date().toISOString(),
    text: `**${title}** is outside your assigned permissions.\n\nAsk a principal/admin to grant access under Masters → Roles & permissions, or pick a chip that matches your role.`,
    links: [{ label: "Home", href: "/home" }],
  };
}

export function replyErpAiChat(
  input: string,
  ctx: ErpAiChatContext,
): ErpAiMessage {
  const raw = input.trim();
  const q = raw.toLowerCase();

  if (!q) {
    return {
      id: nid(),
      role: "assistant",
      at: new Date().toISOString(),
      text: "Type a question, or pick a quick prompt below.",
    };
  }

  // Personal module list
  if (
    /modules i can open|list.*(module|menu)|what can i (open|access)|my modules/.test(
      q,
    )
  ) {
    const links = accessibleModuleLinks(ctx);
    const role = roleLabel(ctx);
    return {
      id: nid(),
      role: "assistant",
      at: new Date().toISOString(),
      text: links.length
        ? `As **${role}**, you can open these modules (permission-filtered):`
        : `As **${role}**, no extra modules are enabled beyond Home. Ask admin for access.`,
      links: links.length ? links : [{ label: "Home", href: "/home" }],
    };
  }

  // Direct open / go to
  if (/^(open|go to|take me to|show)\b/.test(q) || /\bopen\b/.test(q)) {
    for (const m of OPEN_MAP) {
      if (m.re.test(q)) {
        if (!canAccessHref(ctx.session, ctx.masters, m.href)) {
          return deniedModuleReply(m.label);
        }
        return {
          id: nid(),
          role: "assistant",
          at: new Date().toISOString(),
          text: `Opening ${m.label}. Use the button if you weren’t navigated automatically.`,
          links: [{ label: `Go to ${m.label}`, href: m.href }],
        };
      }
    }
  }

  let best: KnowledgeEntry | null = null;
  let bestScore = 0;
  for (const entry of KNOWLEDGE) {
    const s = scoreEntry(entry, q);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }

  if (best && bestScore >= 6) {
    if (best.module) {
      const need = best.action || "view";
      if (!allowedModule(ctx, best.module, need)) {
        // Soft: allow view-only tip if they have view but not edit
        if (
          need !== "view" &&
          allowedModule(ctx, best.module, "view")
        ) {
          return {
            id: nid(),
            role: "assistant",
            at: new Date().toISOString(),
            text: `**${best.title}**\n\nYou can view this area, but your role doesn’t include **${need}** permission — so setup/auto-arrange actions are hidden. Ask office/principal if you need edit access.\n\n${best.answer}`,
            links: filterLinks(ctx, best.links),
          };
        }
        return deniedModuleReply(best.title);
      }
    }
    return {
      id: nid(),
      role: "assistant",
      at: new Date().toISOString(),
      text: `**${best.title}**\n\n${best.answer}`,
      links: filterLinks(ctx, best.links),
    };
  }

  for (const m of OPEN_MAP) {
    if (m.re.test(q)) {
      if (!canAccessHref(ctx.session, ctx.masters, m.href)) {
        return deniedModuleReply(m.label);
      }
      return {
        id: nid(),
        role: "assistant",
        at: new Date().toISOString(),
        text: `That sounds like **${m.label}**. Here’s a shortcut — or ask “how do I …” for a short guide.`,
        links: [{ label: m.label, href: m.href }],
      };
    }
  }

  const chips = quickPromptsForUser(ctx)
    .slice(0, 4)
    .map((c) => c.label)
    .join(", ");

  return {
    id: nid(),
    role: "assistant",
    at: new Date().toISOString(),
    text: `I don’t have a precise guide for that yet${
      chips ? ` — try chips: ${chips}` : ""
    }. Or say “open …” for a module you can access.`,
    links: welcomeLinks(ctx),
  };
}

export function makeUserMessage(text: string): ErpAiMessage {
  return {
    id: nid(),
    role: "user",
    at: new Date().toISOString(),
    text: text.trim(),
  };
}

export function erpAiStorageKey(session: SessionLike): string {
  const id = session.staffId || session.email || session.roleCode || "anon";
  return `bhb_erp_ai_chat_v1_${id}`;
}

/** @deprecated use quickPromptsForUser — kept for any stray imports */
export const ERP_AI_QUICK_PROMPTS = ERP_AI_QUICK_PROMPT_CATALOG;
