import type { Metadata } from "next";
import Image from "next/image";
import { LoginPanel } from "@/components/login/LoginPanel";
import { LoginPwaInstall } from "@/components/pwa/LoginPwaInstall";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { TENANT } from "@/lib/types";

export const metadata: Metadata = {
  title: "Login",
};

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div
        className="atmosphere absolute inset-0"
        aria-hidden
        style={{
          background: `
            radial-gradient(ellipse 70% 55% at 15% 20%, rgba(197,160,40,0.18), transparent 55%),
            radial-gradient(ellipse 60% 50% at 90% 80%, rgba(32,48,80,0.08), transparent 50%),
            linear-gradient(145deg, #f8f8f0 0%, #f3f1e8 45%, #e8eef5 100%)
          `,
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.06]"
        aria-hidden
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23203050' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* Brand frame — all four sides */}
      <div
        className="pointer-events-none absolute inset-0 z-20"
        aria-hidden
        style={{
          borderTop: `10px solid ${TENANT.primaryColor}`,
          borderBottom: `10px solid ${TENANT.primaryColor}`,
          borderLeft: `10px solid ${TENANT.primaryColor}`,
          borderRight: `10px solid ${TENANT.primaryColor}`,
          boxShadow: `inset 0 0 0 3px ${TENANT.goldColor}`,
        }}
      />

      {/* Toggle mounted here per Phase 0; the atmosphere gradient above is
          still hardcoded light-only cream/gold and doesn't yet respond to
          dark mode — full login dark support is Phase 3, not this one. */}
      <div className="absolute top-4 right-4 z-30">
        <ThemeToggle />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-stretch p-2.5 lg:flex-row">
        {/* Pinned to light-mode token values — the atmosphere gradient behind
            this panel is fixed light (see comment above), so --brand-deep/
            --muted must not follow the dark-mode flip or the text disappears
            against it. Full dark-aware version is Phase 3. */}
        <div
          className="flex w-full flex-col justify-between px-6 py-10 lg:w-[48%] lg:px-12"
          style={{ "--brand-deep": "#203050", "--muted": "#5c6478" } as React.CSSProperties}
        >
          <div>
            <div className="flex flex-col items-start gap-5 text-[var(--brand-deep)]">
              <Image
                src={TENANT.logoCrestUrl}
                alt=""
                width={120}
                height={125}
                priority
                className="logo-mark-lg"
                aria-hidden
              />
              <div>
                <div className="font-display text-xl font-bold tracking-[0.08em] uppercase sm:text-2xl">
                  {TENANT.nameDisplay}
                </div>
                <div className="font-tagline mt-2 text-base sm:text-lg">
                  {TENANT.tagline}
                </div>
                <div className="mt-2 text-sm text-[var(--muted)]">
                  {TENANT.city}, {TENANT.state}
                </div>
              </div>
            </div>
            <p className="mt-10 max-w-sm text-sm leading-relaxed text-[var(--muted)] lg:mt-16">
              One workspace for fees, students, attendance, and daily school
              operations — built for {TENANT.name}.
            </p>
          </div>
          <p className="mt-8 text-xs text-[var(--muted)] lg:mt-0">
            {TENANT.domain} · Asia/Kolkata
          </p>
        </div>

        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <LoginPanel />
        </div>
      </div>
      <LoginPwaInstall />
    </div>
  );
}
