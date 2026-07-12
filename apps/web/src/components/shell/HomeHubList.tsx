"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BookOpen,
  Bus,
  ClipboardCheck,
  GraduationCap,
  IndianRupee,
  ScrollText,
  Settings2,
  Users,
} from "lucide-react";

const HUBS: {
  href: string;
  title: string;
  blurb: string;
  icon: LucideIcon;
  tone: string;
}[] = [
  {
    href: "/masters",
    title: "Masters",
    blurb: "Campus, classes, fees",
    icon: Settings2,
    tone: "bg-[rgba(32,48,80,0.08)] text-[var(--brand-deep)]",
  },
  {
    href: "/students",
    title: "Students",
    blurb: "SIS roster & households",
    icon: Users,
    tone: "bg-[rgba(30,64,175,0.1)] text-[#1e40af]",
  },
  {
    href: "/store",
    title: "Store",
    blurb: "Books & uniforms",
    icon: BookOpen,
    tone: "bg-[rgba(15,122,76,0.1)] text-[#0f7a4c]",
  },
  {
    href: "/transport",
    title: "Transport",
    blurb: "Routes & bus dues",
    icon: Bus,
    tone: "bg-[rgba(14,116,144,0.12)] text-[#0e7490]",
  },
  {
    href: "/fees",
    title: "Fee Take",
    blurb: "Collect · UPI · close",
    icon: IndianRupee,
    tone: "bg-[rgba(197,160,40,0.18)] text-[#8a6d12]",
  },
  {
    href: "/fees/defaulters",
    title: "Defaulters",
    blurb: "Overdue · WhatsApp",
    icon: AlertTriangle,
    tone: "bg-[rgba(180,35,24,0.1)] text-[#b42318]",
  },
  {
    href: "/attendance",
    title: "Attendance",
    blurb: "Daily section register",
    icon: ClipboardCheck,
    tone: "bg-[rgba(21,128,61,0.1)] text-[#15803d]",
  },
  {
    href: "/exams",
    title: "Exams",
    blurb: "Marks · promote",
    icon: GraduationCap,
    tone: "bg-[rgba(91,33,182,0.1)] text-[#5b21b6]",
  },
  {
    href: "/certificates",
    title: "Certificates",
    blurb: "TC · bonafide · fees",
    icon: ScrollText,
    tone: "bg-[rgba(32,48,80,0.08)] text-[var(--brand-mid)]",
  },
];

export function HomeHubList() {
  return (
    <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {HUBS.map((h) => {
        const Icon = h.icon;
        return (
          <Link
            key={h.href}
            href={h.href}
            className="group flex flex-col rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-3.5 transition hover:border-[rgba(197,160,40,0.45)] hover:shadow-[0_4px_14px_rgba(32,48,80,0.06)]"
          >
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${h.tone}`}
              aria-hidden
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            </span>
            <span className="mt-2.5 text-sm font-semibold leading-tight text-[var(--brand-deep)] group-hover:text-[var(--brand-deep)]">
              {h.title}
            </span>
            <span className="mt-1 text-[11px] leading-snug text-[var(--muted)]">
              {h.blurb}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
