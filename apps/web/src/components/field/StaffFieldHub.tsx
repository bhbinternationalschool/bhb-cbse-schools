"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  findSurveyMemberForSession,
  reloadAdmissionsWithSurvey,
} from "@/lib/fieldSurvey";
import { isLeadCaller, loadAdmissions } from "@/lib/admissions";
import type { DemoSession } from "@/lib/auth";
import { TENANT } from "@/lib/types";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";

export function StaffFieldHub({ session }: { session: DemoSession }) {
  const router = useRouter();
  const [surveyAssigned, setSurveyAssigned] = useState(false);
  const [callerAssigned, setCallerAssigned] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const adm = reloadAdmissionsWithSurvey();
    const member = findSurveyMemberForSession(adm, {
      staffId: session.staffId || undefined,
    });
    setSurveyAssigned(!!member);
    setCallerAssigned(isLeadCaller(loadAdmissions(), session.staffId));
  }, [session.staffId]);

  const tiles = useMemo(() => {
    const all = [
      {
        label: "Capture lead",
        hi: "Enquiry",
        href: "/field/capture",
        show: true,
        primary: true,
      },
      {
        label: "Registration UPI",
        hi: "Collect",
        href: "/field/register",
        show: true,
        primary: true,
      },
      {
        label: "Lead calling",
        hi: callerAssigned ? "My leads" : "Locked",
        href: "/field/calling",
        show: true,
        primary: false,
        locked: !callerAssigned,
      },
      {
        label: "Survey",
        hi: surveyAssigned ? "Start" : "Not assigned",
        href: "/field/survey",
        show: true,
        primary: false,
        locked: !surveyAssigned,
      },
    ];
    return all.filter((t) => t.show);
  }, [callerAssigned, surveyAssigned]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-10">
      <Image
        src={TENANT.logoCrestUrl}
        alt=""
        width={72}
        height={75}
        className="logo-mark object-contain"
        priority
        aria-hidden
      />
      <p className="font-brand-name mt-3 text-sm text-[var(--brand-deep)]">
        {TENANT.nameDisplay}
      </p>
      <h1 className="mt-4 text-2xl font-semibold text-[var(--brand-deep)]">
        Staff field app
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {session.fullName}
        {session.staffId ? "" : " · demo"} — capture &amp; collect anywhere;
        lists only if assigned for calling / survey
      </p>

      <div className="mt-4">
        <ModuleDashboardHost moduleId="field" />
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className={`flex aspect-square flex-col items-center justify-center rounded-2xl border text-center ${
              t.locked
                ? "border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.04)] opacity-70"
                : t.primary
                  ? "border-[rgba(154,52,18,0.35)] bg-[rgba(154,52,18,0.1)]"
                  : "border-[rgba(32,48,80,0.12)] bg-[var(--brand-cream)]"
            }`}
          >
            <span className="text-lg font-semibold text-[var(--brand-deep)]">
              {t.label}
            </span>
            <span className="mt-1 text-sm text-[var(--muted)]">{t.hi}</span>
          </Link>
        ))}
      </div>

      <button
        type="button"
        disabled={signingOut}
        className="mt-10 w-full rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-3 text-sm disabled:opacity-60"
        onClick={async () => {
          if (signingOut) return;
          setSigningOut(true);
          try {
            await fetch("/api/auth/demo", { method: "DELETE" });
            router.push("/login");
            router.refresh();
          } finally {
            setSigningOut(false);
          }
        }}
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>

      {session.persona === "staff" ? (
        <Link
          href="/home"
          className="mt-4 block text-center text-sm text-[var(--muted)] underline"
        >
          Open full workspace
        </Link>
      ) : null}
    </div>
  );
}
