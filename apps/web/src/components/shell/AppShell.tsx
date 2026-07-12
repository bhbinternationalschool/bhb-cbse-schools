"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { formatIst } from "@bhb/time";
import { SessionSelector } from "./SessionSelector";
import { ACADEMIC_YEARS, TENANT } from "@/lib/types";
import type { DemoSession } from "@/lib/auth";
import { SessionProvider } from "./SessionContext";

const NAV = [
  { href: "/home", label: "Home" },
  { href: "/masters", label: "Masters" },
  { href: "/students", label: "Students" },
  { href: "/store", label: "Store" },
  { href: "/transport", label: "Transport" },
  { href: "/fees", label: "Fee Take" },
  { href: "/fees/defaulters", label: "Defaulters" },
  { href: "/attendance", label: "Attendance" },
  { href: "/exams", label: "Exams" },
  { href: "/certificates", label: "Certificates" },
];

export function AppShell({
  session,
  children,
}: {
  session: DemoSession;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const ay = ACADEMIC_YEARS.find((y) => y.code === session.academicYearCode);
  const readOnly = ay?.status === "closed";

  async function logout() {
    await fetch("/api/auth/demo", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <SessionProvider session={session}>
    <div className="min-h-screen bg-[var(--surface)]">
      <header className="sticky top-0 z-20 border-b border-[rgba(32,48,80,0.1)] bg-[rgba(248,248,240,0.92)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/home" className="flex items-center gap-2.5 shrink-0">
            <Image
              src={TENANT.logoCrestUrl}
              alt=""
              width={42}
              height={44}
              className="logo-mark object-contain"
              priority
              aria-hidden
            />
            <div className="leading-tight min-w-0">
              <div className="font-display truncate text-sm font-bold tracking-wide text-[var(--brand-deep)] uppercase">
                {TENANT.nameDisplay}
              </div>
              <div className="font-tagline truncate text-[11px]">{TENANT.tagline}</div>
            </div>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/home" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-2.5 py-1.5 text-sm ${
                    active
                      ? "bg-[rgba(32,48,80,0.08)] font-semibold text-[var(--brand-deep)]"
                      : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <SessionSelector currentCode={session.academicYearCode} />
            {readOnly ? (
              <span className="hidden rounded-md bg-[rgba(197,160,40,0.18)] px-2 py-1 text-[11px] font-medium text-[var(--brand-deep)] sm:inline">
                Read-only
              </span>
            ) : null}
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
                style={{
                  background: TENANT.goldColor,
                  color: TENANT.primaryColor,
                }}
                title={session.fullName}
              >
                {initials(session.fullName)}
              </span>
              <div className="hidden text-right sm:block">
                <div className="text-xs font-medium text-[var(--brand-deep)]">
                  {session.fullName}
                </div>
                <div className="text-[10px] text-[var(--muted)]">
                  {formatIst()}
                </div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="text-xs text-[var(--muted)] hover:text-[var(--brand-deep)]"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
    </SessionProvider>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
