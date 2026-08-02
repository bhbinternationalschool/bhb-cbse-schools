import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BookOpen,
  Bus,
  CalendarClock,
  ClipboardCheck,
  FileBarChart2,
  GraduationCap,
  HardHat,
  IndianRupee,
  IdCard,
  MapPinned,
  Images,
  Megaphone,
  MessagesSquare,
  Newspaper,
  NotebookPen,
  Package,
  ScrollText,
  Settings2,
  Shield,
  ToggleLeft,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";

export type HubTone =
  | "navy"
  | "gold"
  | "teal"
  | "sky"
  | "rose"
  | "violet"
  | "slate"
  | "green";

export type HubDef = {
  href: string;
  title: string;
  blurb: string;
  detail: string;
  icon: LucideIcon;
  tone: HubTone;
};

export type HubGroup = {
  id: string;
  label: string;
  purpose: string;
  tone: HubTone;
  hubs: HubDef[];
};

export const TONE: Record<
  HubTone,
  { icon: string; chip: string; bar: string; soft: string }
> = {
  navy: {
    icon: "bg-[rgba(32,48,80,0.1)] text-[var(--brand-deep)]",
    chip: "bg-[rgba(32,48,80,0.08)] text-[var(--brand-deep)]",
    bar: "bg-[var(--brand-deep)]",
    soft: "from-[rgba(32,48,80,0.06)] to-transparent",
  },
  gold: {
    icon: "bg-[rgba(197,160,40,0.18)] text-[#8a6d12]",
    chip: "bg-[rgba(197,160,40,0.14)] text-[#8a6d12]",
    bar: "bg-[var(--brand-gold)]",
    soft: "from-[rgba(197,160,40,0.12)] to-transparent",
  },
  teal: {
    icon: "bg-[rgba(15,118,110,0.12)] text-[#0f766e]",
    chip: "bg-[rgba(15,118,110,0.1)] text-[#0f766e]",
    bar: "bg-[#0f766e]",
    soft: "from-[rgba(15,118,110,0.08)] to-transparent",
  },
  sky: {
    icon: "bg-[rgba(2,132,199,0.12)] text-[#0369a1]",
    chip: "bg-[rgba(2,132,199,0.1)] text-[#0369a1]",
    bar: "bg-[#0284c7]",
    soft: "from-[rgba(2,132,199,0.08)] to-transparent",
  },
  rose: {
    icon: "bg-[rgba(180,35,24,0.1)] text-[#b42318]",
    chip: "bg-[rgba(180,35,24,0.08)] text-[#b42318]",
    bar: "bg-[#b42318]",
    soft: "from-[rgba(180,35,24,0.06)] to-transparent",
  },
  violet: {
    icon: "bg-[rgba(91,33,182,0.1)] text-[#5b21b6]",
    chip: "bg-[rgba(91,33,182,0.08)] text-[#5b21b6]",
    bar: "bg-[#5b21b6]",
    soft: "from-[rgba(91,33,182,0.06)] to-transparent",
  },
  slate: {
    icon: "bg-[rgba(71,85,105,0.12)] text-[#334155]",
    chip: "bg-[rgba(71,85,105,0.1)] text-[#334155]",
    bar: "bg-[#475569]",
    soft: "from-[rgba(71,85,105,0.08)] to-transparent",
  },
  green: {
    icon: "bg-[rgba(15,122,76,0.12)] text-[#0f7a4c]",
    chip: "bg-[rgba(15,122,76,0.1)] text-[#0f7a4c]",
    bar: "bg-[#0f7a4c]",
    soft: "from-[rgba(15,122,76,0.08)] to-transparent",
  },
};

