"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Image from "next/image";
import type { Persona } from "@/lib/types";
import { TENANT } from "@/lib/types";
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
    productionHint: "School email and password",
    demoHint: "Super-admin email, Staff login, or leave blank for demo principal",
  },
  {
    id: "parent",
    label: "Parent",
    headline: "Fees, attendance, bus & notices",
    button: "Continue with OTP",
    productionHint: "Registered mobile number — OTP sent on WhatsApp",
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

export function LoginPanel() {
  const router = useRouter();
  const [persona, setPersona] = useState<Persona>("staff");
  const [identifier, setIdentifier] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = PERSONAS.find((p) => p.id === persona)!;
  const demoAuth = isDemoAuth();
  const supabaseReady = isSupabaseConfigured();

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

      // Production staff path: Supabase Auth → mint app cookie
      if (!demoAuth && persona === "staff") {
        if (!supabaseReady) {
          setError("Sign-in is not available. Contact your school administrator.");
          return;
        }
        const email = identifier.trim();
        const password = secret;
        if (!email || !password) {
          setError("Email and password are required.");
          return;
        }
        const sb = createBrowserSupabase();
        if (!sb) {
          setError("Could not start auth client.");
          return;
        }
        const { data, error: authErr } = await sb.auth.signInWithPassword({
          email,
          password,
        });
        if (authErr || !data.session?.access_token) {
          setError(authErr?.message || "Sign-in failed. Check email and password.");
          return;
        }
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: data.session.access_token,
            academicYearCode,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(body?.error || "Could not open school session.");
          await sb.auth.signOut();
          return;
        }
        router.push(routeForPersona(persona));
        router.refresh();
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
        if (!demoAuth) {
          const mobile = identifier.trim();
          if (!mobile) {
            setError("Enter your registered mobile number.");
            return;
          }
          if (!secret || secret.replace(/\D/g, "").length < 6) {
            const req = await fetch("/api/auth/otp/request", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mobile }),
            });
            const body = (await req.json().catch(() => null)) as {
              error?: string;
              ok?: boolean;
            } | null;
            if (!req.ok) {
              setError(body?.error || "Could not send OTP on WhatsApp.");
              return;
            }
            setError("OTP sent on WhatsApp. Enter the 6-digit code and tap Sign in again.");
            return;
          }
          const verify = await fetch("/api/auth/otp/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mobile,
              code: secret,
              academicYearCode,
            }),
          });
          if (!verify.ok) {
            const body = (await verify.json().catch(() => null)) as {
              error?: string;
            } | null;
            setError(body?.error || "Invalid OTP.");
            return;
          }
          router.push(routeForPersona(persona));
          router.refresh();
          return;
        }
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
      router.push(routeForPersona(persona));
      router.refresh();
    });
  }

  const staffHint = demoAuth
    ? "Super-admin: director@bhbinternational.school (any password). Or Staff → Login credentials. Blank = demo principal."
    : "Use the email and password issued by your school.";

  const personaHint =
    persona === "staff"
      ? staffHint
      : demoAuth && active.demoHint
        ? active.demoHint
        : active.productionHint;

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
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">
                {persona === "parent"
                  ? "Mobile"
                  : !demoAuth
                    ? "Email"
                    : "Mobile / Email"}
              </span>
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  persona === "parent"
                    ? "98xxxxxxxx"
                    : !demoAuth
                      ? "you@school.edu"
                      : "emp code / username / email"
                }
                className="w-full rounded-xl border border-[rgba(11,61,74,0.18)] bg-white/80 px-3.5 py-2.5 outline-none ring-[var(--ring)] focus:ring-2"
                autoComplete="username"
                required={!demoAuth && persona === "staff"}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">
                {persona === "parent"
                  ? "OTP"
                  : !demoAuth
                    ? "Password"
                    : "OTP / Password"}
              </span>
              <input
                type={persona === "staff" ? "password" : "text"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={persona === "parent" ? "••••••" : "••••••••"}
                className="w-full rounded-xl border border-[rgba(11,61,74,0.18)] bg-white/80 px-3.5 py-2.5 outline-none ring-[var(--ring)] focus:ring-2"
                autoComplete={
                  persona === "staff" ? "current-password" : "one-time-code"
                }
                required={!demoAuth && persona === "staff"}
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
          className="mt-1 w-full rounded-xl bg-[var(--brand-deep)] px-4 py-3 text-sm font-semibold text-white btn-accent disabled:opacity-70"
        >
          {pending ? "Signing in…" : active.button}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-[var(--muted)]">
        {TENANT.name} · Secure login · DPDP
        {demoAuth ? " · Demo mode" : ""}
      </p>
    </div>
  );
}
