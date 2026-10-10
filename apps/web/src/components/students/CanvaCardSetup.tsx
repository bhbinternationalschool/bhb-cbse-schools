"use client";

/**
 * Students → Birthdays → "Your own design from Canva".
 *
 * Three steps on one card: connect the school's Canva account (once, by an
 * admin), paste the link of the card the school designed in Canva, and check
 * which of its fields the ERP fills — then make a real test card before
 * turning it on. When a Canva card can't be made on the day, the built-in
 * design chosen below goes out instead.
 */

import { useCallback, useEffect, useState } from "react";
import { CANVA_SCOPES, parseCanvaDesignId, type CanvaFillPlan } from "@/lib/canvaBirthday";
import type { BirthdaySettings } from "@/lib/birthdayCards";

const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm";
const btn = "rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium disabled:opacity-50";

type Status = {
  ok?: boolean;
  configured?: boolean;
  connected?: boolean;
  connectedBy?: string;
  connectedAt?: string;
  missingScopes?: string[];
  redirectUri?: string;
  error?: string;
};

type CheckResult = {
  ok?: boolean;
  error?: string;
  title?: string;
  fields?: Record<string, { type: string }>;
  plan?: CanvaFillPlan;
  sampleFor?: string;
};

type TestResult = { ok?: boolean; error?: string; preview?: string; usesRemaining?: number | null };

const IMAGE_LABEL: Record<string, string> = { photo: "the person's photo (the school crest when there is none)", logo: "the school crest" };

