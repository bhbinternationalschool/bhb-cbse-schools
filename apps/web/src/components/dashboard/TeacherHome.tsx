"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BookMarked,
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
import { classifyClassHolidayDay } from "@/lib/holidayPolicy";
import { TONE } from "@/lib/erpNav";
import { loadMasters } from "@/lib/masters";
import { inferRoleCodes } from "@/lib/rbac";
import { listSessionClassTeacherSections, resolveSessionStaff } from "@/lib/staffResolve";
import {
  computeDelivery,
  loadTeaching,
  resolveExpectedPeriods,
} from "@/lib/teaching";
import { loadTimetable } from "@/lib/timetable";
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
    href: "/teaching",
    title: "Period log",
    blurb: "What you taught",
    icon: BookMarked,
    tone: "teal" as const,
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
      const [{ ensureAttendanceHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/attendancePersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      const changed = await withHydrationSlot(() => ensureAttendanceHydrated());
      if (changed) setTick((n) => n + 1);
    })();
    void (async () => {
      const [
        { ensureTimetableHydrated },
        { ensureTeachingHydrated },
        { withHydrationSlot },
      ] = await Promise.all([
        import("@/lib/timetablePersistence"),
        import("@/lib/teachingPersistence"),
        import("@/lib/deskHydrateGuard"),
      ]);
      const [tt, tg] = await Promise.all([
        withHydrationSlot(() => ensureTimetableHydrated()),
        withHydrationSlot(() => ensureTeachingHydrated()),
      ]);
      if (tt || tg) setTick((n) => n + 1);
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
    // Per section, not one blanket check — holidays can be scoped to a
    // single class group, so a section on its own day off must not read
    // as an unmarked register, while the teacher's other sections still do.
    const masters = loadMasters();
    return mySections.filter((s) => {
      if (findRegister(ay, s.sectionId, today)) return false;
      const classification = classifyClassHolidayDay(masters, today, ay, s.classId);
      return classification.status !== "holiday";
    });
  }, [ready, mySections, ay, today, tick]);

  /**
   * Periods that are past their grace window with no log yet. This is a
   * prompt to record what happened — deliberately NOT a claim that the
   * class was missed, which only the teacher can say.
   */
  const unloggedPeriods = useMemo(() => {
    if (!ready) return [];
    const masters = loadMasters();
    const me = resolveSessionStaff(session, masters);
    if (!me) return [];
    const teaching = loadTeaching();
    const expected = resolveExpectedPeriods({
      timetable: loadTimetable(),
      masters,
      academicYearCode: ay,
      date: today,
      staffId: me.id,
    });
    // A day whose schedule cannot be resolved raises nothing — an
    // unpublished timetable is not the teacher's problem to chase.
    if (!expected.ok) return [];
    return computeDelivery({
      expected: expected.periods,
      logs: teaching.logs,
      academicYearCode: ay,
      policy: teaching.policy,
    }).filter((r) => r.status === "unlogged");
  }, [ready, session, ay, today, tick]);

  const firstName = session.fullName.split(/\s+/)[0] || session.fullName;

  if (!ready) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading your class desk…</p>
    );
  }

  return (
    <div className="teacher-home mx-auto max-w-lg space-y-5 pb-2 sm:max-w-2xl">
      <section className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--primary)] px-5 py-6 text-[var(--primary-foreground)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse 70% 80% at 100% 0%, rgba(197,160,40,0.5), transparent 55%)",
          }}
          aria-hidden
        />
        <p className="relative text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--primary-foreground)]/70">
          {TENANT.shortName} · Teacher
        </p>
        <h1 className="relative mt-1 font-display text-2xl font-semibold tracking-tight">
          Hello, {firstName}
        </h1>
        <p className="relative mt-1 text-sm text-[var(--primary-foreground)]/80">
          {istWeekdayLine()}
        </p>
        <p
          className="relative mt-0.5 text-[11px] text-[var(--primary-foreground)]/55"
          suppressHydrationWarning
        >
          {formatIst()}
        </p>
      </section>

      {pendingAttendance.length > 0 ? (
        <Link
          href="/attendance?tab=students"
          className="flex items-start gap-3 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-4 py-3 transition hover:border-[var(--danger)]/40"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--danger)]" />
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
        <div className="rounded-xl border border-[var(--success)]/20 bg-[var(--success-soft)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--success)]">
            Today&apos;s attendance is done
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {mySections.map((s) => s.label).join(" · ")}
          </p>
        </div>
      ) : null}

      {unloggedPeriods.length > 0 ? (
        <Link
          href="/teaching"
          className="flex items-start gap-3 rounded-xl border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-4 py-3 transition hover:border-[var(--warning)]/40"
        >
          <NotebookPen className="mt-0.5 h-5 w-5 shrink-0 text-[var(--warning)]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--brand-deep)]">
              {unloggedPeriods.length} period
              {unloggedPeriods.length === 1 ? "" : "s"} not logged yet
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {unloggedPeriods
                .map((p) => p.expected.bellLabel)
                .join(" · ")}
            </p>
          </div>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[var(--muted)]" />
        </Link>
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
                className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] shadow-[var(--shadow-1)]"
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
                className="teacher-home-tile flex min-h-[6.5rem] flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3.5 transition active:scale-[0.98] hover:border-[rgba(197,160,40,0.45)] hover:shadow-md"
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

      <section className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3">
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
