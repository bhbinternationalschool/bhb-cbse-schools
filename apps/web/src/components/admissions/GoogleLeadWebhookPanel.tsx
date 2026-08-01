"use client";

import { useEffect, useState } from "react";

const inp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm font-mono text-[12px]";

export function GoogleLeadWebhookPanel() {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/admissions/google-lead")
      .then((r) => r.json())
      .then((d: { webhookUrl?: string; keyConfigured?: boolean }) => {
        if (d.webhookUrl) setWebhookUrl(d.webhookUrl);
        setKeyConfigured(!!d.keyConfigured);
      })
      .catch(() => null);
  }, []);

  async function copyUrl() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setTestResult("Webhook URL copied.");
    } catch {
      setTestResult(webhookUrl);
    }
  }

  async function sendTestLead() {
    setBusy(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admissions/google-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: `erp-test-${Date.now()}`,
          childName: "Test Child (Google)",
          guardianName: "Test Parent",
          mobile: "9999900001",
          className: "V",
          locality: "Sigra",
          note: "ERP webhook test — delete from CRM",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        enquiryNo?: string;
        duplicate?: boolean;
        error?: string;
      };
      if (res.ok && json.ok) {
        setTestResult(
          json.duplicate
            ? `Duplicate test lead (already imported)`
            : `Test lead created · ${json.enquiryNo}`,
        );
      } else {
        setTestResult(json.error || `HTTP ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[rgba(66,133,244,0.25)] bg-[rgba(66,133,244,0.04)] p-4">
      <p className="text-sm font-semibold text-[#1a73e8]">
        Google Ads Lead Form → ERP webhook
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        When a parent submits your Google lead form, Google POSTs here and a new
        enquiry lands in Admissions CRM with source <strong>Google</strong> — no
        CSV download.
      </p>

      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Webhook URL (paste in Google Ads)
        <input
          className={`${inp} mt-1`}
          readOnly
          value={webhookUrl || "Loading…"}
        />
      </label>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-[rgba(32,48,80,0.2)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
          onClick={() => void copyUrl()}
        >
          Copy URL
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-[#1a73e8] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          onClick={() => void sendTestLead()}
        >
          {busy ? "Sending…" : "Send test lead"}
        </button>
      </div>

      {!keyConfigured ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          Set <code className="text-[10px]">GOOGLE_LEAD_WEBHOOK_KEY</code> in
          server env and use the same key in Google Ads webhook settings. Until
          then, any caller can POST leads (dev only).
        </p>
      ) : (
        <p className="mt-3 text-[11px] text-[#047857]">
          Webhook key is configured — Google must send matching{" "}
          <code className="text-[10px]">google_key</code> in the JSON body.
        </p>
      )}

      <ol className="mt-3 list-decimal space-y-1 pl-4 text-[11px] text-[var(--muted)]">
        <li>Google Ads → Campaign → Assets → Lead form extension</li>
        <li>Lead delivery → Webhook → paste URL above</li>
        <li>Add custom questions: Child name, Class sought, Parent name</li>
        <li>Leads appear under Admissions with source Google</li>
      </ol>

      {testResult ? (
        <p className="mt-2 text-xs text-[var(--brand-deep)]">{testResult}</p>
      ) : null}
    </div>
  );
}