export const HUB_GROUPS: HubGroup[] = [
  {
    id: "setup",
    label: "Setup & control",
    purpose: "Configure the school once — everything else reads from here.",
    tone: "navy",
    hubs: [
      {
        href: "/masters",
        title: "Masters",
        blurb: "Campus foundation",
        detail:
          "Sessions, classes, sections, fee heads, staff roles and school timings.",
        icon: Settings2,
        tone: "navy",
      },
      {
        href: "/modules",
        title: "Modules",
        blurb: "Feature switches",
        detail: "Turn optional products on or off for this tenant.",
        icon: ToggleLeft,
        tone: "navy",
      },
      {
        href: "/vault",
        title: "Document vault",
        blurb: "Compliance docs",
        detail: "NOC, affiliation and expiry alerts in one secure shelf.",
        icon: Shield,
        tone: "slate",
      },
    ],
  },
  {
    id: "growth",
    label: "Admissions & outreach",
    purpose: "Fill seats — from enquiry and field capture through to enrollment.",
    tone: "gold",
    hubs: [
      {
        href: "/admissions",
        title: "Admissions",
        blurb: "CRM · RTE · enroll",
        detail:
          "Campaigns, enquiry CRM, registration, RTE/EWS and admission reports.",
        icon: UserPlus,
        tone: "gold",
      },
      {
        href: "/field",
        title: "Field app",
        blurb: "On-ground team",
        detail: "Lead capture, UPI collect, calling scripts and survey agents.",
        icon: MapPinned,
        tone: "gold",
      },
    ],
  },
  {
    id: "people",
    label: "People",
    purpose: "Student and staff records that drive fees, attendance and payroll.",
    tone: "sky",
    hubs: [
      {
        href: "/students",
        title: "Students",
        blurb: "SIS roster",
        detail:
          "Households, profiles, UDISE sync, upgrades, tags and student reports.",
        icon: Users,
        tone: "sky",
      },
      {
        href: "/staff",
        title: "Staff",
        blurb: "HR roster",
        detail: "Profiles, leave, duties, appraisal and staff payslips.",
        icon: IdCard,
        tone: "slate",
      },
    ],
  },
  {
    id: "academics",
    label: "Academics & parent touch",
    purpose: "Day-to-day teaching, presence, exams and parent meetings.",
    tone: "violet",
    hubs: [
      {
        href: "/attendance",
        title: "Attendance",
        blurb: "Register & presence",
        detail: "Class teacher marks students on phone/tablet (bulk P/A). Staff punch separately.",
        icon: ClipboardCheck,
        tone: "green",
      },
      {
        href: "/student-leave",
        title: "Student leave",
        blurb: "Parent requests",
        detail: "Approve leave, holiday policy and parent portal requests.",
        icon: IdCard,
        tone: "green",
      },
      {
        href: "/homework",
        title: "Homework",
        blurb: "Class diary",
        detail: "Assign work by class and publish to the parent portal feed.",
        icon: NotebookPen,
        tone: "gold",
      },
      {
        href: "/timetable",
        title: "Timetable",
        blurb: "AI auto-assign",
        detail: "Bell periods, weekly grids, and auto-assign from subject loads + teacher duties.",
        icon: CalendarClock,
        tone: "violet",
      },
      {
        href: "/ptm",
        title: "PTM",
        blurb: "Meetings",
        detail: "Slot booking, parent feedback and teacher follow-ups.",
        icon: UsersRound,
        tone: "violet",
      },
      {
        href: "/exams",
        title: "Exams",
        blurb: "Marks & promote",
        detail: "Assessment entry, result sheets and class promotion.",
        icon: GraduationCap,
        tone: "violet",
      },
      {
        href: "/certificates",
        title: "Certificates",
        blurb: "Official letters",
        detail: "TC, bonafide, fee and character certificates for print.",
        icon: ScrollText,
        tone: "navy",
      },
      {
        href: "/comms?tab=channels",
        title: "Class WhatsApp",
        blurb: "Teacher → ERP",
        detail: "Class channels: teachers post HW/notices on WA; ERP fills modules and notifies parents.",
        icon: MessagesSquare,
        tone: "violet",
      },
      {
        href: "/comms?tab=notices",
        title: "Notices",
        blurb: "Circulars",
        detail: "Publish school notices for staff and parents.",
        icon: Megaphone,
        tone: "sky",
      },
      {
        href: "/comms?tab=news",
        title: "News",
        blurb: "Campus stories",
        detail: "School news feed with optional cover images.",
        icon: Newspaper,
        tone: "teal",
      },
      {
        href: "/comms?tab=gallery",
        title: "Gallery",
        blurb: "Photo albums",
        detail: "Event albums parents can browse on the portal.",
        icon: Images,
        tone: "gold",
      },
    ],
  },
  {
    id: "finance",
    label: "Fees, store & finance",
    purpose: "Money in, money out — fees, shop, books and payroll in one chain.",
    tone: "teal",
    hubs: [
      {
        href: "/fees",
        title: "Fee Take",
        blurb: "Counter collect",
        detail: "Due pickup, UPI/cash, receipts, pay links and day close.",
        icon: IndianRupee,
        tone: "gold",
      },
      {
        href: "/fees/defaulters",
        title: "Defaulters",
        blurb: "Recovery playbook",
        detail: "Overdue lists, WhatsApp nudges and collection follow-ups.",
        icon: AlertTriangle,
        tone: "rose",
      },
      {
        href: "/library",
        title: "Library",
        blurb: "Issue · return",
        detail: "Book lending, overdue fines and parent reminders.",
        icon: BookOpen,
        tone: "violet",
      },
      {
        href: "/store",
        title: "Store",
        blurb: "Books · issue",
        detail: "Stock master, sell-issue, returns and store accounts.",
        icon: BookOpen,
        tone: "green",
      },
      {
        href: "/purchase",
        title: "Purchase",
        blurb: "Indent · PO · GRN",
        detail: "Indents, purchase orders, goods receipt and returns.",
        icon: Package,
        tone: "green",
      },
      {
        href: "/accounts",
        title: "Accounts",
        blurb: "School books",
        detail:
          "Cashbook, day book, ledgers, trial balance, P&L and balance sheet.",
        icon: Wallet,
        tone: "teal",
      },
      {
        href: "/payroll",
        title: "Payroll",
        blurb: "Salary cycle",
        detail: "Salary run, advances, payslips, bank file and statutory remit.",
        icon: IndianRupee,
        tone: "teal",
      },
    ],
  },
  {
    id: "campus",
    label: "Campus operations",
    purpose: "Move students safely and track trust-side construction spend.",
    tone: "slate",
    hubs: [
      {
        href: "/transport",
        title: "Transport",
        blurb: "Fleet & routes",
        detail: "Routes, vehicles, stops, transport dues and fleet payables.",
        icon: Bus,
        tone: "sky",
      },
      {
        href: "/trust",
        title: "Trust / CWIP",
        blurb: "Construction",
        detail: "Projects, BOQ, RA bills and capital work-in-progress.",
        icon: HardHat,
        tone: "slate",
      },
      {
        href: "/rte",
        title: "RTE / EWS",
        blurb: "Quota seats",
        detail: "Right to Education and EWS admissions tracking.",
        icon: Shield,
        tone: "slate",
      },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    purpose: "Cross-module reports in one place.",
    tone: "navy",
    hubs: [
      {
        href: "/reports",
        title: "Reports",
        blurb: "Export centre",
        detail: "Run and download reports across fees, SIS, payroll and more.",
        icon: FileBarChart2,
        tone: "navy",
      },
    ],
  },
];


export const QUICK_HREFS = ["/fees", "/students", "/admissions", "/store", "/accounts"];
