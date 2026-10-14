"use client";

/**
 * Transport → Finance → Vehicle loans, from the books (Ledger v2).
 *
 * Shows; never posts. An EMI's principal/interest split comes from the
 * lender's amortisation schedule, which the system does not hold — so a
 * missing EMI is flagged here and posted by the office in Accounts →
 * Vouchers, from the schedule. See lib/transportFinance.ts.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatInr } from "@/lib/fees";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";
import { VoucherDetailDialog } from "@/components/accounts/VoucherDetailDialog";
import { monthLabel, type LoanLink, type LoanSummary } from "@/lib/transportFinance";

type LoanView = { code: string; name: string; link: LoanLink | null; vehicleLabel: string; summary: LoanSummary };
type VehicleRef = { id: string; label: string; isActive: boolean };

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; message: string; forbidden: boolean }
  | { kind: "ok"; loans: LoanView[]; vehicles: VehicleRef[]; today: string; canEdit: boolean };

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function VehicleLoansPanel() {
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  const [openVoucher, setOpenVoucher] = useState<string | null>(null);
  const [editing, setEditing] = useState<LoanView | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/transport/vehicle-loans", { credentials: "same-origin", cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        loans?: LoanView[];
        vehicles?: VehicleRef[];
        today?: string;
        canEdit?: boolean;
      };
      if (!res.ok || !body.ok) {
        setState({ kind: "error", message: body.error || `Could not load the loans (${res.status})`, forbidden: res.status === 403 || res.status === 401 });
        return;
      }
      setState({
        kind: "ok",
        loans: body.loans ?? [],
        vehicles: body.vehicles ?? [],
        today: body.today ?? "",
        canEdit: !!body.canEdit,
      });
    } catch {
      setState({ kind: "error", message: "Could not reach the server — the loans are not shown, not missing.", forbidden: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalOut = state.kind === "ok" ? state.loans.reduce((n, l) => n + Math.max(0, l.summary.outstandingPaise), 0) : 0;
  const missingCount = state.kind === "ok" ? state.loans.reduce((n, l) => n + l.summary.missingMonths.length, 0) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">Vehicle loans — from the books</h2>
          <p className="text-[11px] text-[var(--muted)]">
            Balances and EMIs as posted in Accounts. Nothing is posted from here: an EMI&apos;s principal and interest come from the lender&apos;s schedule.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/accounts?tab=vouchers" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--brand-deep)]">
            Post an EMI (Accounts → Vouchers)
          </Link>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold">
            Refresh
          </button>
        </div>
      </div>

      {state.kind === "loading" ? <p className="text-sm text-[var(--muted)]">Reading the loan accounts…</p> : null}
      {state.kind === "error" ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-sm">
          {state.forbidden
            ? "Loan balances are Accounts figures: seeing them needs Accounts · view and Accounts position · view (Masters → Roles)."
            : state.message}
        </p>
      ) : null}

      {state.kind === "ok" ? (
        <>
          {state.loans.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No vehicle-loan account in the books. A loan is a liability account named &quot;Vehicle Loan — …&quot; in Accounts.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="rounded-lg bg-[var(--surface-sunken)] px-3 py-1.5">
                  Owed on {state.loans.length} loan{state.loans.length === 1 ? "" : "s"}: <b>{formatInr(totalOut)}</b>
                </span>
                {missingCount > 0 ? (
                  <span className="rounded-lg bg-[var(--danger-soft)] px-3 py-1.5 font-bold text-[var(--danger)]">
                    {missingCount} EMI{missingCount === 1 ? "" : "s"} not posted — balances are stale until they are
                  </span>
                ) : (
                  <span className="rounded-lg bg-[var(--success-soft)] px-3 py-1.5 font-semibold text-[var(--success)]">Every EMI due so far is posted</span>
                )}
              </div>
              <ErpTableShell density="compact" exportAs="vehicle_loans" exportTitle="Vehicle loans">
                <div className="overflow-x-auto">
                  <ErpTable minWidth="min-w-[960px]">
                    <ErpTableHead>
                      <tr>
                        <th className="px-3 py-2">Loan account</th>
                        <th className="px-3 py-2">Vehicle</th>
                        <th className="px-3 py-2 text-right">Outstanding</th>
                        <th className="px-3 py-2 text-right">Principal this FY</th>
                        <th className="px-3 py-2 text-right">Interest this FY</th>
                        <th className="px-3 py-2">Last EMI posted</th>
                        <th className="px-3 py-2">Next due</th>
                        <th className="px-3 py-2">Not posted</th>
                        <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                      </tr>
                    </ErpTableHead>
                    <ErpTableBody>
                      {state.loans.map((l) => {
                        const s = l.summary;
                        return (
                          <tr key={l.code} className="align-top">
                            <td className="px-3 py-2">
                              <div className="font-semibold text-[var(--brand-deep)]">{l.name}</div>
                              <div className="text-[10px] text-[var(--muted)]">
                                {l.code}
                                {l.link?.paidBy ? ` · paid by ${l.link.paidBy}` : ""}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs">{l.vehicleLabel || <span className="text-[var(--muted)]">Not linked</span>}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">
                              {s.outstandingPaise <= 0 ? "Repaid" : formatInr(s.outstandingPaise)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatInr(s.principalThisFyPaise)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatInr(s.interestThisFyPaise)}</td>
                            <td className="px-3 py-2 text-xs">
                              {s.lastEmi ? (
                                <>
                                  <button
                                    type="button"
                                    className="font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                                    onClick={() => setOpenVoucher(s.lastEmi!.voucherNo)}
                                  >
                                    {s.lastEmi.voucherNo}
                                  </button>
                                  <div className="text-[10px] text-[var(--muted)]">
                                    {fmtDate(s.lastEmi.date)} · {formatInr(s.lastEmi.principalPaise + s.lastEmi.interestPaise)}
                                  </div>
                                </>
                              ) : (
                                <span className="text-[var(--muted)]">None yet</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {s.nextDueOn ? fmtDate(s.nextDueOn) : "—"}
                              {s.lastEmiTotalPaise > 0 && s.nextDueOn ? (
                                <div className="text-[10px] text-[var(--muted)]">≈ {formatInr(s.lastEmiTotalPaise)}</div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              {s.missingMonths.length === 0 ? (
                                <span className="text-xs text-[var(--muted)]">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {s.missingMonths.map((m) => (
                                    <span
                                      key={m}
                                      className="rounded-md bg-[var(--danger-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--danger)]"
                                      title={`The ${monthLabel(m)} EMI is not in the books`}
                                    >
                                      {monthLabel(m)} EMI not posted
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <RowActionMenu
                                row={l}
                                actions={[
                                  {
                                    id: "voucher",
                                    label: "Open last EMI voucher",
                                    hidden: (r) => !r.summary.lastEmi,
                                    onSelect: (r) => setOpenVoucher(r.summary.lastEmi!.voucherNo),
                                  },
                                  {
                                    id: "link",
                                    label: "Link to a vehicle / EMI day",
                                    hidden: () => !state.canEdit,
                                    onSelect: (r) => setEditing(r),
                                  },
                                ]}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </ErpTableBody>
                  </ErpTable>
                </div>
              </ErpTableShell>
            </>
          )}
          <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
            Loans live in Accounts — add a new loan there (a liability account named &quot;Vehicle Loan — …&quot; plus its opening entry), then link it to the bus here.{" "}
            <Link href="/accounts?tab=masters" className="font-semibold text-[var(--brand-mid)]">
              Open Accounts → Masters
            </Link>
          </div>
          {editing ? (
            <LinkEditor
              loan={editing}
              vehicles={state.vehicles}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                void load();
              }}
            />
          ) : null}
        </>
      ) : null}

      {openVoucher ? <VoucherDetailDialog target={{ voucherNo: openVoucher }} onClose={() => setOpenVoucher(null)} /> : null}
    </div>
  );
}

function LinkEditor({
  loan,
  vehicles,
  onClose,
  onSaved,
}: {
  loan: LoanView;
  vehicles: VehicleRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [vehicleId, setVehicleId] = useState(loan.link?.vehicleId ?? "");
  const [day, setDay] = useState(String(loan.link?.emiDueDay ?? 10));
  const [paidBy, setPaidBy] = useState(loan.link?.paidBy ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/transport/vehicle-loans", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "link", code: loan.code, vehicleId, emiDueDay: Number(day), paidBy }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setErr(body.error || `Not saved (${res.status})`);
        return;
      }
      onSaved();
    } catch {
      setErr("Could not reach the server — not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="text-sm font-bold text-[var(--brand-deep)]">{loan.name}</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="text-[11px] font-semibold text-[var(--muted)]">
          Vehicle
          <select className="field mt-1 !py-1.5" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Not linked</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {v.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-[var(--muted)]">
          EMI debited on day
          <input className="field mt-1 !py-1.5" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))} />
        </label>
        <label className="text-[11px] font-semibold text-[var(--muted)]">
          Paid by (shown only)
          <input className="field mt-1 !py-1.5" placeholder="Bank NACH / Trustee" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} />
        </label>
      </div>
      {err ? <p className="mt-2 text-xs font-semibold text-[var(--danger)]">{err}</p> : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-bold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onClose} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold">
          Cancel
        </button>
      </div>
    </div>
  );
}
