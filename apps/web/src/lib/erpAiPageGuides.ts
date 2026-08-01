/**
 * Context-aware page guides — shown proactively on first visit per screen.
 */

import type { ErpAiChatContext, ErpAiLink, ErpAiMessage } from "@/lib/erpAiChat";
import { canAccessHref, hasPermission, type RbacModule } from "@/lib/rbac";

export type ErpAiPageGuide = {
  id: string;
  pageLabel: string;
  title: string;
  module: RbacModule;
  steps: string[];
  links?: ErpAiLink[];
  /** Shown on the proactive chip */
  chipLabel: string;
};

const PAGE_GUIDES: ErpAiPageGuide[] = [
  {
    id: "home",
    pageLabel: "Home hub",
    title: "Your school operations dashboard",
    module: "home",
    chipLabel: "Tour Home",
    steps: [
      "Scan module tiles — only modules your role can access are shown.",
      "Use the **search bar** in the header to jump to a student, staff member, or module.",
      "Switch **academic session** in the header before editing timetable, fees, or exams.",
      "Open **Masters** once per session to confirm classes, fee heads, and holidays.",
    ],
    links: [{ label: "Open Masters", href: "/masters" }],
  },
  {
    id: "fees",
    pageLabel: "Fee Take",
    title: "Collect fees & print receipts",
    module: "fees",
    chipLabel: "How Fee Take works",
    steps: [
      "Search the student — name, admission no, roll, or parent mobile.",
      "Review **due breakup** — transport months show the bus badge when assigned.",
      "Enter amount, mode (cash/UPI/cheque), and optional concession note.",
      "Print or WhatsApp the receipt — parent number comes from the household.",
    ],
    links: [{ label: "Defaulters", href: "/fees/defaulters" }],
  },
  {
    id: "fees-defaulters",
    pageLabel: "Defaulters playbook",
    title: "Follow up fee defaulters",
    module: "fees",
    chipLabel: "Defaulters guide",
    steps: [
      "Filter by class, amount due, or days overdue.",
      "Use **WhatsApp** or call scripts — templates respect parent WhatsApp on household.",
      "Mark touchpoints so the next counsellor sees the history.",
      "Escalate holds (report card / TC) only when school policy allows.",
    ],
    links: [{ label: "Fee Take", href: "/fees" }],
  },
  {
    id: "transport-planner",
    pageLabel: "Transport planner",
    title: "Assign routes from SIS addresses",
    module: "transport",
    chipLabel: "Planner walkthrough",
    steps: [
      "Click **Pin homes on map** to geocode unassigned families (needs Google key).",
      "Select a student — we match locality, landmark, and road km from school.",
      "Pick a route suggestion and set **effective from** for mid-year joins.",
      "Confirm fee months preview, then assign — dues appear in Fee Take.",
    ],
    links: [{ label: "Live map", href: "/transport?tab=live" }],
  },
  {
    id: "transport",
    pageLabel: "Transport",
    title: "Routes, fleet & riders",
    module: "transport",
    chipLabel: "Transport basics",
    steps: [
      "Set up **Routes & stops** first, then fleet vehicles with seat capacity.",
      "Use **Planner** for new riders; **Riders** tab for manual assign.",
      "**Live** map shows school, stop zones, pinned homes, and bus GPS.",
      "Fee Take shows monthly transport table when a student is on a route.",
    ],
    links: [{ label: "Planner", href: "/transport?tab=planner" }],
  },
  {
    id: "students",
    pageLabel: "Student SIS",
    title: "Student profiles & household",
    module: "students",
    chipLabel: "SIS guide",
    steps: [
      "Search or filter the roster — tags, class, and UDISE fields are searchable.",
      "Edit a student → **Family** tab: use Google address search to pin home for transport.",
      "Keep **WhatsApp** on the household — all fee receipts and comms use it.",
      "Import / export via reports; siblings share one household.",
    ],
    links: [{ label: "Admissions", href: "/admissions" }],
  },
  {
    id: "admissions",
    pageLabel: "Admissions CRM",
    title: "Enquiries → registration → enroll",
    module: "admissions",
    chipLabel: "Admissions flow",
    steps: [
      "New enquiries land in the pipeline — assign counsellor and log follow-ups.",
      "Use **address autocomplete** on the lead for accurate locality & PIN.",
      "Move to **Registered** when docs and registration fee checklist is complete.",
      "**Enroll** pushes the child into SIS with the linked household.",
    ],
    links: [{ label: "Public apply link", href: "/apply" }],
  },
  {
    id: "attendance",
    pageLabel: "Attendance",
    title: "Daily register & exceptions",
    module: "attendance",
    chipLabel: "Mark attendance",
    steps: [
      "Pick class & section, then mark P/A/L for each student.",
      "After cutoff, teachers are locked — office can override in **Exceptions**.",
      "Send absent **WhatsApp nudge** opens wa.me with a pre-filled message.",
      "Staff attendance feeds timetable substitutes automatically.",
    ],
    links: [{ label: "Exceptions", href: "/attendance?tab=exceptions" }],
  },
  {
    id: "exams",
    pageLabel: "Exams",
    title: "Marks, papers & report cards",
    module: "exams",
    chipLabel: "Exams tour",
    steps: [
      "Create terms under **Exams & policy** before mark entry.",
      "**Mark entry** by class/section; lock when verified.",
      "**Question papers** — AI draft, sets A/B, print with school header.",
      "Print **report cards** after marks — fee holds may block.",
    ],
    links: [{ label: "Question papers", href: "/exams?tab=papers" }],
  },
  {
    id: "timetable",
    pageLabel: "Timetable",
    title: "Bell grid & auto-assign",
    module: "timetable",
    chipLabel: "Timetable setup",
    steps: [
      "**Setup** — bell periods & weekdays (can pull Masters school timing).",
      "**By class** — place subjects; link teachers from Staff duties.",
      "**Auto-assign** fills gaps from class subjects + NEP fallback.",
      "**Publish** freezes the grid; **Substitutes** for absent teachers.",
    ],
    links: [{ label: "Substitutes", href: "/timetable?tab=subs" }],
  },
  {
    id: "masters",
    pageLabel: "Masters",
    title: "School foundation setup",
    module: "masters",
    chipLabel: "Masters checklist",
    steps: [
      "Confirm **School profile**, academic years, and current session.",
      "Classes, sections, subjects — needed before SIS and timetable.",
      "**Fee structure** & concessions before Fee Take go-live.",
      "**Roles & permissions** — control what each staff role sees.",
    ],
    links: [{ label: "Fee setup", href: "/masters?tab=fees" }],
  },
  {
    id: "payroll",
    pageLabel: "Payroll",
    title: "Salary cycle & payslips",
    module: "payroll",
    chipLabel: "Payroll steps",
    steps: [
      "Complete **Salary setup** in Masters for earning/deduction heads.",
      "Run the month — review attendance/leave impacts.",
      "Print payslips or share on staff self-service.",
      "Export **bank file** and statutory remittance when ready.",
    ],
  },
  {
    id: "accounts",
    pageLabel: "Accounts",
    title: "Books & ledgers",
    module: "accounts",
    chipLabel: "Accounts tour",
    steps: [
      "Post vouchers from daily collections and expenses.",
      "Review **cashbook** and day book for the period.",
      "Reconcile fee collections with Fee Take receipts.",
      "Run P&L / balance sheet from Reports when month is closed.",
    ],
  },
  {
    id: "comms",
    pageLabel: "Communications",
    title: "Notices & WhatsApp channels",
    module: "notices",
    chipLabel: "Comms guide",
    steps: [
      "Publish **notices** and news for the parent portal.",
      "Set up **class WhatsApp channels** with approved Meta templates.",
      "Gallery & PTM slots link from the parent app.",
      "Check template approval status under Masters → WhatsApp templates.",
    ],
    links: [{ label: "WA templates", href: "/masters?tab=wa-templates" }],
  },
  {
    id: "homework",
    pageLabel: "Homework",
    title: "Class diary posts",
    module: "homework",
    chipLabel: "Post homework",
    steps: [
      "Select your class & section for today.",
      "Add subject, instructions, and optional attachment.",
      "Parents see it on the portal; class channel can broadcast.",
      "Track read status when WhatsApp delivery is configured.",
    ],
  },
];

