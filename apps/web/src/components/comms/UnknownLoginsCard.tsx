"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";
import type { UnknownLoginNumber } from "@/lib/loginUnknownNumbers";

type WaStatus = { step: string; result: string; invitedAt: string; updatedAt: string } | null;
type Row = UnknownLoginNumber & { nowRegistered: boolean; wa?: WaStatus };

/** Where the WhatsApp check for this number stands, in the office's words. */
function waLabel(wa: WaStatus | undefined): { text: string; tone: "muted" | "ok" | "warn" } | null {
  if (!wa) return null;
  switch (wa.step) {
    case "invited":
      return { text: `asked on WhatsApp ${when(wa.invitedAt)} — no reply yet`, tone: "muted" };
    case "name":
    case "dob":
    case "class":
    case "father":
    case "mother":
      return { text: "answering the questions on WhatsApp", tone: "muted" };
    case "linked":
      return { text: `linked ✓ ${wa.result}`, tone: "ok" };
    case "office":
      return { text: "details did not match — in Parent number requests", tone: "warn" };
    case "declined":
      return { text: "said it was not them", tone: "muted" };
    default:
      return { text: wa.step, tone: "muted" };
  }
}

function when(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Comms → WhatsApp → Class groups: people who tried to log in to the app
 * with a number the ERP does not have (director, 9 Oct 2026 — 40 such tries
 * the evening parent login was fixed). Call them, add the number to the
 * family in Students, and the row turns "now registered" by itself.
 */
export function UnknownLoginsCard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState("");
  const [info, setInfo] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/comms/unknown-logins", { cache: "no-store" });
      const body = (await res.json()) as { ok: boolean; numbers?: Row[]; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setRows(body.numbers ?? []);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function mark(r: Row, done: boolean) {
    const note = done ? window.prompt(`What was done for ${r.mobile10}? (e.g. "added to Riya's family", "wrong number")`, r.note) : "";
    if (done && note === null) return;
    const res = await fetch("/api/v1/comms/unknown-logins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile10: r.mobile10, app: r.app, done, note: note || "" }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) setErr(body.error || `HTTP ${res.status}`);
    else void load();
  }

  async function askOnWhatsApp(r: Row | null) {
    setBusy(r ? r.mobile10 : "all");
    setInfo("");
    try {
      const res = await fetch("/api/v1/comms/unknown-logins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r ? { action: "wa_verify", mobile10: r.mobile10 } : { action: "wa_verify_all" }),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; reason?: string; sent?: number; error?: string };
      if (!res.ok) setErr(body.reason || body.error || `HTTP ${res.status}`);
      else if (r) setInfo(body.status === "sent" ? `Asked ${r.mobile10} on WhatsApp.` : `Not sent to ${r.mobile10}: ${body.reason}`);
      else setInfo(`Asked ${body.sent ?? 0} number(s) on WhatsApp. Numbers asked in the last 3 days, linked, or mid-conversation were skipped.`);
      void load();
    } finally {
      setBusy("");
    }
  }

  const visible = useMemo(
    () => (rows ?? []).filter((r) => showDone || (!r.doneAt && !r.nowRegistered)),
    [rows, showDone],
  );
  const sort = useTableSort(
    visible,
    {
      last: (r) => r.lastAt,
      number: (r) => r.mobile10,
      app: (r) => r.app,
      tries: (r) => r.attempts,
      first: (r) => r.firstAt,
    },
    "last",
    "desc",
  );
  const open = (rows ?? []).filter((r) => !r.doneAt && !r.nowRegistered).length;
  const fixed = (rows ?? []).filter((r) => r.nowRegistered).length;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="App logins from unknown numbers">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          Tried to log in — number not in the ERP{" "}
          {rows === null ? (
            <span className="text-[var(--muted)]">(loading…)</span>
          ) : (
            <span className={open ? "text-[var(--danger)]" : "text-[var(--success)]"}>({open} to call)</span>
          )}
        </h3>
        <button
          type="button"
          disabled={busy !== ""}
          onClick={() => void askOnWhatsApp(null)}
          className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--ink)] disabled:opacity-50"
        >
          {busy === "all" ? "Asking…" : "Ask all waiting on WhatsApp"}
        </button>
        <label className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> show handled ({fixed} now registered)
        </label>
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        These families (or staff) asked the app for an OTP with a number the ERP does not have, so no OTP was sent. Parents are asked on
        WhatsApp automatically: five questions about the child (name, date of birth, class, father&apos;s and mother&apos;s names). A full match
        links the number and tells them they can log in; anything else lands in Parent number requests for you to check. You can still call
        them, or add the number to the family in Students — the row clears itself either way.
      </p>
      {err ? <p className="mt-2 text-xs text-[var(--danger)]">{err}</p> : null}
      {info ? <p className="mt-2 text-xs text-[var(--success)]">{info}</p> : null}
      {rows === null && !err ? <p className="mt-2 text-xs text-[var(--muted)]">Loading…</p> : null}
      {rows && visible.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--success)]">Nobody waiting — every number that tried is registered or handled.</p>
      ) : null}
      {visible.length ? (
        <ErpTableShell density="compact" className="mt-3" exportAs="app_login_unknown_numbers" exportTitle="App logins from unknown numbers">
          <div className="max-h-[50vh] overflow-auto">
            <ErpTable minWidth="min-w-[560px]">
              <ErpTableHead sticky>
                <tr>
                  <ErpSortTh sort={sort} field="number">Mobile</ErpSortTh>
                  <ErpSortTh sort={sort} field="app">App</ErpSortTh>
                  <ErpSortTh sort={sort} field="tries" align="right">Tries</ErpSortTh>
                  <ErpSortTh sort={sort} field="first">First</ErpSortTh>
                  <ErpSortTh sort={sort} field="last">Last</ErpSortTh>
                  <th className="px-3 py-2">Status</th>
                  <th className="w-10 px-2 py-2" aria-label="Actions" />
                </tr>
              </ErpTableHead>
              <ErpTableBody hoverable>
                {sort.rows.map((r) => (
                  <tr key={`${r.app}:${r.mobile10}`}>
                    <td className="px-3 py-2 font-semibold text-[var(--brand-deep)] tabular-nums">{r.mobile10}</td>
                    <td className="px-3 py-2 text-xs">{r.app === "staff" ? "Staff" : "Parent"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.attempts}</td>
                    <td className="px-3 py-2 text-xs">{when(r.firstAt)}</td>
                    <td className="px-3 py-2 text-xs">{when(r.lastAt)}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.nowRegistered ? (
                        <span className="text-[var(--success)]">now registered ✓</span>
                      ) : r.doneAt ? (
                        <span className="text-[var(--muted)]" title={`${r.doneBy}: ${r.note}`}>handled — {r.note || r.doneBy}</span>
                      ) : (
                        <span className="text-[var(--danger)]">
                          to call
                          {r.note ? <span className="block text-[10px] text-[var(--muted)]">{r.note}</span> : null}
                        </span>
                      )}
                      {(() => {
                        const w = waLabel(r.wa);
                        return w ? (
                          <span
                            className={`block text-[10px] ${w.tone === "ok" ? "text-[var(--success)]" : w.tone === "warn" ? "text-[var(--warning)]" : "text-[var(--muted)]"}`}
                          >
                            WhatsApp: {w.text}
                          </span>
                        ) : null;
                      })()}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <RowActionMenu
                        row={r}
                        label={`${r.mobile10} actions`}
                        actions={[
                          { id: "call", label: "Call", onSelect: (x) => { window.location.href = `tel:+91${x.mobile10}`; } },
                          {
                            id: "wa",
                            label: "Ask on WhatsApp",
                            hidden: (x) => x.app !== "parent" || x.nowRegistered || x.wa?.step === "linked",
                            onSelect: (x) => void askOnWhatsApp(x),
                          },
                          { id: "done", label: "Mark handled…", hidden: (x) => !!x.doneAt || x.nowRegistered, onSelect: (x) => void mark(x, true) },
                          { id: "reopen", label: "Reopen", hidden: (x) => !x.doneAt, onSelect: (x) => void mark(x, false) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </div>
        </ErpTableShell>
      ) : null}
    </section>
  );
}
