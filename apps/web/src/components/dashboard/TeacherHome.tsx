"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  LayoutGrid,
  MessagesSquare,
  NotebookPen,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { formatIst } from "@bhb/time";
import { useDemoSession } from "@/components/shell/SessionContext";
import { findRegister, todayIso } from "@/lib/attendance";
import { isTeacherOnly } from "@/lib/erpChatAccess";
import { TONE } from "@/lib/erpNav";
import { loadMasters } from "@/lib/masters";
import { inferRoleCodes } from "@/lib/rbac";
import { listSessionClassTeacherSections } from "@/lib/staffResolve";
import { TENANT } from "@/lib/types";

const ACTIONS = [
  {
    href: "/attendance?tab=students",
    title: "Attendance",
    blurb: "Mark register",
    icon: ClipboardCheck,
    tone: "teal" as const,
  },
  {
    href: "/homework",
    title: "Homework",
    blurb: "Class diary",
    icon: BookOpen,
    tone: "sky" as const,
  },
  {
    href: "/timetable",
    title: "Timetable",
    blurb: "Today's periods",
    icon: CalendarClock,
    tone: "violet" as const,
  },
  {
    href: "/ptm",
    title: "PTM",
    blurb: "Parent meetings",
    icon: NotebookPen,
    tone: "rose" as const,
  },
  {
    href: "/comms",
    title: "Class WA",
    blurb: "Notices & channels",
    icon: MessagesSquare,
    tone: "green" as const,
  },
  {
    href: "/student-leave",
    title: "Leave",
    blurb: "Student requests",
    icon: ClipboardCheck,
    tone: "slate" as const,
  },
] as const;

function istWeekdayLine() {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

export function TeacherHome({ onOpenFullDashboard }: { onOpenFullDashboard?: () => void }) {
  const session = useDemoSession();
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setReady(true);
    setTick((n) => n + 1);
    void (async () => {
      const { ensureAttendanceHydrated } = await import(
        "@/lib/attendancePersistence"
      );
      const changed = await ensureAttendanceHydrated();
      if (changed) setTick((n) => n + 1);
    })();
  }, []);

  const ay = session.academicYearCode;
  const today = todayIso();

  const mySections = useMemo(() => {
    if (!ready) return [];
    const masters = loadMasters();
    return listSessionClassTeacherSections(session, masters, ay);
  }, [ready, session, ay, tick]);

  const pendingAttendance = useMemo(() => {
    if (!ready) return [];
    return mySections.filter(
      (s) => !findRegister(ay, s.sectionId, today),
    );
  }, [ready, mySections, ay, today, tick]);

  const firstName = session.fullName.split(/\s+/)[0] || session.fullName;

  if (!ready) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading your class desk…</p>
    );
  }

  return (
    <div className="teacher-home mx-auto max-w-lg space-y-5 pb-2 sm:max-w-2xl">
      <section className="relative overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.1)] bg-[var(--brand-deep)] px-5 py-6 text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse 70% 80% at 100% 0%, rgba(197,160,40,0.5), transparent 55%)",
          }}
          aria-hidden
        />
        <p className="relative text-[11px] font-bold uppercase tracking-[0.12em] text-white/70">
          {TENANT.shortName} · Teacher
        </p>
        <h1 className="relative mt-1 font-display text-2xl font-semibold tracking-tight">
          Hello, {firstName}
        </h1>
        <p className="relative mt-1 text-sm text-white/80">{istWeekdayLine()}</p>
        <p className="relative mt-0.5 text-[11px] text-white/55" suppressHydrationWarning>
          {formatIst()}
        </p>
      </section>

      {pendingAttendance.length > 0 ? (
        <Link
          href="/attendance?tab=students"
          className="flex items-start gap-3 rounded-xl border border-[rgba(180,35,24,0.25)] bg-[rgba(180,35,24,0.06)] px-4 py-3 transition hover:border-[rgba(180,35,24,0.4)]"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#b42318]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--brand-deep)]">
              Attendance not marked today
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {pendingAttendance.map((s) => s.label).join(" · ")}
            </p>
          </div>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[var(--muted)]" />
        </Link>
      ) : mySections.length > 0 ? (
        <div className="rounded-xl border border-[rgba(15,118,110,0.2)] bg-[rgba(15,118,110,0.06)] px-4 py-3">
          <p className="text-sm font-semibold text-[#0f766e]">
            Today&apos;s attendance is done
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {mySections.map((s) => s.label).join(" · ")}
          </p>
        </div>
      ) : null}

      {mySections.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
            Your classes
          </h2>
          <div className="flex flex-wrap gap-2">
            {mySections.map((s) => (
              <Link
                key={`${s.classId}-${s.sectionId}`}
                href="/attendance?tab=students"
                className="rounded-full border border-[rgba(32,48,80,0.12)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] shadow-sm"
              >
                {s.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
          Quick actions
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ACTIONS.map((action) => {
            const Icon = action.icon;
            const tone = TONE[action.tone];
            return (
              <Link
                key={action.href}
                href={action.href}
                className="teacher-home-tile flex min-h-[6.5rem] flex-col rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white p-3.5 transition active:scale-[0.98] hover:border-[rgba(197,160,40,0.45)] hover:shadow-md"
              >
                <span
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${tone.icon}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="mt-2 text-sm font-semibold text-[var(--brand-deep)]">
                  {action.title}
                </span>
                <span className="text-[10px] font-medium text-[var(--muted)]">
                  {action.blurb}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-dashed border-[rgba(32,48,80,0.15)] bg-[rgba(32,48,80,0.03)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-[var(--muted)]" />
            <p className="text-xs text-[var(--muted)]">
              Fees, exams, reports &amp; admin modules
            </p>
          </div>
          {onOpenFullDashboard ? (
            <button
              type="button"
              onClick={onOpenFullDashboard}
              className="shrink-0 text-xs font-semibold text-[var(--brand-deep)] underline"
            >
              Full ERP
            </button>
          ) : (
            <span className="shrink-0 text-[10px] font-semibold text-[var(--muted)]">
              Modules tab
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

/** Whether this session should see the simplified teacher home (not principal/admin). */
export function shouldShowTeacherHome(
  session: { roleCode: string; persona?: string; staffId?: string; email?: string; fullName: string },
  mastersLoaded: boolean,
): boolean {
  if (!mastersLoaded) return false;
  if ((session.persona || "staff") !== "staff") return false;
  const masters = loadMasters();
  const roles = inferRoleCodes(session, masters);
  return isTeacherOnly(roles);
}
