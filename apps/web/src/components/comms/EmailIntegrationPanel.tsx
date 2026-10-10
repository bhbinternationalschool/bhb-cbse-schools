"use client";

/**
 * Comms → Email — Google Workspace (Gmail API) channel. Sender mailbox per
 * purpose, reply-to, footer, on/off, a test send, the recent log, and the
 * one-time Workspace/GCP setup steps with live status.
 */

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { EMAIL_PURPOSES, type EmailLogEntry, type EmailPurpose, type EmailSettings } from "@/lib/email";

const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm";

type Status = { configured: boolean; enabled: boolean; domain: string; serviceAccount: string };

export function EmailIntegrationPanel({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [log, setLog] = useState<EmailLogEntry[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testPurpose, setTestPurpose] = useState<EmailPurpose>("general");

  async function load() {
    try {
      const r = await fetch("/api/email/settings");
      const j = (await r.json()) as { ok?: boolean; settings?: EmailSettings; status?: Status; log?: EmailLogEntry[]; error?: string };
      if (!r.ok || !j.ok || !j.settings) return setError(j.error || "Could not load email settings");
      setSettings(j.settings);
      setStatus(j.status || null);
      setLog(j.log || []);
    } catch {
      setError("Could not load email settings");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const t = notice ? window.setTimeout(() => setNotice(null), 3500) : null;
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [notice]);

  function patch(p: Partial<EmailSettings>) {
    setSettings((s) => (s ? { ...s, ...p } : s));
    setDirty(true);
  }
  async function save() {
    if (!settings) return;
    setBusy("save");
    try {
      const r = await fetch("/api/email/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const j = (await r.json()) as { ok?: boolean; error?: string; settings?: EmailSettings };
      if (!r.ok || !j.ok) return setError(j.error || "Save failed");
      setSettings(j.settings || settings);
      setDirty(false);
      setNotice("Email settings saved");
    } finally {
      setBusy(null);
    }
  }
  async function test() {
    setBusy("test");
    setError(null);
    try {
      const r = await fetch("/api/email/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose: testPurpose, to: testTo }) });
      const j = (await r.json()) as { ok?: boolean; error?: string; from?: string; to?: string };
      if (!r.ok || !j.ok) setError(`Test failed from ${j.from || "?"}: ${j.error || "unknown"}`);
      else setNotice(`Test sent from ${j.from} to ${j.to}`);
      void load();
    } finally {
      setBusy(null);
    }
  }

  if (!settings) return <p className="mt-4 text-sm text-[var(--muted)]">{error || "Loading email settings…"}</p>;

  return (
    <div className="mt-4 space-y-4">
      {notice ? <p className="rounded-lg bg-[var(--success-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--success)]">{notice}</p> : null}
      {error ? <p className="rounded-lg bg-[var(--danger)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Mail className="h-4 w-4 text-[var(--brand-deep)]" />
          <p className="text-sm font-semibold">Email via Google Workspace</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status?.configured ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>
            {status?.configured ? `connected · ${status.serviceAccount}` : "not connected — service-account key missing"}
          </span>
          <label className="ml-auto inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={settings.enabled} disabled={!canEdit} onChange={(e) => patch({ enabled: e.target.checked })} />
            Channel on
          </label>
        </div>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          The ERP sends <em>as</em> a Workspace mailbox chosen per purpose, so replies land in that inbox and Google&apos;s deliverability applies. Mailboxes must exist in Workspace (domain {status?.domain}).
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {EMAIL_PURPOSES.map((p) => (
            <div key={p.id} className="rounded-lg border border-[var(--border)] p-2">
              <p className="text-xs font-semibold">{p.label}</p>
              <p className="text-[10px] text-[var(--muted)]">{p.hint}</p>
              <div className="mt-1 grid grid-cols-5 gap-1">
                <input className={`${inp} col-span-3`} disabled={!canEdit} value={settings.senders[p.id].address} onChange={(e) => patch({ senders: { ...settings.senders, [p.id]: { ...settings.senders[p.id], address: e.target.value } } })} placeholder={`${p.id}@${status?.domain}`} />
                <input className={`${inp} col-span-2`} disabled={!canEdit} value={settings.senders[p.id].name} onChange={(e) => patch({ senders: { ...settings.senders, [p.id]: { ...settings.senders[p.id], name: e.target.value } } })} placeholder="Display name" />
              </div>
            </div>
          ))}
          <label className="text-[11px] text-[var(--muted)]">
            Reply-To (optional, all mails)
            <input className={`${inp} mt-0.5`} disabled={!canEdit} value={settings.replyTo} onChange={(e) => patch({ replyTo: e.target.value })} placeholder="office@…" />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            Footer (plain text, all mails)
            <input className={`${inp} mt-0.5`} disabled={!canEdit} value={settings.footer} onChange={(e) => patch({ footer: e.target.value })} placeholder="BHB International School · Varanasi · +91 …" />
          </label>
        </div>
        {canEdit ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!dirty || busy === "save"} className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50" onClick={() => void save()}>
              Save
            </button>
            <span className="ml-4 text-[11px] text-[var(--muted)]">Test:</span>
            <select className={`${inp} !w-auto`} value={testPurpose} onChange={(e) => setTestPurpose(e.target.value as EmailPurpose)}>
              {EMAIL_PURPOSES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <input className={`${inp} !w-56`} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="to (blank = your login email)" />
            <button type="button" disabled={busy === "test" || !status?.configured} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={() => void test()}>
              {busy === "test" ? "Sending…" : "Send test"}
            </button>
          </div>
        ) : null}
      </div>

      {!status?.configured ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-3 text-xs">
          <p className="font-semibold">One-time setup (Workspace admin + GCP) — no paid provider needed</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-[var(--muted)]">
            <li>Workspace Admin → create the mailboxes above (or map the purposes to existing ones and Save).</li>
            <li>GCP project <code>school-erp-prod-493619</code> → IAM → Service accounts → create <code>erp-mail-sender</code>; create a JSON key. APIs → enable <strong>Gmail API</strong>.</li>
            <li>Workspace Admin → Security → Access and data control → API controls → <strong>Domain-wide delegation</strong> → Add new → the service account&apos;s <em>Client ID</em> with scope <code>https://www.googleapis.com/auth/gmail.send</code>.</li>
            <li>Put the JSON key in Secret Manager as <code>school-erp-gmail-sa-key</code> (it is already bound to Cloud Run as <code>GMAIL_SA_KEY_JSON</code>); redeploy is not needed — the next revision picks <code>latest</code>. Then &ldquo;Send test&rdquo; here.</li>
          </ol>
        </div>
      ) : null}

      <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <summary className="cursor-pointer text-sm font-semibold">Recent emails ({log.length})</summary>
        {log.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--muted)]">Nothing sent yet.</p>
        ) : (
          <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto text-[11px]">
            {log.map((e) => (
              <li key={e.id} className={e.status === "sent" ? "" : "text-[var(--danger)]"}>
                {e.at.slice(0, 16).replace("T", " ")} · {e.purpose} · {e.from} → {e.to} · {e.subject} · {e.status}{e.detail && e.status === "failed" ? ` · ${e.detail}` : ""}{e.by ? ` · ${e.by}` : ""}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
