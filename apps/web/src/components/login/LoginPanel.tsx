"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Image from "next/image";
import type { Persona } from "@/lib/types";
import { TENANT } from "@/lib/types";
import { prepareWorkspaceAfterLogin } from "@/lib/workspaceClientSession";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import {
  createBrowserSupabase,
  isDemoAuth,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

const PERSONAS: {
  id: Persona;
  label: string;
  headline: string;
  button: string;
  productionHint: string;
  demoHint?: string;
}[] = [
  {
    id: "staff",
    label: "Staff",
    headline: "Office & teaching portal",
    button: "Sign in to workspace",
    productionHint: "Email or phone, and your password",
    demoHint: "Super-admin email, Staff login, or leave blank for demo principal",
  },
  {
    id: "parent",
    label: "Parent",
    headline: "Fees, attendance, bus & notices",
    button: "Sign in",
    productionHint: "Email or phone, and your password",
    demoHint: "Any mobile works in demo mode",
  },
  {
    id: "field",
    label: "Field",
    headline: "Tap your role — big icons next",
    button: "Unlock",
    productionHint: "4-digit PIN from your school",
    demoHint: "4-digit PIN",
  },
];

function routeForPersona(persona: Persona) {
  if (persona === "parent") return "/parent";
  if (persona === "field") return "/field";
  return "/home";
}

function normalizeMobile10(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return d;
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  return null;
}

type IdentifierType = "email" | "phone";
type LoginMode = "signin" | "first-time";
type FirstTimeStep = "phone" | "otp";

export function LoginPanel() {
  const router = useRouter();
  const [persona, setPersona] = useState<Persona>("staff");
  const [identifier, setIdentifier] = useState("");
  const [identifierType, setIdentifierType] = useState<IdentifierType>("email");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [mode, setMode] = useState<LoginMode>("signin");
  const [ftStep, setFtStep] = useState<FirstTimeStep>("phone");
  const [ftMobile, setFtMobile] = useState("");
  const [ftCode, setFtCode] = useState("");
  const [ftPassword, setFtPassword] = useState("");
  const [ftConfirmPassword, setFtConfirmPassword] = useState("");
  const [ftNotice, setFtNotice] = useState<string | null>(null);

  const active = PERSONAS.find((p) => p.id === persona)!;
  const demoAuth = isDemoAuth();
  const supabaseReady = isSupabaseConfigured();
  const canFirstTime = !demoAuth && (persona === "staff" || persona === "parent");

  async function finishLogin() {
    await prepareWorkspaceAfterLogin();
    const target = routeForPersona(persona);
    if (typeof window !== "undefined") {
      window.location.href = target;
    } else {
      router.push(target);
    }
  }

  /**
   * Always email-based under the hood. Supabase's Phone auth provider is
   * disabled on this project (verified with a throwaway test account —
   * signInWithPassword({phone}) fails outright, not a code bug). Every
   * account has a real-or-synthetic email regardless of how the person
   * signed up, so a phone-typed identifier gets resolved to that email
   * via /api/auth/resolve-identifier before this is ever called.
   */
  async function signInWithPasswordAndOpenSession(
    credentials: { email: string; password: string },
  ): Promise<string | null> {
    if (!supabaseReady) return "Sign-in is not available. Contact your school administrator.";
    const sb = createBrowserSupabase();
    if (!sb) return "Could not start auth client.";
    const { data, error: authErr } = await sb.auth.signInWithPassword(credentials);
    if (authErr || !data.session?.access_token) {
      return authErr?.message || "Sign-in failed. Check your details.";
    }
    const { currentAcademicYearCode } = await import("@/lib/masters");
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: data.session.access_token,
        academicYearCode: currentAcademicYearCode(),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      await sb.auth.signOut();
      return body?.error || "Could not open school session.";
    }
    return null;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (persona === "field" && secret && !/^\d{4}$/.test(secret)) {
      setError("Enter your 4-digit PIN.");
      return;
    }
    startTransition(async () => {
      const { currentAcademicYearCode, loadMasters } = await import(
        "@/lib/masters"
      );
      const academicYearCode = currentAcademicYearCode();

      // Production path for both staff and parent: real Supabase Auth,
      // sign-in by whichever identifier they picked.
      if (!demoAuth && (persona === "staff" || persona === "parent")) {
        const raw = identifier.trim();
        if (!raw || !secret) {
          setError(
            `${identifierType === "email" ? "Email" : "Phone"} and password are required.`,
          );
          return;
        }
        let failMsg: string | null;
        if (identifierType === "email") {
          failMsg = await signInWithPasswordAndOpenSession({
            email: raw,
            password: secret,
          });
        } else {
          const mobile10 = normalizeMobile10(raw);
          if (!mobile10) {
            setError("Enter a valid 10-digit mobile number.");
            return;
          }
          const resolveRes = await fetch("/api/auth/resolve-identifier", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ persona, mobile: mobile10 }),
          });
          const resolveBody = (await resolveRes.json().catch(() => null)) as {
            ok?: boolean;
            email?: string;
            error?: string;
          } | null;
          if (!resolveRes.ok || !resolveBody?.email) {
            setError(resolveBody?.error || "No account found for this number.");
            return;
          }
          failMsg = await signInWithPasswordAndOpenSession({
            email: resolveBody.email,
            password: secret,
          });
        }
        if (failMsg) {
          setError(failMsg);
          return;
        }
        await finishLogin();
        return;
      }

      const payload: Record<string, string> = {
        persona,
        academicYearCode,
      };

      if (persona === "staff" && identifier.trim()) {
        const { matchStaffLogin } = await import("@/lib/staffResolve");
        const { superAdminRoleCode, superAdminDemoProfile } = await import(
          "@/lib/superAdmin"
        );
        const masters = loadMasters();
        const hit = matchStaffLogin(masters, identifier, secret);
        if (hit) {
          const des = masters.designations.find((d) => d.id === hit.designationId);
          payload.fullName = hit.fullName;
          payload.roleCode = des?.code || des?.name || "staff";
          payload.email = hit.email || hit.loginUsername || hit.empCode;
          payload.staffId = hit.id;
          const owner = superAdminRoleCode(payload.email);
          if (owner) payload.roleCode = owner;
        } else if (demoAuth) {
          const sa = superAdminDemoProfile(identifier);
          if (!sa) {
            setError(
              "No matching staff login. Use emp code / username / email and password from Staff → Login, super-admin email, or leave blank for demo.",
            );
            return;
          }
          payload.fullName = sa.fullName;
          payload.roleCode = sa.roleCode;
          payload.email = sa.email;
        } else {
          setError("No matching staff login.");
          return;
        }
      } else if (persona === "staff") {
        if (!demoAuth) {
          setError("Email and password are required.");
          return;
        }
        const { superAdminRoleCode } = await import("@/lib/superAdmin");
        const directorEmail = identifier.trim();
        const owner = superAdminRoleCode(directorEmail);
        if (owner && directorEmail) {
          payload.fullName = "Director";
          payload.roleCode = owner;
          payload.email = directorEmail;
        } else {
        // Blank demo login → bind Principal from roster when present
        const { resolvePrincipal } = await import("@/lib/staffResolve");
        const masters = loadMasters();
        const prin = resolvePrincipal(masters);
        if (prin) {
          const des = masters.designations.find(
            (d) => d.id === prin.designationId,
          );
          payload.fullName = prin.fullName;
          payload.roleCode = "principal";
          payload.email =
            prin.email ||
            prin.loginUsername ||
            prin.empCode ||
            payload.email ||
            "";
          payload.staffId = prin.id;
          if (des?.code) payload.roleCode = "principal";
        }
        }
      } else if (persona === "parent") {
        // demoAuth only — production parent sign-in is handled above.
        const { loadSis } = await import("@/lib/sis");
        const { resolveParentHousehold } = await import("@/lib/parentPortal");
        const sis = loadSis();
        const hh = resolveParentHousehold(sis, {
          mobile: identifier.trim(),
          guardianName: identifier.trim().length >= 3 ? identifier.trim() : "",
        });
        if (hh) {
          payload.householdId = hh.id;
          payload.fullName = hh.guardianName || "Parent";
          payload.roleCode = "parent";
        } else if (!demoAuth) {
          setError("No household found for this mobile.");
          return;
        }
      }

      const res = await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error || "Could not sign in. Try again.");
        return;
      }
      await finishLogin();
    });
  }

  function resetFirstTime() {
    setMode("signin");
    setFtStep("phone");
    setFtMobile("");
    setFtCode("");
    setFtPassword("");
    setFtConfirmPassword("");
    setFtNotice(null);
    setError(null);
  }

  function onRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFtNotice(null);
    const mobile10 = normalizeMobile10(ftMobile);
    if (!mobile10) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/auth/first-login/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona, mobile: mobile10 }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error || "Could not send OTP on WhatsApp.");
        return;
      }
      setFtNotice("OTP sent on WhatsApp. Enter the 6-digit code below.");
      setFtStep("otp");
    });
  }

  function onSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const mobile10 = normalizeMobile10(ftMobile);
    if (!mobile10 || ftCode.replace(/\D/g, "").length !== 6) {
      setError("Enter the 6-digit OTP.");
      return;
    }
    if (ftPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (ftPassword !== ftConfirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/auth/first-login/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona,
          mobile: mobile10,
          code: ftCode.replace(/\D/g, ""),
          password: ftPassword,
          confirmPassword: ftConfirmPassword,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        email?: string;
        error?: string;
      } | null;
      if (!res.ok || !body?.ok || !body.email) {
        setError(body?.error || "Could not verify OTP or set password.");
        return;
      }
      // Sign in with the email the server just resolved (real or
      // synthetic) — the account this password was just set on, not a
      // phone-based credential Supabase's disabled Phone provider would
      // reject.
      const failMsg = await signInWithPasswordAndOpenSession({
        email: body.email,
        password: ftPassword,
      });
      if (failMsg) {
        setError(
          `Password set, but sign-in failed: ${failMsg}. Try signing in normally.`,
        );
        return;
      }
      await finishLogin();
    });
  }

  const staffHint = demoAuth
    ? "Super-admin: director@bhbinternational.school (any password). Or Staff → Login credentials. Blank = demo principal."
    : "Use the email/phone and password you set up, or verify with OTP below if this is your first time.";

  const personaHint =
    persona === "staff"
      ? staffHint
      : demoAuth && active.demoHint
        ? active.demoHint
        : active.productionHint;

  if (mode === "first-time") {
    return (
      <div className="glass panel-enter w-full max-w-md rounded-2xl p-7 sm:p-8">
        <div className="mb-4 flex justify-center sm:justify-start">
          <Image
            src={TENANT.logoCrestUrl}
            alt=""
            width={64}
            height={67}
            priority
            className="logo-mark object-contain"
            aria-hidden
          />
        </div>
        <p className="text-xs font-semibold tracking-[0.18em] text-[var(--brand-mid)] uppercase">
          First-time setup
        </p>
        <h1 className="font-brand-name mt-2 text-xl text-[var(--brand-deep)] sm:text-[1.35rem]">
          Verify your number
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {ftStep === "phone"
            ? "We'll send a one-time code on WhatsApp to confirm it's you."
            : "Enter the code, then choose the password you'll use from now on."}
        </p>

        {ftStep === "phone" ? (
          <form onSubmit={onRequestOtp} className="mt-5 space-y-3">
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">
                Registered mobile number
              </span>
              <input
                value={ftMobile}
                onChange={(e) => setFtMobile(e.target.value)}
                placeholder="98xxxxxxxx"
                inputMode="numeric"
                className="w-full rounded-xl border border-[rgba(11,61,74,0.18)] bg-white/80 px-3.5 py-2.5 outline-none ring-[var(--ring)] focus:ring-2"
                style={{ color: "#203050" }}
                autoComplete="tel"
              />
            </label>
            {error ? (
              <p className="text-sm text-[var(--danger)]" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="mt-1 w-full rounded-xl px-4 py-3 text-sm font-semibold btn-accent disabled:opacity-70"
            >
              {pending ? "Sending…" : "Send OTP on WhatsApp"}
            </button>
          </form>
        ) : (
          <form onSubmit={onSetPassword} className="mt-5 space-y-3">
            {ftNotice ? (
              <p className="rounded-lg bg-[rgba(15,118,110,0.1)] px-3 py-2 text-xs text-[#0f766e]">
                {ftNotice}
              </p>
            ) : null}
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">
                6-digit OTP
              </span>
              <input
                value={ftCode}
                onChange={(e) => setFtCode(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
                inputMode="numeric"
                maxLength={6}
                className="w-full rounded-xl border border-[rgba(11,61,74,0.18)] bg-white/80 px-3.5 py-2.5 tracking-[0.3em] outline-none ring-[var(--ring)] focus:ring-2"
                style={{ color: "#203050" }}
                autoComplete="one-time-code"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">
                New password (min. 8 characters)
              </span>
              <input
                type="password"
                value={ftPassword}
                onChange={(e) => setFtPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-[rgba(11,61,74,0.18)] bg-white/80 px-3.5 py-2.5 outline-none ring-[var(--ring)] focus:ring-2"
                style={{ color: "#203050" }}
                autoComplete="new-password"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">
                Confirm password
              </span>
              <input
                type="password"
                value={ftConfirmPassword}
                onChange={(e) => setFtConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-[rgba(11,61,74,0.18)] bg-white/80 px-3.5 py-2.5 outline-none ring-[var(--ring)] focus:ring-2"
                style={{ color: "#203050" }}
                autoComplete="new-password"
              />
            </label>
            {error ? (
              <p className="text-sm text-[var(--danger)]" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="mt-1 w-full rounded-xl px-4 py-3 text-sm font-semibold btn-accent disabled:opacity-70"
            >
              {pending ? "Verifying…" : "Verify & set password"}
            </button>
            <button
              type="button"
              className="w-full text-center text-xs text-[var(--brand-mid)]"
              onClick={() => setFtStep("phone")}
            >
              Use a different number
            </button>
          </form>
        )}

        <button
          type="button"
          className="mt-4 w-full text-center text-xs font-semibold text-[var(--brand-mid)]"
          onClick={resetFirstTime}
        >
          ← Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="glass panel-enter w-full max-w-md rounded-2xl p-7 sm:p-8">
      <div className="mb-4 flex justify-center sm:justify-start">
        <Image
          src={TENANT.logoCrestUrl}
          alt=""
          width={64}
          height={67}
          priority
          className="logo-mark object-contain"
          aria-hidden
        />
      </div>
      <p className="text-xs font-semibold tracking-[0.18em] text-[var(--brand-mid)] uppercase">
        Secure login
      </p>
      <h1 className="font-brand-name mt-2 text-xl text-[var(--brand-deep)] sm:text-[1.35rem]">
        {TENANT.nameDisplay}
      </h1>
      <p className="font-tagline mt-1 text-sm">{TENANT.tagline}</p>
      <p className="mt-2 text-sm text-[var(--muted)]">{active.headline}</p>

      <ModuleTabs
        aria-label="Who are you"
        value={persona}
        onChange={(id) => {
          setPersona(id as Persona);
          setError(null);
          setSecret("");
        }}
        items={[
          { id: "staff", label: "Staff", tone: "navy" },
          { id: "parent", label: "Parent", tone: "teal" },
          { id: "field", label: "Field", tone: "amber" },
        ]}
      />

      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        {persona !== "field" ? (
          <>
            {!demoAuth && (persona === "staff" || persona === "parent") ? (
              <div className="flex gap-1.5 text-xs">
                {(["email", "phone"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setIdentifierType(t);
                      setIdentifier("");
                    }}
                    className={`rounded-lg px-3 py-1 font-semibold ${
                      identifierType === t
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "border border-[var(--border)] text-[var(--brand-deep)]"
                    }`}
                  >
                    {t === "email" ? "Email" : "Phone"}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">
                {!demoAuth && (persona === "staff" || persona === "parent")
                  ? identifierType === "email"
                    ? "Email"
                    : "Mobile"
                  : persona === "parent"
                    ? "Mobile"
                    : "Mobile / Email"}
              </span>
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  !demoAuth && (persona === "staff" || persona === "parent")
                    ? identifierType === "email"
                      ? "you@school.edu"
                      : "98xxxxxxxx"
                    : persona === "parent"
                      ? "98xxxxxxxx"
                      : "emp code / username / email"
                }
                inputMode={identifierType === "phone" ? "numeric" : undefined}
                className="w-full rounded-xl border border-[rgba(11,61,74,0.18)] bg-white/80 px-3.5 py-2.5 outline-none ring-[var(--ring)] focus:ring-2"
                style={{ color: "#203050" }}
                autoComplete="username"
                required={!demoAuth && (persona === "staff" || persona === "parent")}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">
                {!demoAuth && (persona === "staff" || persona === "parent")
                  ? "Password"
                  : persona === "parent"
                    ? "OTP"
                    : "OTP / Password"}
              </span>
              <input
                type={
                  demoAuth && persona !== "staff" ? "text" : "password"
                }
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-[rgba(11,61,74,0.18)] bg-white/80 px-3.5 py-2.5 outline-none ring-[var(--ring)] focus:ring-2"
                style={{ color: "#203050" }}
                autoComplete={
                  !demoAuth && (persona === "staff" || persona === "parent")
                    ? "current-password"
                    : persona === "staff"
                      ? "current-password"
                      : "one-time-code"
                }
                required={!demoAuth && (persona === "staff" || persona === "parent")}
              />
            </label>
          </>
        ) : (
          <label className="block text-sm">
            <span className="mb-1.5 block text-[var(--muted)]">PIN</span>
            <input
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              value={secret}
              onChange={(e) => setSecret(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              className="w-full rounded-xl border border-[rgba(11,61,74,0.18)] bg-white/80 px-3.5 py-2.5 tracking-[0.4em] outline-none ring-[var(--ring)] focus:ring-2"
              style={{ color: "#203050" }}
              autoComplete="one-time-code"
            />
          </label>
        )}

        <p className="text-xs text-[var(--muted)]">{personaHint}</p>

        {error ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 w-full rounded-xl px-4 py-3 text-sm font-semibold btn-accent disabled:opacity-70"
        >
          {pending ? "Signing in…" : active.button}
        </button>

        {canFirstTime ? (
          <button
            type="button"
            className="w-full text-center text-xs font-semibold text-[var(--brand-mid)]"
            onClick={() => {
              setMode("first-time");
              setError(null);
            }}
          >
            First time here? Verify with WhatsApp OTP →
          </button>
        ) : null}
      </form>

      <p className="mt-5 text-center text-xs text-[var(--muted)]">
        {TENANT.name} · Secure login · DPDP
        {demoAuth ? " · Demo mode" : ""}
      </p>
    </div>
  );
}
