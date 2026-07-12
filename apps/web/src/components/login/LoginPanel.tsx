"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Image from "next/image";
import type { Persona } from "@/lib/types";
import { TENANT } from "@/lib/types";

const PERSONAS: {
  id: Persona;
  label: string;
  headline: string;
  button: string;
  hint: string;
}[] = [
  {
    id: "staff",
    label: "Staff",
    headline: "Office & teaching portal",
    button: "Sign in to workspace",
    hint: "Email or mobile + password / OTP",
  },
  {
    id: "parent",
    label: "Parent",
    headline: "Fees, attendance, bus & notices",
    button: "Continue with OTP",
    hint: "Mobile OTP (primary)",
  },
  {
    id: "field",
    label: "Field",
    headline: "Tap your role — big icons next",
    button: "Unlock",
    hint: "4-digit PIN",
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (persona === "field" && secret && !/^\d{4}$/.test(secret)) {
      setError("Enter your 4-digit PIN.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona }),
      });
      if (!res.ok) {
        setError("Could not sign in. Try again.");
        return;
      }
      router.push(routeForPersona(persona));
      router.refresh();
    });
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

      <div
        className="mt-6 flex gap-1 border-b border-[rgba(11,61,74,0.12)]"
        role="tablist"
        aria-label="Who are you"
      >
        {PERSONAS.map((p) => {
          const selected = p.id === persona;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setPersona(p.id);
                setError(null);
                setSecret("");
              }}
              className={`relative flex-1 px-2 pb-3 text-sm font-medium transition ${
                selected
                  ? "text-[var(--brand-deep)]"
                  : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
              }`}
            >
              {p.label}
              <span
                className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--brand-gold)] transition ${
                  selected ? "opacity-100" : "opacity-0"
                }`}
              />
            </button>
          );
        })}
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        {persona !== "field" ? (
          <>
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">
                {persona === "parent" ? "Mobile" : "Mobile / Email"}
              </span>
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  persona === "parent"
                    ? "98xxxxxxxx"
                    : "you@bhbinternational.school"
                }
                className="w-full rounded-xl border border-[rgba(11,61,74,0.18)] bg-white/80 px-3.5 py-2.5 outline-none ring-[var(--ring)] focus:ring-2"
                autoComplete="username"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">
                {persona === "parent" ? "OTP" : "OTP / Password"}
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

        <p className="text-xs text-[var(--muted)]">{active.hint} · Demo mode accepts any value</p>

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
      </p>
    </div>
  );
}
