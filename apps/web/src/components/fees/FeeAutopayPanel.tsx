"use client";

/**
 * Fee auto-pay, for the fee desk: turn it on, set a family up, see who has
 * approved, what was debited and what failed.
 *
 * Every number here comes from the server, which re-reads Cashfree — the
 * screen never claims a mandate is active or a debit went through on its own.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw, Repeat, Send, ShieldCheck, Square } from "lucide-react";
import { searchFeeStudents } from "@/lib/fees";
import { mandateIsLive, mandateStatusLabel, rupeesLabel } from "@/lib/feeAutopay";

const CARD = "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4";
const BTN =
  "rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50";
const BTN_OUTLINE =
  "rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--brand-deep)] disabled:opacity-50";
const FIELD = "w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm";

type Settings = { enabled: boolean; chargeDay: number; defaultMaxPaise: number };

type Charge = {
  paymentId: string;
  subscriptionId: string;
  cycle: string;
  amountPaise: number;
  debitDate: string | null;
  status: string;
  receiptNos: string[];
  settledAt: string | null;
  lastError: string;
};

type Mandate = {
  subscriptionId: string;
  householdId: string;
  familyLabel: string;
  maxPaise: number;
  status: string;
  paymentGroup: string;
  inviteSentAt: string | null;
  lastError: string;
  lastCharge: Charge | null;
};

type Overview = { settings: Settings; configured: boolean; mandates: Mandate[]; charges: Charge[] };

type PreviewRow = { subscriptionId: string; householdId: string; outcome: string; amountPaise?: number; leftoverPaise?: number };

function chargeLine(c: Charge | null): string {
  if (!c) return "No debit yet";
  const amt = rupeesLabel(c.amountPaise);
  if (c.settledAt) return `${c.cycle}: ${amt} paid · ${c.receiptNos.join(", ")}`;
  if (c.status === "SUCCESS") return `${c.cycle}: ${amt} received — receipt pending`;
  if (c.status === "FAILED" || c.status === "CANCELLED") return `${c.cycle}: ${amt} failed${c.lastError ? ` (${c.lastError})` : ""}`;
  return `${c.cycle}: ${amt} due ${c.debitDate ?? ""} — waiting for bank`;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/fees/autopay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok && out.ok !== false, out };
}

export function FeeAutopayPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Settings | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ householdId: string; label: string } | null>(null);
  const [limitRupees, setLimitRupees] = useState("");
  const [shareLink, setShareLink] = useState<{ link: string; text: string; label: string } | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/fees/autopay");
      const out = (await res.json()) as Overview & { ok?: boolean; error?: string };
      if (!res.ok || !out.ok) {
        setError(out.error || "Could not load auto-pay");
        return;
      }
      setData(out);
      setDraft(out.settings);
    } catch {
      setError("Could not reach auto-pay");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hits = useMemo(() => {
    if (query.trim().length < 2) return [];
    try {
      return searchFeeStudents(query).slice(0, 8);
    } catch {
      return [];
    }
  }, [query]);

  const run = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { ok, out } = await post(body);
      if (!ok) {
        setError(String(out.error || (out.result as { error?: string } | undefined)?.error || "That did not work"));
        return null;
      }
      setNotice(success);
      await load();
      return out;
    } finally {
      setBusy(false);
    }
  };

  const inviteNotice = (out: Record<string, unknown> | null, label: string) => {
    const invite = (out?.invite ?? out) as { ok?: boolean; link?: string; text?: string; outcome?: { sent?: boolean; held?: boolean; error?: string } } | null;
    const link = String(invite?.link || out?.link || "");
    if (link) setShareLink({ link, text: String(invite?.text || link), label });
    const o = invite?.outcome;
    if (o?.sent) return "Set-up link sent to the parent on WhatsApp.";
    if (o?.held) return "Saved. The WhatsApp message goes automatically once Meta approves the template — or forward the link below now.";
    return "Saved. WhatsApp could not deliver it — forward the link below.";
  };

  const createForFamily = async () => {
    if (!picked) return;
    const rupees = Number(limitRupees);
    const out = await run(
      {
        action: "create",
        householdId: picked.householdId,
        ...(limitRupees && rupees > 0 ? { maxPaise: Math.round(rupees * 100) } : {}),
      },
      "Auto-pay set up.",
    );
    if (out) {
      setNotice(out.reused ? `This family already has auto-pay. ${inviteNotice(out, picked.label)}` : inviteNotice(out, picked.label));
      setPicked(null);
      setQuery("");
      setLimitRupees("");
    }
  };

  const saveSettings = async (next: Settings) => {
    if (next.enabled && !data?.settings.enabled) {
      const ok = window.confirm(
        `Turn ON auto-debits?\n\nFrom day ${next.chargeDay} of each month, every family whose auto-pay is active will be debited for what they owe (up to their limit). Families get a WhatsApp notice the day before.`,
      );
      if (!ok) return;
    }
    await run(
      { action: "settings", enabled: next.enabled, chargeDay: next.chargeDay, defaultMaxPaise: next.defaultMaxPaise },
      next.enabled ? "Saved — auto-debits are ON." : "Saved — auto-debits are OFF. Nothing will be debited.",
    );
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied.");
    } catch {
      setNotice(text);
    }
  };

  const s = data?.settings;
  const live = (data?.mandates ?? []).filter((m) => mandateIsLive(m.status));
  const active = live.filter((m) => m.status === "ACTIVE").length;
  const waiting = live.filter((m) => m.status !== "ACTIVE").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">Fee auto-pay</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Parents approve once (UPI Autopay or bank e-mandate). Each month the school debits only what is due, up to
          the family&apos;s limit, and the receipt goes to WhatsApp by itself.
        </p>
      </div>

      {error ? <p className="rounded-xl bg-[var(--danger-soft,#fee)] p-3 text-[13px] font-semibold text-[var(--danger,#a00)]">{error}</p> : null}
      {notice ? <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-[13px] text-[var(--brand-deep)]">{notice}</p> : null}
      {data && !data.configured ? (
        <p className="rounded-xl bg-[var(--danger-soft,#fee)] p-3 text-[13px] font-semibold text-[var(--danger,#a00)]">
          Cashfree keys are not configured on the server — auto-pay cannot run.
        </p>
      ) : null}

      {/* ── On / off ───────────────────────────────────────── */}
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--brand-deep)]">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Auto-debits are {s?.enabled ? <span className="text-green-700">ON</span> : <span className="text-[var(--danger,#a00)]">OFF</span>}
            </h2>
            <p className="text-[12px] text-[var(--muted)]">
              {active} active · {waiting} waiting for parent / bank. While OFF, families can still be set up — nothing is
              debited.
            </p>
          </div>
          <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void load()}>
            <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden />
            Reload
          </button>
        </div>
        {draft ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-[12px] font-semibold text-[var(--brand-deep)]">
              Debit day of the month
              <select
                className={FIELD}
                value={draft.chargeDay}
                onChange={(e) => setDraft({ ...draft, chargeDay: Number(e.target.value) })}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span className="font-normal text-[var(--muted)]">The money is taken the next day.</span>
            </label>
            <label className="text-[12px] font-semibold text-[var(--brand-deep)]">
              Default monthly limit (₹)
              <input
                className={FIELD}
                inputMode="numeric"
                value={Math.round(draft.defaultMaxPaise / 100)}
                onChange={(e) => setDraft({ ...draft, defaultMaxPaise: Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0) * 100 })}
              />
              <span className="font-normal text-[var(--muted)]">UPI allows up to ₹15,000 without extra checks.</span>
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <button type="button" className={BTN} disabled={busy} onClick={() => void saveSettings(draft)}>
                Save
              </button>
              <button
                type="button"
                className={BTN_OUTLINE}
                disabled={busy}
                onClick={() => void saveSettings({ ...draft, enabled: !s?.enabled })}
              >
                Turn {s?.enabled ? "OFF" : "ON"}
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-3">
          <button
            type="button"
            className={BTN_OUTLINE}
            disabled={busy}
            onClick={async () => {
              const out = await run({ action: "preview" }, "Preview ready — nothing was debited.");
              const report = out?.report as { raised?: PreviewRow[] } | undefined;
              setPreview(report?.raised ?? []);
            }}
          >
            Preview this month&apos;s debits
          </button>
          {preview ? (
            <ul className="mt-2 space-y-1 text-[12px] text-[var(--brand-deep)]">
              {preview.length === 0 ? <li>No debits — not the debit day yet, or no active families.</li> : null}
              {preview.map((p) => {
                const fam = data?.mandates.find((m) => m.subscriptionId === p.subscriptionId)?.familyLabel || p.householdId;
                const what =
                  p.outcome === "dry_run"
                    ? `would debit ${rupeesLabel(p.amountPaise ?? 0)}${p.leftoverPaise ? ` (${rupeesLabel(p.leftoverPaise)} over the limit stays due)` : ""}`
                    : p.outcome.replace(/_/g, " ");
                return (
                  <li key={p.subscriptionId}>
                    {fam}: {what}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </section>

      {/* ── Set a family up ────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">Set up a family</h2>
        <p className="text-[12px] text-[var(--muted)]">
          Search a child; the parent gets a WhatsApp link to approve. One auto-pay covers all their children.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <input
              className={FIELD}
              placeholder="Child, parent name or phone"
              value={picked ? picked.label : query}
              onChange={(e) => {
                setPicked(null);
                setQuery(e.target.value);
              }}
            />
            {!picked && hits.length ? (
              <ul className="mt-1 max-h-60 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
                {hits.map((h) => (
                  <li key={h.student.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-[13px] hover:bg-[var(--muted)]"
                      disabled={!h.student.householdId}
                      onClick={() =>
                        setPicked({
                          householdId: h.student.householdId,
                          label: `${h.student.fullName} · ${h.classLabel}${h.household?.guardianName ? ` · ${h.household.guardianName}` : ""}`,
                        })
                      }
                    >
                      {h.student.fullName} · {h.classLabel}
                      {h.household?.guardianName ? ` · ${h.household.guardianName}` : ""}
                      {!h.student.householdId ? " (no family record)" : ""}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <input
            className={FIELD}
            inputMode="numeric"
            placeholder={`Limit ₹ (default ${s ? Math.round(s.defaultMaxPaise / 100) : 15000})`}
            value={limitRupees}
            onChange={(e) => setLimitRupees(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <button type="button" className={`${BTN} mt-3`} disabled={busy || !picked} onClick={() => void createForFamily()}>
          <Send className="mr-1 inline h-4 w-4" aria-hidden />
          Create &amp; send WhatsApp link
        </button>
        {shareLink ? (
          <div className="mt-3 rounded-xl border border-[var(--border)] p-3 text-[12px]">
            <p className="font-semibold text-[var(--brand-deep)]">Link for {shareLink.label}</p>
            <p className="mt-1 break-all text-[var(--muted)]">{shareLink.link}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={BTN_OUTLINE} onClick={() => void copy(shareLink.link)}>
                <Copy className="mr-1 inline h-3 w-3" aria-hidden />
                Copy link
              </button>
              <button type="button" className={BTN_OUTLINE} onClick={() => void copy(shareLink.text)}>
                <Copy className="mr-1 inline h-3 w-3" aria-hidden />
                Copy message
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Families ───────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">Families on auto-pay</h2>
        {!data ? (
          <p className="mt-2 text-[12px] text-[var(--muted)]">{busy ? "Loading…" : "Not loaded."}</p>
        ) : data.mandates.length === 0 ? (
          <p className="mt-2 text-[12px] text-[var(--muted)]">No family has been set up yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {data.mandates.map((m) => {
              const isLive = mandateIsLive(m.status);
              const failed = m.lastCharge && (m.lastCharge.status === "FAILED" || m.lastCharge.status === "CANCELLED");
              return (
                <li key={m.subscriptionId} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[var(--brand-deep)]">{m.familyLabel}</p>
                      <p className="text-[12px] text-[var(--muted)]">
                        {mandateStatusLabel(m.status)} · up to {rupeesLabel(m.maxPaise)}
                        {m.paymentGroup ? ` · ${m.paymentGroup.toUpperCase()}` : ""}
                      </p>
                      <p className={`text-[12px] ${failed ? "text-[var(--danger,#a00)]" : "text-[var(--brand-deep)]"}`}>
                        {chargeLine(m.lastCharge)}
                      </p>
                      {m.lastCharge?.status === "SUCCESS" && !m.lastCharge.settledAt && m.lastCharge.lastError ? (
                        <p className="text-[12px] font-semibold text-[var(--danger,#a00)]">
                          Money received but receipt not booked: {m.lastCharge.lastError}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className={BTN_OUTLINE}
                        disabled={busy}
                        onClick={() => void run({ action: "sync", subscriptionId: m.subscriptionId }, "Status refreshed from Cashfree.")}
                      >
                        <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden />
                        Refresh
                      </button>
                      {isLive && m.status !== "ACTIVE" ? (
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          disabled={busy}
                          onClick={async () => {
                            const out = await run({ action: "invite", subscriptionId: m.subscriptionId }, "Link sent.");
                            if (out) setNotice(inviteNotice(out, m.familyLabel));
                          }}
                        >
                          <Send className="mr-1 inline h-3 w-3" aria-hidden />
                          Resend link
                        </button>
                      ) : null}
                      {failed && m.status === "ACTIVE" ? (
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Debit ${m.familyLabel} again for this month's dues?`)) {
                              void run({ action: "retry", subscriptionId: m.subscriptionId }, "Debit raised again — lands tomorrow.");
                            }
                          }}
                        >
                          <Repeat className="mr-1 inline h-3 w-3" aria-hidden />
                          Retry debit
                        </button>
                      ) : null}
                      {isLive ? (
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Stop auto-pay for ${m.familyLabel}? They will need a new link to start again.`)) {
                              void run({ action: "cancel", subscriptionId: m.subscriptionId }, "Auto-pay stopped.");
                            }
                          }}
                        >
                          <Square className="mr-1 inline h-3 w-3" aria-hidden />
                          Stop
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
