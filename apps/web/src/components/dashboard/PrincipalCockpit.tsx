"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  GraduationCap,
  IndianRupee,
  RefreshCw,
  Users,
} from "lucide-react";
import { formatInr } from "@/lib/masters";
import type { PrincipalSnapshot } from "@/lib/principalSnapshot.server";
import { isProtectedSuperAdminEmail } from "@/lib/superAdmin";
import { useDemoSession } from "@/components/shell/SessionContext";

function KpiCard({
  label,
  value,
  hint,
  href,
  tone = "navy",
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: "navy" | "teal" | "rose" | "gold";
}) {
  const tones = {
    navy: "border-[rgba(32,48,80,0.12)]",
    teal: "border-[rgba(15,118,110,0.25)]",
    rose: "border-[rgba(180,35,24,0.2)]",
    gold: "border-[rgba(197,160,40,0.35)]",
  };
  const inner = (
    <div
      className={`rounded-2xl border bg-white p-4 transition hover:shadow-md ${tones[tone]}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-semibold text-[var(--brand-deep)]">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>
      ) : null}
      {href ? (
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-deep)]">
          Open <ArrowRight className="h-3 w-3" />
        </span>
      ) : null}
    </div>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block cursor-pointer"
        onClick={() => {
          if (typeof window !== "undefined") {
            window.location.href = href;
          }
        }}
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

export function PrincipalCockpit() {
  const session = useDemoSession();
  const [snap, setSnap] = useState<PrincipalSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/principal/snapshot?academicYearCode=${encodeURIComponent(session.academicYearCode)}&_t=${Date.now()}`,
        {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        },
      );
      const body = (await res.json()) as {
        ok?: boolean;
        data?: PrincipalSnapshot;
        error?: { message?: string };
      };
      if (!res.ok || !body.ok || !body.data) {
        setErr(body.error?.message || "Could not load dashboard");
        return;
      }
      setErr(null);
      setSnap(body.data);
    } catch {
      setErr("Network error loading principal snapshot");
    } finally {
      setLoading(false);
    }
  }, [session.academicYearCode]);

  useEffect(() => {
    void fetchSnapshot();

    function onDataUpdate() {
      void fetchSnapshot();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void fetchSnapshot();
      }
    }

    window.addEventListener("bhb-desk-hydrated", onDataUpdate);
    window.addEventListener("bhb-desk-synced", onDataUpdate);
    window.addEventListener("bhb-masters-updated", onDataUpdate);
    window.addEventListener("focus", onDataUpdate);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("bhb-desk-hydrated", onDataUpdate);
      window.removeEventListener("bhb-desk-synced", onDataUpdate);
      window.removeEventListener("bhb-masters-updated", onDataUpdate);
      window.removeEventListener("focus", onDataUpdate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchSnapshot]);

  if (err) {
    return (
      <div className="p-4">
        <p className="text-sm text-[#b42318]">{err}</p>
        <button
          onClick={() => void fetchSnapshot()}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-deep)] underline"
        >
          Retry
        </button>
      </div>
    );
  }
  const displaySnap: PrincipalSnapshot = snap ?? {
    generatedAt: new Date().toISOString(),
    academicYearCode: session.academicYearCode || "2025-26",
    fees: { todayCollectionPaise: 0, mtdCollectionPaise: 0, openDuesPaise: 0, defaulterHouseholds: 0 },
    attendance: { date: "Today", studentPresent: 0, studentAbsent: 0, studentLeave: 0, studentMarkedPct: 0, sectionsMarked: 0 },
    staff: { activeCount: 0, presentToday: 0, absentToday: 0 },
    admissions: { pipeline: 0, enrolled: 0, followUpsDue: 0 },
    alerts: { vaultExpiring30d: 0, lowStockSkus: 0, attendanceRegistersPending: 0 },
  };

  const alerts: { text: string; href: string }[] = [];
  if (displaySnap.alerts.attendanceRegistersPending > 0) {
    alerts.push({
      text: `${displaySnap.alerts.attendanceRegistersPending} class registers not marked today`,
      href: "/attendance?tab=students",
    });
  }
  if (displaySnap.fees.defaulterHouseholds > 0) {
    alerts.push({
      text: `${displaySnap.fees.defaulterHouseholds} students with open dues`,
      href: "/fees/defaulters",
    });
  }
  if (displaySnap.alerts.vaultExpiring30d > 0) {
    alerts.push({
      text: `${displaySnap.alerts.vaultExpiring30d} compliance docs expiring soon`,
      href: "/vault",
    });
  }

  return (
    <div className="principal-cockpit mx-auto max-w-5xl space-y-5 pb-4">
      <section className="relative rounded-2xl border border-[rgba(32,48,80,0.1)] bg-[var(--brand-deep)] px-5 py-6 text-white">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/70">
            Principal desk · {displaySnap.academicYearCode}
          </p>
          <button
            onClick={() => void fetchSnapshot()}
            disabled={loading}
            title="Refresh Dashboard Data"
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-50 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold">
          Good day, {session.fullName.split(/\s+/)[0]}
        </h1>
        <p className="mt-1 text-sm text-white/75">
          School pulse for {displaySnap.attendance.date}
        </p>
      </section>

      {alerts.length > 0 ? (
        <div className="space-y-2">
          {alerts.map((a) => (
            <Link
              key={a.text}
              href={a.href}
              className="flex items-center gap-2 rounded-xl border border-[rgba(180,35,24,0.2)] bg-[rgba(180,35,24,0.05)] px-4 py-3 text-sm font-medium text-[var(--brand-deep)]"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-[#b42318]" />
              {a.text}
              <ArrowRight className="ml-auto h-4 w-4 opacity-50" />
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Today&apos;s collection"
          value={formatInr(displaySnap.fees.todayCollectionPaise)}
          hint={`MTD ${formatInr(displaySnap.fees.mtdCollectionPaise)}`}
          href="/fees"
          tone="gold"
        />
        <KpiCard
          label="Open dues"
          value={formatInr(displaySnap.fees.openDuesPaise)}
          hint={`${displaySnap.fees.defaulterHouseholds} students`}
          href="/fees/defaulters"
          tone="rose"
        />
        <KpiCard
          label="Student attendance"
          value={`${displaySnap.attendance.studentMarkedPct}%`}
          hint={`${displaySnap.attendance.sectionsMarked} sections marked`}
          href="/attendance"
          tone="teal"
        />
        <KpiCard
          label="Staff present"
          value={`${displaySnap.staff.presentToday}/${displaySnap.staff.activeCount}`}
          hint={`${displaySnap.staff.absentToday} absent today`}
          href="/attendance?tab=staff"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Admissions pipeline"
          value={String(displaySnap.admissions.pipeline)}
          hint={`${displaySnap.admissions.enrolled} enrolled · ${displaySnap.admissions.followUpsDue} follow-ups`}
          href="/admissions"
        />
        <KpiCard
          label="Low stock SKUs"
          value={String(displaySnap.alerts.lowStockSkus)}
          href="/store"
        />
        <KpiCard
          label="Library"
          value="Open"
          hint="Issue / return desk"
          href="/library"
        />
      </div>

      <section className="grid gap-2 sm:grid-cols-4">
        {[
          { href: "/students", label: "Students", icon: GraduationCap },
          { href: "/staff", label: "Staff", icon: Users },
          { href: "/homework", label: "Homework", icon: BookOpen },
          { href: "/fees", label: "Fees", icon: IndianRupee },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.href = item.href;
                }
              }}
              className="flex items-center gap-2 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-3 py-3 text-sm font-semibold text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.05)] cursor-pointer"
            >
              <Icon className="h-4 w-4 opacity-70" />
              {item.label}
            </Link>
          );
        })}
      </section>

      <p className="text-center text-[10px] text-[var(--muted)]">
        <Link href="/home?view=full" className="underline">
          Full analytics dashboard
        </Link>
        {" · "}
        <Link href="/api/v1/openapi" className="underline" target="_blank">
          API v1 docs
        </Link>
      </p>
    </div>
  );
}

export function shouldShowPrincipalCockpit(
  session: { roleCode: string; persona?: string; email?: string | null },
): boolean {
  if ((session.persona || "staff") !== "staff") return false;
  // Super admin (owner) gets the full school dashboard, not the principal cockpit.
  const rc = (session.roleCode || "").toLowerCase();
  if (rc === "owner" || /super.?admin/.test(rc)) return false;
  if (isProtectedSuperAdminEmail(session.email)) return false;
  return /principal|admin|hm|head.?master|vice.?principal/.test(rc);
}