export function resolveErpAiPageGuide(
  pathname: string,
  tab: string | null,
): ErpAiPageGuide | null {
  const p = pathname.replace(/\/$/, "") || "/home";

  if (p === "/home" || p === "") return PAGE_GUIDES.find((g) => g.id === "home")!;
  if (p === "/fees/defaulters") return PAGE_GUIDES.find((g) => g.id === "fees-defaulters")!;
  if (p.startsWith("/fees")) return PAGE_GUIDES.find((g) => g.id === "fees")!;
  if (p.startsWith("/transport") && tab === "planner") {
    return PAGE_GUIDES.find((g) => g.id === "transport-planner")!;
  }
  if (p.startsWith("/transport")) return PAGE_GUIDES.find((g) => g.id === "transport")!;
  if (p.startsWith("/students")) return PAGE_GUIDES.find((g) => g.id === "students")!;
  if (p.startsWith("/admissions")) return PAGE_GUIDES.find((g) => g.id === "admissions")!;
  if (p.startsWith("/attendance")) return PAGE_GUIDES.find((g) => g.id === "attendance")!;
  if (p.startsWith("/exams")) return PAGE_GUIDES.find((g) => g.id === "exams")!;
  if (p.startsWith("/timetable")) return PAGE_GUIDES.find((g) => g.id === "timetable")!;
  if (p.startsWith("/masters")) return PAGE_GUIDES.find((g) => g.id === "masters")!;
  if (p.startsWith("/payroll")) return PAGE_GUIDES.find((g) => g.id === "payroll")!;
  if (p.startsWith("/accounts")) return PAGE_GUIDES.find((g) => g.id === "accounts")!;
  if (p.startsWith("/comms")) return PAGE_GUIDES.find((g) => g.id === "comms")!;
  if (p.startsWith("/homework")) return PAGE_GUIDES.find((g) => g.id === "homework")!;

  return null;
}