function DesignRow(props: {
  label: string;
  subject: "student" | "staff";
  value: string;
  onChange: (v: string) => void;
  canEdit: boolean;
  connected: boolean;
  date: string;
}) {
  const { label, subject, value, onChange, canEdit, connected, date } = props;
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "test">("");
  const id = parseCanvaDesignId(value);

  async function run(action: "check" | "test") {
    setBusy(action);
    if (action === "check") setCheck(null);
    else setTest(null);
    try {
      const r = await fetch("/api/birthday/canva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, design: value, subject, date }),
      });
      const j = (await r.json()) as CheckResult & TestResult;
      if (action === "check") setCheck(r.ok ? j : { error: j.error || "Could not read the design" });
      else setTest(r.ok ? j : { error: j.error || "Could not make the card" });
    } catch {
      (action === "check" ? setCheck : setTest)({ error: "Network error" });
    } finally {
      setBusy("");
    }
  }

  const plan = check?.plan;
  return (
    <div className="rounded-lg border border-[var(--border)] p-2">
      <label className="text-[11px] text-[var(--muted)]">
        {label}
        <input
          className={`${inp} mt-0.5`}
          placeholder="Paste the Canva design link — blank = built-in design"
          value={value}
          disabled={!canEdit}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {value && !id ? <p className="mt-1 text-[11px] text-red-600">That doesn&apos;t look like a Canva design link.</p> : null}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button type="button" className={btn} disabled={!id || !connected || !!busy} onClick={() => void run("check")}>
          {busy === "check" ? "Reading…" : "Check fields"}
        </button>
        <button type="button" className={btn} disabled={!id || !connected || !canEdit || !!busy} onClick={() => void run("test")} title={`Makes a real card for someone with a birthday on ${date}`}>
          {busy === "test" ? "Making card in Canva…" : `Make a test card (${date})`}
        </button>
      </div>
      {check?.error ? <p className="mt-1 text-[11px] text-red-600">{check.error}</p> : null}
      {plan ? (
        <div className="mt-1.5 text-[11px]">
          <p className="font-medium">
            {check?.title ? `“${check.title}” — ` : ""}
            {Object.keys(check?.fields || {}).length} field(s){check?.sampleFor ? `, shown for ${check.sampleFor}` : ", shown with sample values"}:
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {Object.entries(plan.text).map(([f, t]) => (
              <li key={f}>
                <span className="font-mono">{f}</span> → {t}
              </li>
            ))}
            {Object.entries(plan.images).map(([f, k]) => (
              <li key={f}>
                <span className="font-mono">{f}</span> → {IMAGE_LABEL[k] || k}
              </li>
            ))}
            {plan.empty.map((f) => (
              <li key={f} className="text-[var(--muted)]">
                <span className="font-mono">{f}</span> → nothing on record for this person; left as designed
              </li>
            ))}
            {plan.unknown.map((f) => (
              <li key={f} className="text-amber-700">
                <span className="font-mono">{f}</span> → not a field the ERP fills; left as designed. Rename it to one of: name, class, age, wish, date, school, signature, photo, logo.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {test?.error ? <p className="mt-1 text-[11px] text-red-600">{test.error}</p> : null}
      {test?.ok ? (
        <div className="mt-1.5">
          {test.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={test.preview} alt="Test card made in Canva" className="max-h-80 rounded-lg border border-[var(--border)]" />
          ) : null}
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Made in Canva — it is also in the school&apos;s Canva account.
            {test.usesRemaining != null ? ` Canva says ${test.usesRemaining} autofill use(s) remain on this plan.` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function CanvaCardSetup(props: {
  settings: BirthdaySettings;
  patch: (p: Partial<BirthdaySettings>) => void;
  canEdit: boolean;
  staffAccess: boolean;
  date: string;
}) {
  const { settings, patch, canEdit, staffAccess, date } = props;
  const [status, setStatus] = useState<Status | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/integrations/canva");
      setStatus((await r.json()) as Status);
    } catch {
      setStatus({ error: "Could not read the Canva connection" });
    }
  }, []);
  useEffect(() => {
    void load();
    // The callback lands back here with ?canva=connected or ?canva_error=…
    const q = new URLSearchParams(window.location.search);
    if (q.get("canva") === "connected") setMsg("Canva connected.");
    else if (q.get("canva_error")) setMsg(`Canva: ${q.get("canva_error")}`);
  }, [load]);

  async function saveClient() {
    setMsg(null);
    const r = await fetch("/api/integrations/canva", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    const j = (await r.json()) as Status;
    if (!r.ok) return setMsg(j.error || "Could not save");
    setClientSecret("");
    setStatus(j);
    setMsg("Saved. Now press Connect Canva.");
  }

  async function disconnect() {
    const r = await fetch("/api/integrations/canva", { method: "DELETE" });
    setStatus((await r.json()) as Status);
  }

  const connected = !!status?.connected;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">Your own design from Canva</p>
        <span className="text-[11px] text-[var(--muted)]">
          Design the card in the school&apos;s Canva; the ERP fills each person&apos;s details on the day. If Canva fails, the built-in design below goes instead.
        </span>
      </div>
      {msg ? <p className="mt-1 text-[11px] font-medium">{msg}</p> : null}
      {status?.error ? <p className="mt-1 text-[11px] text-red-600">{status.error}</p> : null}

      {/* 1 · Connection */}
      <div className="mt-2 text-[11px]">
        {connected ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">Connected</span>
            <span className="text-[var(--muted)]">
              {status?.connectedBy ? `by ${status.connectedBy}` : ""}
              {status?.connectedAt ? ` · ${new Date(status.connectedAt).toLocaleDateString("en-IN")}` : ""}
            </span>
            {canEdit ? (
              <button type="button" className={btn} onClick={() => void disconnect()}>
                Disconnect
              </button>
            ) : null}
            {status?.missingScopes?.length ? (
              <span className="text-amber-700">Missing permission(s): {status.missingScopes.join(", ")} — tick them in the Developer Portal and Connect again.</span>
            ) : null}
          </div>
        ) : status?.configured ? (
          <div className="flex flex-wrap items-center gap-2">
            <a className={`${btn} bg-[var(--brand-deep)] text-white`} href="/api/integrations/canva/connect">
              Connect Canva
            </a>
            <span className="text-[var(--muted)]">Sign in as the school&apos;s Canva for Education account and press Allow.</span>
          </div>
        ) : canEdit ? (
          <details className="rounded-lg border border-dashed border-[var(--border)] p-2" open>
            <summary className="cursor-pointer font-medium">Set up the connection (once)</summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[var(--muted)]">
              <li>Signed in to Canva as the school account, open canva.com/developers → Integrations → Create an integration (private, for your team).</li>
              <li>Scopes: tick {CANVA_SCOPES.join(", ")}.</li>
              <li>
                Authentication → add this redirect URL: <span className="font-mono text-[var(--fg)]">{status?.redirectUri || "…"}</span>
              </li>
              <li>Copy the Client ID, generate a Client secret, and paste both here.</li>
            </ol>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
              <input className={inp} placeholder="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
              <input className={inp} placeholder="Client secret" type="password" autoComplete="off" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
              <button type="button" className={btn} disabled={!clientId || !clientSecret} onClick={() => void saveClient()}>
                Save
              </button>
            </div>
          </details>
        ) : (
          <p className="text-[var(--muted)]">Canva isn&apos;t connected yet — an admin sets it up here.</p>
        )}
      </div>

      {/* 2 · Designs */}
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        <DesignRow
          label="Students' card (Canva design link)"
          subject="student"
          value={settings.canvaStudentDesign}
          onChange={(v) => patch({ canvaStudentDesign: v })}
          canEdit={canEdit}
          connected={connected}
          date={date}
        />
        {staffAccess ? (
          <DesignRow
            label="Staff card (Canva design link)"
            subject="staff"
            value={settings.canvaStaffDesign}
            onChange={(v) => patch({ canvaStaffDesign: v })}
            canEdit={canEdit}
            connected={connected}
            date={date}
          />
        ) : null}
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--muted)]">
        In the Canva editor: Apps → Bulk create → Enter data manually, add columns named name, class, age, wish, date, school, signature, photo or logo (one row of sample values is enough), then connect each column to its text or picture on the card. You don&apos;t need to generate the designs — the ERP fills them each day. Press Save settings to use the design; clear the link to go back to the built-in cards.
      </p>
    </div>
  );
}
