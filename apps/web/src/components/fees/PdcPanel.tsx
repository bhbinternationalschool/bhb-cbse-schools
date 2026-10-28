"use client";

/**
 * Post-dated cheque register (Fees → Bulk & PDC → Post-dated cheques).
 *
 * A cheque handed over today but dated later is recorded here against the
 * family and the dues it is meant for — and pays NOTHING yet: no receipt, no
 * due changes. On or after its date the cashier presses Deposit, which makes
 * an ordinary cheque receipt (the counter engine) and hands the cheque to
 * Fees → Cheques for clearing / bouncing. Bounced, returned or cancelled
 * before that, it is closed here with a reason.
 *
 * Everything is read from and written to the server (fee_pdc_cheques).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, CalendarClock, Plus, RefreshCw, Undo2, X, XCircle } from "lucide-react";
import { FeeToolsStudentPicker } from "@/components/fees/FeeToolsStudentPicker";
import { ErpMetricCard, ErpMetricGrid, ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import {
  BulkActionBar,
  ErpControlBar,
  ExportMenu,
  RowActionMenu,
  RowCheckbox,
  useRowSelection,
  type RowAction,
} from "@/components/ui/erp-grid";
import {
  canDepositPdc,
  pdcStatusLabel,
  pdcUrgency,
  sortPdcsByChequeDate,
  type PdcRecord,
} from "@/lib/feePdc";
import {
  inr,
  istTodayClient,
  paiseToRupeesText,
  rupeesToPaise,
  toolsGet,
  toolsPost,
  type LookupStudent,
} from "@/lib/feeToolsClient";

type Filter = "held" | "week" | "all" | "bounced";

type BouncedDesk = {
  id: string;
  chequeNo: string;
  bankName: string;
  chequeDate: string;
  amountPaise: number;
  receiptNo: string;
  householdId: string;
  bouncedAt: string;
  reason: string;
};

const BTN =
  "inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50";

function chip(active: boolean) {
  return `rounded-lg px-3 py-1.5 text-xs font-semibold ${
    active ? "bg-[var(--brand-deep)] text-white" : "border border-[var(--border)] text-[var(--brand-deep)]"
  }`;
}

export function PdcPanel({ canCollect, canClose }: { canCollect: boolean; canClose: boolean }) {
  const [rows, setRows] = useState<PdcRecord[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<Filter>("held");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busyId, setBusyId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [bounced, setBounced] = useState<{ pdcs: PdcRecord[]; desk: BouncedDesk[] } | null>(null);
  const [bouncedError, setBouncedError] = useState("");
  const today = istTodayClient();

  const load = useCallback(async () => {
    const r = await toolsGet<{ pdcs: PdcRecord[] }>("/api/fees/tools/pdc");
    if (!r.ok) {
      setLoadError(r.error);
      return;
    }
    setLoadError("");
    setRows(r.pdcs);
  }, []);

  const loadBounced = useCallback(async () => {
    const r = await toolsGet<{ pdcs: PdcRecord[]; desk: BouncedDesk[] }>("/api/fees/tools/pdc?bounced=1");
    if (!r.ok) {
      setBouncedError(r.error);
      return;
    }
    setBouncedError("");
    setBounced({ pdcs: r.pdcs, desk: r.desk });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (filter === "bounced") void loadBounced();
  }, [filter, loadBounced]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const held = list.filter((p) => p.status === "held");
    const sum = (xs: PdcRecord[]) => xs.reduce((n, p) => n + p.amountPaise, 0);
    const week = held.filter((p) => ["due_today", "this_week"].includes(pdcUrgency(p, today)));
    const overdue = held.filter((p) => pdcUrgency(p, today) === "overdue");
    const closed = list.filter((p) => p.status === "bounced" || p.status === "returned");
    return { held, week, overdue, closed, sum };
  }, [rows, today]);

  const shown = useMemo(() => {
    let list = rows ?? [];
    if (filter === "held") list = list.filter((p) => p.status === "held");
    else if (filter === "week")
      list = list.filter((p) => ["overdue", "due_today", "this_week"].includes(pdcUrgency(p, today)));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        [p.chequeNo, p.bankName, p.guardianName, p.receiptNo, ...p.intended.map((l) => l.studentName)]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return sortPdcsByChequeDate(list);
  }, [rows, filter, search, today]);

  const keys = useMemo(() => shown.map((p) => p.id), [shown]);
  const selection = useRowSelection(keys);

  async function deposit(p: PdcRecord): Promise<boolean> {
    setBusyId(p.id);
    setMsg(null);
    const r = await toolsPost<{ receiptNo: string; movedPaise: number; warning: string | null }>("/api/fees/tools/pdc", { action: "deposit", id: p.id });
    setBusyId("");
    if (!r.ok) {
      setMsg({ text: `Cheque ${p.chequeNo}: ${r.error}`, bad: true });
      await load();
      return false;
    }
    setMsg({
      text:
        `Cheque ${p.chequeNo} deposited — receipt ${r.receiptNo}. Track clearing in Fees → Cheques.` +
        (r.movedPaise > 0 ? ` ${inr(r.movedPaise)} went to the next open dues (some were already paid).` : "") +
        (r.warning ? ` ${r.warning}` : ""),
      bad: !!r.warning,
    });
    await load();
    return true;
  }

  async function close(p: PdcRecord, action: "bounce" | "return" | "cancel") {
    const word = action === "bounce" ? "bounce reason" : action === "return" ? "why it is returned" : "why it is cancelled";
    const reason = window.prompt(`Cheque ${p.chequeNo} (${inr(p.amountPaise)}) — enter the ${word}:`);
    if (reason == null) return;
    setBusyId(p.id);
    setMsg(null);
    const r = await toolsPost<{ pdc: PdcRecord }>("/api/fees/tools/pdc", { action, id: p.id, reason });
    setBusyId("");
    setMsg(r.ok ? { text: `Cheque ${p.chequeNo}: ${pdcStatusLabel(r.pdc.status)}`, bad: false } : { text: r.error, bad: true });
    await load();
    if (filter === "bounced") await loadBounced();
  }

  const actions: RowAction<PdcRecord>[] = [
    {
      id: "deposit",
      label: "Deposit → make receipt",
      icon: <Banknote />,
      hidden: (p) => p.status !== "held" || !canCollect,
      disabled: (p) => !!canDepositPdc(p, today) || busyId === p.id,
      onSelect: (p) => {
        if (window.confirm(`Deposit cheque ${p.chequeNo} for ${inr(p.amountPaise)}? This makes the receipt now.`)) void deposit(p);
      },
    },
    {
      id: "receipt",
      label: "Open receipt",
      hidden: (p) => !p.voucherId,
      onSelect: (p) => window.open(`/fees?openReceipt=${encodeURIComponent(p.voucherId)}`, "_self"),
    },
    { id: "return", label: "Returned to family", icon: <Undo2 />, hidden: (p) => p.status !== "held" || !canClose, onSelect: (p) => void close(p, "return"), separatorAbove: true },
    { id: "cancel", label: "Cancel", icon: <X />, hidden: (p) => p.status !== "held" || !canClose, onSelect: (p) => void close(p, "cancel") },
    { id: "bounce", label: "Bounced (before deposit)", icon: <XCircle />, tone: "danger", hidden: (p) => p.status !== "held" || !canClose, onSelect: (p) => void close(p, "bounce") },
  ];

  const exportRows = () =>
    shown.map((p) => ({
      chequeDate: p.chequeDate,
      chequeNo: p.chequeNo,
      bank: p.bankName,
      family: p.guardianName,
      forDues: p.intended.map((l) => `${l.studentName}: ${l.label}`).join("; "),
      amount: p.amountPaise / 100,
      status: pdcStatusLabel(p.status),
      receipt: p.receiptNo,
      received: p.receivedOn,
    }));

  return (
    <div className="space-y-4">
      <ErpMetricGrid>
        <ErpMetricCard title="Held — not yet due" tone="sky" value={`${stats.held.length} · ${inr(stats.sum(stats.held))}`} onClick={() => setFilter("held")} />
        <ErpMetricCard title="Due this week" tone="amber" value={`${stats.week.length} · ${inr(stats.sum(stats.week))}`} hint="Today and the next six days" onClick={() => setFilter("week")} />
        <ErpMetricCard title="Date passed, still held" tone="rose" value={`${stats.overdue.length} · ${inr(stats.sum(stats.overdue))}`} hint="Deposit these — a cheque is valid 3 months" onClick={() => setFilter("week")} />
        <ErpMetricCard title="Bounced / returned" tone="violet" value={`${stats.closed.length} · ${inr(stats.sum(stats.closed))}`} onClick={() => setFilter("bounced")} />
      </ErpMetricGrid>

      <ErpControlBar
        search={{ value: search, onChange: setSearch, placeholder: "Search cheque no, bank, family, student…" }}
        filters={
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={chip(filter === "held")} onClick={() => setFilter("held")}>Held</button>
            <button type="button" className={chip(filter === "week")} onClick={() => setFilter("week")}>Due this week</button>
            <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>All</button>
            <button type="button" className={chip(filter === "bounced")} onClick={() => setFilter("bounced")}>Bounced report</button>
          </div>
        }
        actions={
          <>
            <button type="button" className={BTN_OUTLINE} onClick={() => void load()} aria-label="Reload">
              <RefreshCw className="size-3.5" />
            </button>
            {canCollect ? (
              <button type="button" className={BTN} onClick={() => setShowForm((v) => !v)}>
                <Plus className="size-3.5" /> Record post-dated cheque
              </button>
            ) : null}
          </>
        }
        exportMenu={
          <ExportMenu
            title="Post-dated cheques by cheque date"
            fileBaseName="pdc-by-cheque-date"
            columns={[
              { key: "chequeDate", header: "Cheque date" },
              { key: "chequeNo", header: "Cheque no" },
              { key: "bank", header: "Bank" },
              { key: "family", header: "Family" },
              { key: "forDues", header: "For dues", width: 3 },
              { key: "amount", header: "Amount (₹)", align: "right" },
              { key: "status", header: "Status" },
              { key: "receipt", header: "Receipt" },
              { key: "received", header: "Received on" },
            ]}
            rows={exportRows}
            onMessage={(t) => setMsg({ text: t, bad: false })}
          />
        }
      />

      {msg ? (
        <p className={`rounded-lg px-3 py-2 text-sm font-medium ${msg.bad ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"}`}>
          {msg.text}
        </p>
      ) : null}

      {showForm && canCollect ? (
        <PdcForm
          onSaved={async (p) => {
            setShowForm(false);
            setMsg({ text: `Cheque ${p.chequeNo} recorded for ${p.chequeDate}. Nothing is marked paid until it is deposited.`, bad: false });
            await load();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      {filter === "bounced" ? (
        <BouncedReport data={bounced} error={bouncedError} />
      ) : loadError ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]">
          Could not load the post-dated cheques: {loadError}
        </p>
      ) : rows === null ? (
        <p className="px-1 py-6 text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <ErpTableShell>
          <div className="overflow-x-auto">
            <ErpTable>
              <ErpTableHead>
                <tr>
                  <th className="w-8 px-3 py-2">
                    <RowCheckbox
                      checked={selection.allSelected(keys)}
                      indeterminate={selection.someSelected(keys)}
                      onChange={() => selection.toggleAll(keys)}
                      label="Select all shown"
                    />
                  </th>
                  <th className="px-3 py-2">Cheque date</th>
                  <th className="px-3 py-2">Cheque</th>
                  <th className="px-3 py-2">Family</th>
                  <th className="px-3 py-2">For</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody hoverable>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                      No post-dated cheques in this view.
                    </td>
                  </tr>
                ) : (
                  shown.map((p) => {
                    const u = pdcUrgency(p, today);
                    const tint =
                      u === "overdue"
                        ? "bg-[var(--danger-soft)]"
                        : u === "due_today" || u === "this_week"
                          ? "bg-[var(--warning-soft)]"
                          : "";
                    return (
                      <tr key={p.id} className={tint}>
                        <td className="px-3 py-2">
                          <RowCheckbox checked={selection.isSelected(p.id)} onChange={() => selection.toggle(p.id)} label={`Select cheque ${p.chequeNo}`} />
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          <div className="font-semibold text-[var(--brand-deep)]">{p.chequeDate}</div>
                          <div className="text-[11px] text-[var(--muted)]">
                            {u === "overdue" ? "Date passed" : u === "due_today" ? "Due today" : u === "this_week" ? "This week" : `Received ${p.receivedOn}`}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-[var(--brand-deep)]">{p.chequeNo}</div>
                          <div className="text-[11px] text-[var(--muted)]">{p.bankName}</div>
                        </td>
                        <td className="px-3 py-2">{p.guardianName || "—"}</td>
                        <td className="px-3 py-2 text-xs text-[var(--muted)]">
                          {p.intended.map((l) => `${l.studentName}: ${l.label}`).join(" · ")}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-[var(--brand-deep)]">{inr(p.amountPaise)}</td>
                        <td className="px-3 py-2 text-xs">
                          <div className="font-semibold">{pdcStatusLabel(p.status)}</div>
                          {p.receiptNo ? <div className="text-[var(--muted)]">{p.receiptNo}</div> : null}
                          {p.statusReason ? <div className="text-[var(--muted)]">{p.statusReason}</div> : null}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            {p.status === "held" && canCollect && !canDepositPdc(p, today) ? (
                              <button
                                type="button"
                                className={BTN}
                                disabled={busyId === p.id}
                                onClick={() => {
                                  if (window.confirm(`Deposit cheque ${p.chequeNo} for ${inr(p.amountPaise)}? This makes the receipt now.`)) void deposit(p);
                                }}
                              >
                                {busyId === p.id ? "Working…" : "Deposit"}
                              </button>
                            ) : null}
                            <RowActionMenu row={p} actions={actions} />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </ErpTableBody>
            </ErpTable>
          </div>
        </ErpTableShell>
      )}

      <BulkActionBar
        selection={selection}
        noun="cheque"
        actions={[
          {
            id: "deposit-due",
            label: "Deposit the ones that are due",
            icon: <CalendarClock />,
            disabled: !canCollect,
            onRun: async (ids) => {
              const due = (rows ?? []).filter((p) => ids.includes(p.id) && !canDepositPdc(p, today));
              if (due.length === 0) {
                setMsg({ text: "None of the ticked cheques is due yet", bad: true });
                return;
              }
              if (!window.confirm(`Deposit ${due.length} cheque(s), ${inr(due.reduce((n, p) => n + p.amountPaise, 0))}? One receipt each.`)) return;
              let ok = 0;
              for (const p of due) if (await deposit(p)) ok += 1;
              setMsg({ text: `${ok} of ${due.length} cheque(s) deposited. Track clearing in Fees → Cheques.`, bad: ok !== due.length });
              selection.clear();
            },
          },
        ]}
      />
    </div>
  );
}

function BouncedReport({ data, error }: { data: { pdcs: PdcRecord[]; desk: BouncedDesk[] } | null; error: string }) {
  if (error) {
    return <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]">Could not load the bounced report: {error}</p>;
  }
  if (!data) return <p className="px-1 py-6 text-sm text-[var(--muted)]">Loading…</p>;
  const all = [
    ...data.pdcs.map((p) => ({
      key: p.id,
      source: "Post-dated, before deposit",
      chequeNo: p.chequeNo,
      bank: p.bankName,
      chequeDate: p.chequeDate,
      amountPaise: p.amountPaise,
      family: p.guardianName,
      receipt: "—",
      when: (p.updatedAt || "").slice(0, 10),
      reason: p.statusReason,
    })),
    ...data.desk.map((c) => ({
      key: c.id,
      source: "Deposited cheque (receipt voided)",
      chequeNo: c.chequeNo,
      bank: c.bankName,
      chequeDate: c.chequeDate,
      amountPaise: c.amountPaise,
      family: "",
      receipt: c.receiptNo,
      when: (c.bouncedAt || "").slice(0, 10),
      reason: c.reason,
    })),
  ].sort((a, b) => b.when.localeCompare(a.when));
  return (
    <ErpTableShell exportAs="bounced-cheques" exportTitle="Bounced cheques (incl. post-dated)">
      <div className="overflow-x-auto">
        <ErpTable>
          <ErpTableHead>
            <tr>
              <th className="px-3 py-2">Bounced on</th>
              <th className="px-3 py-2">Cheque</th>
              <th className="px-3 py-2">Cheque date</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Family / receipt</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody hoverable>
            {all.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-[var(--muted)]">No bounced cheques.</td>
              </tr>
            ) : (
              all.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-2 tabular-nums">{r.when || "—"}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-[var(--brand-deep)]">{r.chequeNo || "—"}</div>
                    <div className="text-[11px] text-[var(--muted)]">{r.bank}</div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.chequeDate || "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.source}</td>
                  <td className="px-3 py-2 text-xs">{[r.family, r.receipt !== "—" ? r.receipt : ""].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{inr(r.amountPaise)}</td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">{r.reason || "—"}</td>
                </tr>
              ))
            )}
          </ErpTableBody>
        </ErpTable>
      </div>
    </ErpTableShell>
  );
}

type DueRow = { studentId: string; studentName: string; dueKey: string; label: string; kind: string; dueOn: string | null; balancePaise: number };

function PdcForm({ onSaved, onCancel }: { onSaved: (p: PdcRecord) => void | Promise<void>; onCancel: () => void }) {
  const [family, setFamily] = useState<{ householdId: string; guardianName: string } | null>(null);
  const [dues, setDues] = useState<DueRow[] | null>(null);
  const [duesError, setDuesError] = useState("");
  const [ticked, setTicked] = useState<Record<string, string>>({});
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [receivedOn, setReceivedOn] = useState(istTodayClient());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(s: LookupStudent) {
    if (!s.householdId) {
      setError(`${s.name} has no family on record`);
      return;
    }
    setFamily({ householdId: s.householdId, guardianName: s.guardianName });
    setDues(null);
    setTicked({});
    setError("");
    const r = await toolsGet<{ students: LookupStudent[] }>(
      `/api/fees/tools/lookup?householdId=${encodeURIComponent(s.householdId)}&future=1`,
    );
    if (!r.ok) {
      setDuesError(r.error);
      return;
    }
    setDuesError("");
    setDues(
      r.students.flatMap((k) =>
        (k.dues ?? []).map((d) => ({ studentId: k.id, studentName: k.name, ...d })),
      ),
    );
  }

  const keyOf = (d: DueRow) => `${d.studentId}|${d.dueKey}`;
  const lines = (dues ?? [])
    .filter((d) => ticked[keyOf(d)] !== undefined)
    .map((d) => ({ d, paise: rupeesToPaise(ticked[keyOf(d)] ?? "") }));
  const total = lines.reduce((n, l) => n + (l.paise ?? 0), 0);
  const badLine = lines.find((l) => l.paise == null || l.paise <= 0 || l.paise > l.d.balancePaise);

  async function save() {
    if (!family) return;
    if (badLine) {
      setError(`${badLine.d.label}: enter an amount up to ${inr(badLine.d.balancePaise)}`);
      return;
    }
    setBusy(true);
    setError("");
    const r = await toolsPost<{ pdc: PdcRecord }>("/api/fees/tools/pdc", {
      action: "create",
      householdId: family.householdId,
      chequeNo,
      bankName,
      chequeDate,
      receivedOn,
      amountPaise: total,
      note,
      intended: lines.map((l) => ({
        studentId: l.d.studentId,
        studentName: l.d.studentName,
        dueKey: l.d.dueKey,
        label: l.d.label,
        kind: l.d.kind,
        amountPaise: l.paise,
      })),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    await onSaved(r.pdc);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Record a post-dated cheque</h3>
        <button type="button" className={BTN_OUTLINE} onClick={onCancel} aria-label="Close">
          <X className="size-3.5" />
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Nothing is marked paid now. The receipt is made when the cheque is deposited on or after its date.
      </p>
      <FeeToolsStudentPicker onPick={(s) => void pick(s)} placeholder="Family — find any child by name, admission no or mobile" />
      {family ? (
        <p className="text-sm font-semibold text-[var(--brand-deep)]">Family: {family.guardianName || family.householdId}</p>
      ) : null}
      {duesError ? <p className="text-xs font-medium text-[var(--danger)]">Could not load dues: {duesError}</p> : null}
      {family && dues === null && !duesError ? <p className="text-xs text-[var(--muted)]">Loading dues…</p> : null}
      {dues && dues.length === 0 ? <p className="text-xs text-[var(--muted)]">This family has no open dues, now or in future months.</p> : null}
      {dues && dues.length > 0 ? (
        <div className="max-h-64 overflow-auto rounded-xl border border-[var(--border)]">
          {dues.map((d) => {
            const k = keyOf(d);
            const on = ticked[k] !== undefined;
            return (
              <label key={k} className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 text-xs last:border-b-0">
                <input
                  type="checkbox"
                  checked={on}
                  className="size-4 accent-[var(--brand-deep)]"
                  onChange={() =>
                    setTicked((prev) => {
                      const next = { ...prev };
                      if (on) delete next[k];
                      else next[k] = paiseToRupeesText(d.balancePaise);
                      return next;
                    })
                  }
                />
                <span className="flex-1">
                  <span className="font-semibold text-[var(--brand-deep)]">{d.studentName}</span> · {d.label}
                  <span className="text-[var(--muted)]"> · due {d.dueOn || "—"} · {inr(d.balancePaise)}</span>
                </span>
                {on ? (
                  <input
                    className="field w-24 !py-1 !text-xs"
                    inputMode="decimal"
                    value={ticked[k]}
                    onChange={(e) => setTicked((prev) => ({ ...prev, [k]: e.target.value }))}
                    aria-label={`Share of the cheque for ${d.label}`}
                  />
                ) : null}
              </label>
            );
          })}
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Cheque no.</span>
          <input className="field w-full" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Bank</span>
          <input className="field w-full" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. SBI, Varanasi" />
        </label>
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Date on the cheque</span>
          <input type="date" className="field w-full" value={chequeDate} min={istTodayClient()} onChange={(e) => setChequeDate(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Received on</span>
          <input type="date" className="field w-full" value={receivedOn} max={istTodayClient()} onChange={(e) => setReceivedOn(e.target.value)} />
        </label>
      </div>
      <label className="block text-xs">
        <span className="mb-0.5 block text-[var(--muted)]">Note (optional)</span>
        <input className="field w-full" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-[var(--brand-deep)]">Cheque amount: {inr(total)}</span>
        <button type="button" className={BTN} disabled={busy || !family || lines.length === 0} onClick={() => void save()}>
          {busy ? "Saving…" : "Save post-dated cheque"}
        </button>
      </div>
      {error ? <p className="text-xs font-medium text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