export function pageGuideSeenKey(userKey: string, guideId: string): string {
  return `bhb_erp_ai_guide_seen_${userKey}_${guideId}`;
}

export function hasSeenPageGuide(userKey: string, guideId: string): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(pageGuideSeenKey(userKey, guideId)) === "1";
}

export function markPageGuideSeen(userKey: string, guideId: string) {
  try {
    localStorage.setItem(pageGuideSeenKey(userKey, guideId), "1");
  } catch {
    /* ignore */
  }
}

function filterGuideLinks(
  ctx: ErpAiChatContext,
  links: ErpAiLink[] | undefined,
): ErpAiLink[] | undefined {
  if (!links?.length) return undefined;
  const ok = links.filter((l) =>
    canAccessHref(ctx.session, ctx.masters, l.href),
  );
  return ok.length ? ok : undefined;
}

export function erpAiPageGuideMessage(
  guide: ErpAiPageGuide,
  ctx: ErpAiChatContext,
): ErpAiMessage {
  const who = ctx.session.fullName?.split(" ")[0] || "there";
  return {
    id: `guide_${guide.id}_${Date.now()}`,
    role: "assistant",
    at: new Date().toISOString(),
    text: `Hi ${who} — I noticed you're on **${guide.pageLabel}**.\n\n${guide.title}. Here's a quick walkthrough for your first time here:`,
    guideId: guide.id,
    pageLabel: guide.pageLabel,
    steps: guide.steps,
    links: filterGuideLinks(ctx, guide.links),
  };
}

export function pageGuideAllowed(
  guide: ErpAiPageGuide,
  ctx: ErpAiChatContext,
): boolean {
  return hasPermission(ctx.session, ctx.masters, guide.module, "view");
}

export function erpAiPositionKey(userKey: string): string {
  return `bhb_erp_ai_pos_${userKey}`;
}

export type ErpAiPanelPosition = { x: number; y: number };

export function loadErpAiPosition(userKey: string): ErpAiPanelPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(erpAiPositionKey(userKey));
    if (!raw) return null;
    const p = JSON.parse(raw) as ErpAiPanelPosition;
    if (typeof p.x === "number" && typeof p.y === "number") return p;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveErpAiPosition(userKey: string, pos: ErpAiPanelPosition) {
  try {
    localStorage.setItem(erpAiPositionKey(userKey), JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

export function defaultErpAiPosition(
  open: boolean,
  vw = typeof window !== "undefined" ? window.innerWidth : 1200,
  vh = typeof window !== "undefined" ? window.innerHeight : 800,
): ErpAiPanelPosition {
  const w = open ? 380 : 200;
  const h = open ? 520 : 64;
  return {
    x: Math.max(12, vw - w - 16),
    y: Math.max(12, vh - h - 16),
  };
}

export function clampErpAiPosition(
  pos: ErpAiPanelPosition,
  open: boolean,
  vw: number,
  vh: number,
): ErpAiPanelPosition {
  const w = open ? 380 : 220;
  const h = open ? 520 : 72;
  return {
    x: Math.min(Math.max(8, pos.x), Math.max(8, vw - w - 8)),
    y: Math.min(Math.max(8, pos.y), Math.max(8, vh - h - 8)),
  };
}

export function proactiveHintLabel(guide: ErpAiPageGuide): string {
  return `New here? ${guide.chipLabel}`;
}
