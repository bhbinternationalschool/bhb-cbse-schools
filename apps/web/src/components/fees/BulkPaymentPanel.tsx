"use client";

/**
 * Bulk fee payment (Fees → Bulk & PDC → Bulk payment).
 *
 * One payment covering several children — siblings, a staff-ward group, a
 * sponsor — producing ONE RECEIPT PER CHILD through the ordinary counter
 * engine, all written in a single transaction on the server. Preview first:
 * the server prices every child's dues and shows exactly which months each
 * receipt will settle; Post re-checks that nothing moved since and refuses
 * if it did. A bulk payment can never create an advance.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { FeeToolsStudentPicker } from "@/components/fees/FeeToolsStudentPicker";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { RowActionMenu, type RowAction } from "@/components/ui/erp-grid";
import { TENDER_MODES } from "@/lib/fees";
import type { BulkPlan, BulkStrategy } from "@/lib/feeBulkAllocation";
import {
  inr,
  istTodayClient,
  newBatchId,
  rupeesToPaise,
  toolsGet,
  toolsPost,
  type LookupStudent,
} from "@/lib/feeToolsClient";

const BTN =
  "inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50";

type StrategyKind = BulkStrategy["kind"];

type BulkRecord = {
  id: string;
  payerLabel: string;
  mode: string;
  ref: string;
  collectionDate: string;
  totalPaise: number;
  receipts: { studentId: string; studentName: string; voucherId: string; receiptNo: string; totalPaise: number }[];
  createdBy: string;
};

export function BulkPaymentPanel({ canCollect }: { canCollect: boolean }) {
  const [chosen, setChosen] = useState<LookupStudent[]>([]);
  const [includeFuture, setIncludeFuture] = useState(false);
  const [duesById, setDuesById] = useState<Record<string, LookupStudent>>({});
  const [duesError, setDuesError] = useState("");
  const [kind, setKind] = useState<StrategyKind>("full");
  const [lump, setLump] = useState("");
  const [perChild, setPerChild] = useState<Record<string, string>>({});
  const [mode, setMode] = useState("cash");
  const [ref, setRef] = useState("");
  const [instrumentDate, setInstrumentDate] = useState(istTodayClient());
  const [bankName, setBankName] = useState("");
  const [payerLabel, setPayerLabel] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{ plan: BulkPlan; batchId: string; signature: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [history, setHistory] = useState<BulkRecord[] | null>(null);
  const [historyError, setHistoryError] = useState("");

  const ids = useMemo(() => chosen.map((s) => s.id), [chosen]);
  const modeMeta = TENDER_MODES.find((m) => m.value === mode);

  const loadHistory = useCallback(async () => {
    const r = await toolsGet<{ payments: BulkRecord[] }>("/api/fees/tools/bulk-payment");
    if (!r.ok) {
      setHistoryError(r.error);
      return;
    }
    setHistoryError("");
    setHistory(r.payments);
  }, []);
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Dues for the chosen children, priced on the server.
  useEffect(() => {
    setPreview(null);
    if (ids.length === 0) {
      setDuesById({});
      return;
    }
    let live = true;
    void (async () => {
      const r = await toolsGet<{ students: LookupStudent[] }>(
        `/api/fees/tools/lookup?studentIds=${encodeURIComponent(ids.join(","))}${includeFuture ? "&future=1" : ""}`,
      );
      if (!live) return;
      if (!r.ok) {
        setDuesError(r.error);
        return;
      }
      setDuesError("");
      setDuesById(Object.fromEntries(r.students.map((s) => [s.id, s])));
    })();
    return () => {
      live = false;
    };
  }, [ids, includeFuture]);

  // Any change to what is being paid invalidates the preview.
  useEffect(() => {
    setPreview(null);
  }, [kind, lump, perChild, mode]);

  function add(list: LookupStudent[]) {
    setChosen((prev) => {
      const have = new Set(prev.map((s) => s.id));
      return [...prev, ...list.filter((s) => !have.has(s.id))];
    });
  }

  async function addSiblings(s: LookupStudent) {
    if (!s.siblingIds.length) {
      setMsg({ text: `${s.name} has no brothers or sisters on the roll`, bad: true });
      return;
    }
    const r = await toolsGet<{ students: LookupStudent[] }>(`/api/fees/tools/lookup?studentIds=${encodeURIComponent(s.siblingIds.join(","))}`);
    if (!r.ok) {
      setMsg({ text: r.error, bad: true });
      return;
    }
    add(r.students);
  }

  async function addGround(ground: string, label: string) {
    const r = await toolsGet<{ students: LookupStudent[] }>(`/api/fees/tools/lookup?ground=${encodeURIComponent(ground)}`);
    if (!r.ok) {
      setMsg({ text: r.error, bad: true });
      return;
    }
    if (r.students.length === 0) {
      setMsg({ text: `No child holds an approved ${label} concession`, bad: true });
      return;
    }
    add(r.students);
    setMsg({ text: `Added ${r.students.length} child(ren) with a ${label} concession`, bad: false });
  }

  function strategy(): BulkStrategy | string {
    if (kind === "full") return { kind: "full" };
    if (kind === "oldest_first") {
      const p = rupeesToPaise(lump);
      if (p == null || p <= 0) return "Enter the amount received";
      return { kind: "oldest_first", amountPaise: p };
    }
    const amounts: Record<string, number> = {};
    for (const s of chosen) {
      const raw = perChild[s.id] ?? "";
      const p = raw.trim() ? rupeesToPaise(raw) : 0;
      if (p == null) return `${s.name}: enter a plain amount`;
      amounts[s.id] = p;
    }
    return { kind: "per_child", amounts };
  }

  async function runPreview() {
    const st = strategy();
    if (typeof st === "string") {
      setMsg({ text: st, bad: true });
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await toolsPost<{ plan: BulkPlan; signature: string }>("/api/fees/tools/bulk-payment", {
      action: "preview",
      studentIds: ids,
      strategy: st,
      includeFuture,
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({ text: r.error, bad: true });
      return;
    }
    if (!r.plan.ok) {
      setMsg({ text: r.plan.error, bad: true });
      setPreview(null);
      return;
    }
    setPreview({ plan: r.plan, batchId: newBatchId(), signature: r.signature });
  }

  async function post() {
    if (!preview || !preview.plan.ok) return;
    const st = strategy();
    if (typeof st === "string") return;
    if (!window.confirm(`Post ${preview.plan.receipts.length} receipt(s) for ${inr(preview.plan.totalPaise)} from "${payerLabel}"?`)) return;
    setBusy(true);
    setMsg(null);
    const r = await toolsPost<{ record: BulkRecord; duplicate: boolean }>("/api/fees/tools/bulk-payment", {
      action: "post",
      batchId: preview.batchId,
      expectedTotalPaise: preview.plan.totalPaise,
      expectedSignature: preview.signature,
      studentIds: ids,
      strategy: st,
      includeFuture,
      mode,
      ref,
      instrumentDate,
      bankName,
      payerLabel,
      note,
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({ text: r.error, bad: true });
      return;
    }
    setMsg({
      text: `${r.duplicate ? "Already posted" : "Posted"}: ${r.record.receipts.map((x) => `${x.studentName} ${x.receiptNo}`).join(" · ")} — ${inr(r.record.totalPaise)}`,
      bad: false,
    });
    setPreview(null);
    setChosen([]);
    setPerChild({});
    setLump("");
    await loadHistory();
  }

  const childActions: RowAction<LookupStudent>[] = [
    { id: "sibs", label: "Add brothers / sisters", icon: <Users />, onSelect: (s) => void addSiblings(s), hidden: (s) => !s.siblingIds.length },
    { id: "remove", label: "Remove", icon: <Trash2 />, tone: "danger", separatorAbove: true, onSelect: (s) => setChosen((prev) => prev.filter((x) => x.id !== s.id)) },
  ];
  const historyActions: RowAction<BulkRecord>[] = [
    {
      id: "open",
      label: "Open first receipt",
      onSelect: (b) => {
        const v = b.receipts.find((x) => x.voucherId)?.voucherId;
        if (v) window.open(`/fees?openReceipt=${encodeURIComponent(v)}`, "_self");
      },
    },
  ];

  const plan = preview?.plan.ok ? preview.plan : null;
  const payerProblem = !payerLabel.trim() ? "Say who paid" : modeMeta?.needsRef && !ref.trim() ? `Enter the ${modeMeta.refLabel.toLowerCase()}` : "";

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">1 · Who is being paid for</h3>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-[16rem] flex-1">
            <FeeToolsStudentPicker onPick={(s) => add([s])} disabled={!canCollect} />
          </div>
          <button type="button" className={BTN_OUTLINE} disabled={!canCollect} onClick={() => void addGround("staff_ward", "staff ward")}>
            <Plus className="size-3.5" /> Every staff ward
          </button>
          <label className="flex items-center gap-2 px-2 py-2 text-xs text-[var(--brand-deep)]">
            <input type="checkbox" className="size-4 accent-[var(--brand-deep)]" checked={includeFuture} onChange={(e) => setIncludeFuture(e.target.checked)} />
            Include months not yet due
          </label>
        </div>
        {duesError ? <p className="text-xs font-medium text-[var(--danger)]">Could not load dues: {duesError}</p> : null}
        {chosen.length > 0 ? (
          <ErpTableShell density="compact">
            <div className="overflow-x-auto">
              <ErpTable minWidth="min-w-[560px]">
                <ErpTableHead>
                  <tr>
                    <th className="px-3 py-2">Student</th>
                    <th className="px-3 py-2">Family</th>
                    <th className="px-3 py-2 text-right">Owes {includeFuture ? "(incl. future)" : "(up to today)"}</th>
                    {kind === "per_child" ? <th className="px-3 py-2">This payment (₹)</th> : null}
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {chosen.map((s) => {
                    const d = duesById[s.id];
                    const owes = d ? (d.dues ?? []).reduce((n, x) => n + x.balancePaise, 0) : null;
                    return (
                      <tr key={s.id}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-[var(--brand-deep)]">{s.name}</div>
                          <div className="text-[11px] text-[var(--muted)]">{s.classLabel} · {s.admissionNo}</div>
                        </td>
                        <td className="px-3 py-2 text-xs">{s.guardianName || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{owes == null ? "…" : inr(owes)}</td>
                        {kind === "per_child" ? (
                          <td className="px-3 py-2">
                            <input
                              className="field w-28 !py-1 !text-xs"
                              inputMode="decimal"
                              value={perChild[s.id] ?? ""}
                              onChange={(e) => setPerChild((prev) => ({ ...prev, [s.id]: e.target.value }))}
                              aria-label={`Amount for ${s.name}`}
                            />
                          </td>
                        ) : null}
                        <td className="px-3 py-2">
                          <RowActionMenu row={s} actions={childActions} />
                        </td>
                      </tr>
                    );
                  })}
                </ErpTableBody>
              </ErpTable>
            </div>
          </ErpTableShell>
        ) : (
          <p className="text-xs text-[var(--muted)]">Add the children this payment covers.</p>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">2 · How much, and how it was paid</h3>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--brand-deep)]">
          {(
            [
              ["full", "Everything they owe"],
              ["oldest_first", "One amount — oldest dues first"],
              ["per_child", "An amount for each child"],
            ] as [StrategyKind, string][]
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="radio" name="bulk-kind" className="accent-[var(--brand-deep)]" checked={kind === k} onChange={() => setKind(k)} />
              {label}
            </label>
          ))}
        </div>
        {kind === "oldest_first" ? (
          <label className="block max-w-xs text-xs">
            <span className="mb-0.5 block text-[var(--muted)]">Amount received (₹)</span>
            <input className="field w-full" inputMode="decimal" value={lump} onChange={(e) => setLump(e.target.value)} />
          </label>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs">
            <span className="mb-0.5 block text-[var(--muted)]">Paid by</span>
            <input className="field w-full" value={payerLabel} onChange={(e) => setPayerLabel(e.target.value)} placeholder="Sponsor / parent / 'Staff ward — Oct'" />
          </label>
          <label className="text-xs">
            <span className="mb-0.5 block text-[var(--muted)]">Mode</span>
            <select className="field w-full" value={mode} onChange={(e) => setMode(e.target.value)}>
              {TENDER_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          {modeMeta?.needsRef ? (
            <label className="text-xs">
              <span className="mb-0.5 block text-[var(--muted)]">{modeMeta.refLabel}</span>
              <input className="field w-full" value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
          ) : null}
          {modeMeta?.needsInstrumentDate ? (
            <label className="text-xs">
              <span className="mb-0.5 block text-[var(--muted)]">Instrument / txn date</span>
              <input type="date" className="field w-full" value={instrumentDate} onChange={(e) => setInstrumentDate(e.target.value)} />
            </label>
          ) : null}
          {modeMeta?.needsBank ? (
            <label className="text-xs">
              <span className="mb-0.5 block text-[var(--muted)]">Bank</span>
              <input className="field w-full" value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </label>
          ) : null}
        </div>
        {mode === "cheque" ? (
          <p className="text-xs text-[var(--muted)]">
            One cheque over several receipts appears in Fees → Cheques once per receipt. If it bounces, bounce each of them there.
          </p>
        ) : null}
        <label className="block text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Note (optional)</span>
          <input className="field w-full" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN_OUTLINE} disabled={busy || !canCollect || chosen.length === 0} onClick={() => void runPreview()}>
            <Eye className="size-3.5" /> Preview receipts
          </button>
        </div>
      </div>

      {msg ? (
        <p className={`rounded-lg px-3 py-2 text-sm font-medium ${msg.bad ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"}`}>
          {msg.text}
        </p>
      ) : null}

      {plan ? (
        <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            3 · Preview — {plan.receipts.length} receipt(s), {inr(plan.totalPaise)}
          </h3>
          <ErpTableShell density="compact">
            <div className="overflow-x-auto">
              <ErpTable minWidth="min-w-[560px]">
                <ErpTableHead>
                  <tr>
                    <th className="px-3 py-2">Receipt for</th>
                    <th className="px-3 py-2">Settles</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">Still owes</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {plan.receipts.map((r) => (
                    <tr key={r.studentId}>
                      <td className="px-3 py-2 font-semibold text-[var(--brand-deep)]">{r.studentName}</td>
                      <td className="px-3 py-2 text-xs text-[var(--muted)]">
                        {r.lines.map((l) => `${l.label} ${inr(l.amountPaise)}`).join(" · ")}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{inr(r.totalPaise)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{inr(r.remainingPaise)}</td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable>
            </div>
          </ErpTableShell>
          {plan.skipped.length ? (
            <p className="text-xs text-[var(--muted)]">
              No receipt: {plan.skipped.map((s) => `${s.studentName} (${s.why})`).join(" · ")}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN} disabled={busy || !!payerProblem || !canCollect} onClick={() => void post()}>
              {busy ? "Posting…" : `Post ${plan.receipts.length} receipt(s)`}
            </button>
            {payerProblem ? <span className="text-xs text-[var(--danger)]">{payerProblem}</span> : null}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Recent bulk payments</h3>
          <button type="button" className={BTN_OUTLINE} onClick={() => void loadHistory()} aria-label="Reload">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
        {historyError ? (
          <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]">Could not load: {historyError}</p>
        ) : history === null ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : (
          <ErpTableShell exportAs="bulk-fee-payments" exportTitle="Bulk fee payments">
            <div className="overflow-x-auto">
              <ErpTable>
                <ErpTableHead>
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Paid by</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2">Receipts</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody hoverable>
                  {history.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-[var(--muted)]">No bulk payments yet.</td>
                    </tr>
                  ) : (
                    history.map((b) => (
                      <tr key={b.id}>
                        <td className="px-3 py-2 tabular-nums">{b.collectionDate}</td>
                        <td className="px-3 py-2 font-semibold text-[var(--brand-deep)]">{b.payerLabel}</td>
                        <td className="px-3 py-2 text-xs">{TENDER_MODES.find((m) => m.value === b.mode)?.label ?? b.mode}{b.ref ? ` · ${b.ref}` : ""}</td>
                        <td className="px-3 py-2 text-xs text-[var(--muted)]">
                          {b.receipts.map((r) => `${r.studentName} ${r.receiptNo}`).join(" · ")}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{inr(b.totalPaise)}</td>
                        <td className="px-3 py-2">
                          <RowActionMenu row={b} actions={historyActions} />
                        </td>
                      </tr>
                    ))
                  )}
                </ErpTableBody>
              </ErpTable>
            </div>
          </ErpTableShell>
        )}
      </div>
    </div>
  );
}
