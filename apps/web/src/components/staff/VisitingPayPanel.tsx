"use client";

/**
 * Staff → Visiting pay (director, 11 Oct 2026): people paid by the period,
 * hour or day who are not on payroll — AI teacher, music, dance, survey.
 *
 *   month grid   one row per visiting person: build / refresh the month's
 *                sheet, open it, approve, pay, PDF
 *   sheet        dated lines from their basis (timetable + punch, punch
 *                hours, punch or survey days); the office confirms, changes,
 *                adds or removes lines only with a reason; TDS 194J worked
 *                out on the sheet; approve (someone other than the maker)
 *                locks it; pay by Cashfree, cash box or bank
 *   report       month, person, gross, TDS, net, status — exportable
 *
 * Everything lives on the server (/api/staff/visiting-pay). Nothing here is
 * kept in the browser.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, IndianRupee, RefreshCw, Users, X } from "lucide-react";
import { ErpControlBar, ExportMenu, RowActionMenu, RowCheckbox, BulkActionBar, useRowSelection, type RowAction } from "@/components/ui/erp-grid";
import { ErpMetricCard, ErpMetricGrid, ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import { pushToast } from "@/components/shell/Toast";
import { DraftMonthInput } from "@/components/ui/draft-inputs";
import { requestStatusSentence, type PayoutRequestChannel, type PayoutRequestStatus } from "@/lib/payoutRequests";
import { fyMonths, fyOfMonth, istToday, sheetStatusSentence, type SheetStatus, type TdsComputation, type VisitingPayBasis, type WorkLineStatus } from "@/lib/visitingPay";

type StaffRow = {
  id: string;
  empCode: string;
  fullName: string;
  status: string;
  basis: VisitingPayBasis | "";
  ratePaise: number | null;
  tds194j: boolean;
  panNo: string;
  hasBank: boolean;
  hasUpi: boolean;
  mobile: string;
  problems: { errors: string[]; warnings: string[] };
};

type Sheet = {
  id: string;
  staffId: string;
  staffName: string;
  month: string;
  basis: VisitingPayBasis;
  ratePaise: number;
  tdsApplies: boolean;
  status: SheetStatus;
  grossPaise: number;
  tdsPaise: number;
  netPaise: number;
  tdsDetail: TdsComputation | null;
  warnings: string[];
  builtBy: string;
  builtAt: string | null;
  makers: string[];
  approvedBy: string;
  approvedAt: string | null;
  payMode: string;
  paymentKey: string;
  payoutRequestId: string;
  paidAt: string | null;
  paidBy: string;
  paidRef: string;
  ledgerVoucherNo: string;
  lastError: string;
};

type Line = {
  id: string;
  key: string;
  date: string;
  unit: "period" | "hour" | "day";
  qty: number;
  ratePaise: number;
  amountPaise: number;
  source: string;
  status: WorkLineStatus;
  note: string;
  adjustedAt: string | null;
  adjustedBy: string;
  adjustReason: string;
};

type Audit = { id: string; at: string; by: string; action: string; reason: string };
type Payout = { id: string; status: PayoutRequestStatus; channel: PayoutRequestChannel; amountPaise: number; lastError: string; utr: string } | null;

const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const BASIS_SHORT: Record<VisitingPayBasis, string> = { per_period: "period", per_hour: "hour", per_day: "day" };
const STATUS_TONE: Record<SheetStatus, string> = {
  draft: "bg-[var(--surface-sunken)] text-[var(--muted)]",
  approved: "bg-[var(--info-soft)] text-[var(--brand-deep)]",
  paid: "bg-[var(--success-soft)] text-[var(--success)]",
};
const LINE_TONE: Record<WorkLineStatus, string> = {
  counted: "",
  unconfirmed: "text-[var(--warning)]",
  flagged: "text-[var(--danger)]",
  removed: "text-[var(--muted)] line-through",
};
const LINE_LABEL: Record<WorkLineStatus, string> = { counted: "Counted", unconfirmed: "Not confirmed", flagged: "Flagged", removed: "Removed" };

function thisMonth(): string {
  return istToday().slice(0, 7);
}

function shiftMonth(m: string, by: number): string {
  const [y, mm] = m.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mm - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; message?: string; sheet?: Sheet; payout?: Payout }> {
  try {
    const r = await fetch("/api/staff/visiting-pay", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as { ok: boolean; error?: string } | null;
    return j ?? { ok: false, error: `HTTP ${r.status}` };
  } catch {
    return { ok: false, error: "No reply from the server — check the sheet before trying again" };
  }
}

export function VisitingPayPanel() {
  const [month, setMonth] = useState(thisMonth());
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [banks, setBanks] = useState<{ code: string; name: string; bankAccountId: string }[]>([]);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [openId, setOpenId] = useState("");
  const [reportFrom, setReportFrom] = useState(fyMonths(fyOfMonth(thisMonth()))[0]!);
  const [reportTo, setReportTo] = useState(thisMonth());
  const [report, setReport] = useState<Sheet[] | null>(null);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const r = await fetch(`/api/staff/visiting-pay?month=${month}`, { credentials: "same-origin", cache: "no-store" });
      const j = (await r.json()) as { ok: boolean; error?: string; staff?: StaffRow[]; sheets?: Sheet[]; banks?: typeof banks };
      if (!j.ok) {
        setLoadError(j.error || `Could not load (HTTP ${r.status})`);
        setStaff(null);
        return;
      }
      setStaff(j.staff ?? []);
      setSheets(j.sheets ?? []);
      setBanks(j.banks ?? []);
    } catch {
      // Unknown is not "nobody": say it could not load.
      setLoadError("Could not reach the server");
      setStaff(null);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const sheetBy = useMemo(() => new Map(sheets.map((s) => [s.staffId, s])), [sheets]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (staff ?? []).filter((s) => !q || `${s.fullName} ${s.empCode}`.toLowerCase().includes(q));
  }, [staff, query]);
  const keys = useMemo(() => rows.map((r) => r.id), [rows]);
  const selection = useRowSelection(keys);

  const totals = useMemo(() => {
    let gross = 0;
    let tds = 0;
    let net = 0;
    let paid = 0;
    for (const s of sheets) {
      gross += s.grossPaise;
      tds += s.tdsPaise;
      net += s.netPaise;
      if (s.status === "paid") paid += 1;
    }
    return { gross, tds, net, paid };
  }, [sheets]);

  async function build(staffIds: string[]) {
    setBusy("build");
    let ok = 0;
    const errors: string[] = [];
    for (const id of staffIds) {
      const r = await post({ action: "build", staffId: id, month });
      if (r.ok) ok += 1;
      else errors.push(`${staff?.find((s) => s.id === id)?.fullName ?? id}: ${r.error}`);
    }
    setBusy("");
    if (ok) pushToast({ message: `${ok} sheet${ok === 1 ? "" : "s"} built / refreshed for ${month}`, kind: "success" });
    if (errors.length) pushToast({ message: errors.join(" · "), kind: "error" });
    await load();
  }

  async function loadReport() {
    setBusy("report");
    try {
      const r = await fetch(`/api/staff/visiting-pay?from=${reportFrom}&to=${reportTo}`, { credentials: "same-origin", cache: "no-store" });
      const j = (await r.json()) as { ok: boolean; error?: string; sheets?: Sheet[] };
      if (!j.ok) pushToast({ message: j.error || "Could not load the report", kind: "error" });
      setReport(j.ok ? j.sheets ?? [] : null);
    } finally {
      setBusy("");
    }
  }

  const rowActions: RowAction<StaffRow>[] = [
    {
      id: "build",
      label: "Build / refresh this month's sheet",
      icon: <RefreshCw />,
      onSelect: (r) => void build([r.id]),
      disabled: (r) => r.problems.errors.length > 0 || sheetBy.get(r.id)?.status === "approved" || sheetBy.get(r.id)?.status === "paid",
    },
    { id: "open", label: "Open sheet", icon: <FileText />, onSelect: (r) => setOpenId(sheetBy.get(r.id)?.id ?? ""), hidden: (r) => !sheetBy.get(r.id) },
    { id: "profile", label: "Open staff profile (rate, TDS, bank)", icon: <Users />, onSelect: (r) => window.open(`/staff/${r.id}/edit`, "_self") },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
        <p className="font-semibold text-[var(--brand-deep)]">Visiting pay — people paid by the period, hour or day, not on payroll</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Set someone up by choosing Employment type <b>Visiting</b> on their staff profile, with how they are paid, the rate and the TDS
          tick. Give them a staff login so they can punch in. Each month: build the sheet, check it, have someone else approve it, then
          pay — by Cashfree to their bank / UPI, or in cash from the cash box.
        </p>
      </div>

      <ErpMetricGrid>
        <ErpMetricCard title="Visiting staff" value={staff ? staff.length : "—"} tone="sky" icon={<Users className="size-6" />} />
        <ErpMetricCard title={`Sheets for ${month}`} value={staff ? `${sheets.length}` : "—"} tone="violet" hint={`${totals.paid} paid`} icon={<FileText className="size-6" />} />
        <ErpMetricCard title="Gross fees" value={staff ? inr(totals.gross) : "—"} tone="amber" hint={`TDS ${inr(totals.tds)}`} icon={<IndianRupee className="size-6" />} />
        <ErpMetricCard title="Net to pay" value={staff ? inr(totals.net) : "—"} tone="green" icon={<CheckCircle2 className="size-6" />} />
      </ErpMetricGrid>

      <ErpControlBar
        search={{ value: query, onChange: setQuery, placeholder: "Search name or code…" }}
        filters={
          <div className="flex items-center gap-1">
            <button type="button" className={btnOutline} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
              ‹
            </button>
            <DraftMonthInput aria-label="Month" className={`${field} !w-auto`} value={month} max={thisMonth()} onCommit={(ym) => setMonth(ym > thisMonth() ? thisMonth() : ym)} />
            <button type="button" className={btnOutline} onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()} aria-label="Next month">
              ›
            </button>
          </div>
        }
        actions={
          <button
            type="button"
            className={btn}
            disabled={!!busy || !rows.length}
            onClick={() => void build(rows.filter((r) => !r.problems.errors.length && !["approved", "paid"].includes(sheetBy.get(r.id)?.status ?? "")).map((r) => r.id))}
          >
            {busy === "build" ? "Building…" : "Build / refresh all drafts"}
          </button>
        }
        exportMenu={
          <ExportMenu
            title={`Visiting pay — ${month}`}
            fileBaseName={`visiting-pay-${month}`}
            columns={[
              { key: "name", header: "Name", width: 2 },
              { key: "code", header: "Code" },
              { key: "basis", header: "Paid per" },
              { key: "rate", header: "Rate ₹", align: "right" },
              { key: "status", header: "Sheet" },
              { key: "gross", header: "Gross ₹", align: "right" },
              { key: "tds", header: "TDS ₹", align: "right" },
              { key: "net", header: "Net ₹", align: "right" },
            ]}
            rows={() =>
              rows.map((r) => {
                const s = sheetBy.get(r.id);
                return {
                  name: r.fullName,
                  code: r.empCode,
                  basis: r.basis ? BASIS_SHORT[r.basis] : "",
                  rate: r.ratePaise ? r.ratePaise / 100 : "",
                  status: s ? s.status : "not built",
                  gross: s ? s.grossPaise / 100 : "",
                  tds: s ? s.tdsPaise / 100 : "",
                  net: s ? s.netPaise / 100 : "",
                };
              })
            }
          />
        }
      />

      {loadError ? (
        <p className="rounded-xl border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">
          {loadError}. Nothing is shown rather than a list that might be wrong.{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}

      {staff && staff.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          No visiting staff yet. Open a staff profile → Employment → Employment type <b>Visiting</b>.
        </p>
      ) : null}

      {staff && staff.length > 0 ? (
        <ErpTableShell>
          <div className="overflow-x-auto">
          <ErpTable minWidth="min-w-[860px]">
            <ErpTableHead>
              <tr>
                <th className="w-8 px-3 py-2">
                  <RowCheckbox
                    checked={selection.allSelected(keys)}
                    indeterminate={selection.someSelected(keys)}
                    onChange={() => selection.toggleAll(keys)}
                    label="Select all"
                  />
                </th>
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Paid per</th>
                <th className="px-3 py-2">Pays to</th>
                <th className="px-3 py-2">Sheet</th>
                <th className="px-3 py-2 text-right">Gross</th>
                <th className="px-3 py-2 text-right">TDS</th>
                <th className="px-3 py-2 text-right">Net</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {rows.map((r) => {
                const s = sheetBy.get(r.id);
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2">
                      <RowCheckbox checked={selection.isSelected(r.id)} onChange={() => selection.toggle(r.id)} label={`Select ${r.fullName}`} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold">{r.fullName}</div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {r.empCode}
                        {r.status !== "active" ? " · inactive" : ""}
                      </div>
                      {[...r.problems.errors, ...r.problems.warnings].map((w) => (
                        <div key={w} className="text-[11px] text-[var(--warning)]">
                          {w}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2">
                      {r.basis && r.ratePaise ? `${inr(r.ratePaise)} / ${BASIS_SHORT[r.basis]}` : "—"}
                      {r.tds194j ? <div className="text-[11px] text-[var(--muted)]">TDS 194J</div> : null}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.hasBank ? "Bank" : r.hasUpi ? "UPI" : r.mobile ? "Pay link / cash" : "Cash only"}</td>
                    <td className="px-3 py-2">
                      {s ? (
                        <button type="button" className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[s.status]}`} onClick={() => setOpenId(s.id)}>
                          {s.status}
                        </button>
                      ) : (
                        <span className="text-[11px] text-[var(--muted)]">not built</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s ? inr(s.grossPaise) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s ? inr(s.tdsPaise) : "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{s ? inr(s.netPaise) : "—"}</td>
                    <td className="px-3 py-2">
                      <RowActionMenu row={r} actions={rowActions} />
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
          </div>
        </ErpTableShell>
      ) : null}

      <BulkActionBar
        selection={selection}
        noun="person"
        actions={[{ id: "build", label: "Build / refresh sheets", icon: <RefreshCw />, onRun: (ids) => build(ids) }]}
      />

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm font-semibold text-[var(--brand-deep)]">Visiting pay report</p>
        <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
          <label>
            From
            <input type="month" className={`${field} !w-auto`} value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="month" className={`${field} !w-auto`} value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
          </label>
          <button type="button" className={btnOutline} disabled={busy === "report"} onClick={() => void loadReport()}>
            {busy === "report" ? "Loading…" : "Show"}
          </button>
          {report ? (
            <ExportMenu
              title={`Visiting pay ${reportFrom} to ${reportTo}`}
              fileBaseName={`visiting-pay-${reportFrom}-${reportTo}`}
              columns={[
                { key: "month", header: "Month" },
                { key: "name", header: "Person", width: 2 },
                { key: "gross", header: "Gross ₹", align: "right" },
                { key: "tds", header: "TDS ₹", align: "right" },
                { key: "net", header: "Net ₹", align: "right" },
                { key: "status", header: "Status" },
                { key: "paid", header: "Paid by / ref" },
              ]}
              rows={() =>
                report.map((s) => ({
                  month: s.month,
                  name: s.staffName,
                  gross: s.grossPaise / 100,
                  tds: s.tdsPaise / 100,
                  net: s.netPaise / 100,
                  status: s.status,
                  paid: s.status === "paid" ? `${s.payMode} ${s.paidRef} ${s.ledgerVoucherNo}`.trim() : "",
                }))
              }
            />
          ) : null}
        </div>
        {report ? (
          report.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--muted)]">No sheets in that range.</p>
          ) : (
            <ErpTableShell className="mt-2" density="compact">
            <div className="overflow-x-auto">
              <ErpTable minWidth="min-w-[640px]" className="text-xs">
                <ErpTableHead>
                  <tr>
                    <th className="py-1">Month</th>
                    <th>Person</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">TDS</th>
                    <th className="text-right">Net</th>
                    <th>Status</th>
                    <th className="w-10" />
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {report.map((s) => (
                    <tr key={s.id} className="border-t border-[var(--border)]">
                      <td className="py-1">{s.month}</td>
                      <td>{s.staffName}</td>
                      <td className="text-right tabular-nums">{inr(s.grossPaise)}</td>
                      <td className="text-right tabular-nums">{inr(s.tdsPaise)}</td>
                      <td className="text-right tabular-nums">{inr(s.netPaise)}</td>
                      <td>{s.status}</td>
                      <td>
                        <RowActionMenu row={s} actions={[{ id: "open", label: "Open sheet", icon: <FileText />, onSelect: (x) => setOpenId(x.id) }]} />
                      </td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable>
            </div>
            </ErpTableShell>
          )
        ) : null}
      </div>

      {openId ? (
        <SheetDrawer
          id={openId}
          banks={banks}
          staff={staff ?? []}
          onClose={() => setOpenId("")}
          onChanged={() => {
            void load();
            if (report) void loadReport();
          }}
        />
      ) : null}
    </div>
  );
}

function SheetDrawer({
  id,
  banks,
  staff,
  onClose,
  onChanged,
}: {
  id: string;
  banks: { code: string; name: string; bankAccountId: string }[];
  staff: StaffRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [payout, setPayout] = useState<Payout>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [addNote, setAddNote] = useState("");
  const [addReason, setAddReason] = useState("");
  const [payMode, setPayMode] = useState<"cashfree" | "cash" | "bank">("cashfree");
  const [payDate, setPayDate] = useState(istToday());
  const [payRef, setPayRef] = useState("");
  const [payBank, setPayBank] = useState("");
  const [payChannel, setPayChannel] = useState<"" | "transfer" | "link">("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await fetch(`/api/staff/visiting-pay?id=${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store" });
      const j = (await r.json()) as { ok: boolean; error?: string; sheet?: Sheet; lines?: Line[]; audit?: Audit[]; payout?: Payout };
      if (!j.ok || !j.sheet) {
        setError(j.error || "Could not load the sheet");
        return;
      }
      setSheet(j.sheet);
      setLines(j.lines ?? []);
      setAudit(j.audit ?? []);
      setPayout(j.payout ?? null);
    } catch {
      setError("Could not reach the server");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setPayBank((b) => b || banks[0]?.code || "");
  }, [banks]);

  async function act(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    const r = await post({ ...body, sheetId: id });
    setBusy(false);
    setMsg(r.ok ? { text: r.message || "Saved", bad: false } : { text: r.error || "Failed", bad: true });
    await load();
    onChanged();
  }

  function askReason(what: string): string | null {
    const r = window.prompt(`${what}\n\nReason (kept with the sheet):`);
    if (r === null) return null;
    if (r.trim().length < 4) {
      setMsg({ text: "Give a reason of a few words", bad: true });
      return null;
    }
    return r.trim();
  }

  const person = staff.find((s) => s.id === sheet?.staffId);
  const editable = sheet?.status === "draft";
  const unit = sheet ? BASIS_SHORT[sheet.basis] : "day";
  const flagged = lines.filter((l) => l.status === "flagged").length;
  const unconfirmed = lines.filter((l) => l.status === "unconfirmed").length;

  const lineActions: RowAction<Line>[] = [
    {
      id: "confirm",
      label: "Confirm (pay this)",
      hidden: (l) => !editable || l.status !== "unconfirmed",
      onSelect: (l) => {
        const reason = askReason(`Confirm ${l.date}: ${l.note}`);
        if (reason) void act({ action: "adjust", lineId: l.id, qty: 1, reason });
      },
    },
    {
      id: "change",
      label: "Change quantity",
      hidden: () => !editable,
      onSelect: (l) => {
        const q = window.prompt(`${l.date}: ${l.note}\n\nHow many ${l.unit}s?`, String(l.qty || 1));
        if (q === null) return;
        const reason = askReason(`Change ${l.date} to ${q} ${l.unit}(s)`);
        if (reason) void act({ action: "adjust", lineId: l.id, qty: Number(q), reason });
      },
    },
    {
      id: "remove",
      label: "Remove from the sheet",
      tone: "danger",
      separatorAbove: true,
      hidden: (l) => !editable || l.status === "removed",
      onSelect: (l) => {
        const reason = askReason(`Remove ${l.date}: ${l.note}`);
        if (reason) void act({ action: "remove", lineId: l.id, reason });
      },
    },
  ];

  async function pdf() {
    if (!sheet) return;
    const { downloadVisitingSheetPdf } = await import("@/lib/visitingPayPdf");
    await downloadVisitingSheetPdf({
      staffName: sheet.staffName,
      empCode: person?.empCode ?? "",
      panNo: person?.panNo ?? "",
      month: sheet.month,
      basis: sheet.basis,
      ratePaise: sheet.ratePaise,
      status: sheet.status,
      grossPaise: sheet.grossPaise,
      tdsPaise: sheet.tdsPaise,
      netPaise: sheet.netPaise,
      tdsDetail: sheet.tdsDetail,
      approvedBy: sheet.approvedBy,
      paidRef: sheet.paidRef,
      payMode: sheet.payMode,
      voucherNo: sheet.ledgerVoucherNo,
      lines,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="h-full w-full max-w-4xl overflow-y-auto bg-[var(--background)] p-4 shadow-[var(--shadow-2)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-lg font-bold text-[var(--brand-deep)]">{sheet ? `${sheet.staffName} — ${sheet.month}` : "Work sheet"}</p>
            {sheet ? (
              <p className="text-xs text-[var(--muted)]">
                {inr(sheet.ratePaise)} per {unit} · {sheetStatusSentence(sheet.status)}
                {sheet.approvedBy ? ` · approved by ${sheet.approvedBy}` : ""}
                {sheet.builtBy ? ` · built by ${sheet.builtBy}` : ""}
              </p>
            ) : null}
          </div>
          <button type="button" className={btnOutline} onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
        {msg ? <p className={`mt-3 text-sm ${msg.bad ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>{msg.text}</p> : null}

        {sheet ? (
          <>
            {sheet.lastError ? <p className="mt-3 rounded-xl border border-[var(--danger)] p-2 text-xs text-[var(--danger)]">{sheet.lastError}</p> : null}
            {sheet.warnings.length ? (
              <ul className="mt-3 space-y-0.5 text-xs text-[var(--warning)]">
                {sheet.warnings.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                <div className="text-[11px] text-[var(--muted)]">Gross</div>
                <div className="text-xl font-bold tabular-nums">{inr(sheet.grossPaise)}</div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                <div className="text-[11px] text-[var(--muted)]">TDS 194J</div>
                <div className="text-xl font-bold tabular-nums">{inr(sheet.tdsPaise)}</div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                <div className="text-[11px] text-[var(--muted)]">Net to pay</div>
                <div className="text-xl font-bold tabular-nums">{inr(sheet.netPaise)}</div>
              </div>
            </div>
            {sheet.tdsDetail ? (
              <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--muted)]">
                {sheet.tdsDetail.explanation.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {editable ? (
                <>
                  <button type="button" className={btnOutline} disabled={busy} onClick={() => void act({ action: "build", staffId: sheet.staffId, month: sheet.month })}>
                    Refresh from register / timetable
                  </button>
                  <button type="button" className={btnOutline} disabled={busy} onClick={() => setShowAdd((v) => !v)}>
                    Add a line
                  </button>
                  <button
                    type="button"
                    className={btn}
                    disabled={busy || flagged > 0}
                    title={flagged ? "Fix or remove the flagged lines first" : "Someone other than the maker approves"}
                    onClick={() => void act({ action: "approve" }, `Approve ${sheet.staffName}'s ${sheet.month} sheet for ${inr(sheet.netPaise)} net? It locks.`)}
                  >
                    Approve
                  </button>
                </>
              ) : null}
              {sheet.status === "approved" ? (
                <button
                  type="button"
                  className={btnOutline}
                  disabled={busy}
                  onClick={() => {
                    const reason = askReason("Reopen this approved sheet");
                    if (reason) void act({ action: "reopen", reason });
                  }}
                >
                  Reopen
                </button>
              ) : null}
              <button type="button" className={btnOutline} onClick={() => void pdf()}>
                <FileText className="size-4" /> Fee statement PDF
              </button>
            </div>
            {editable && (flagged || unconfirmed) ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                {flagged ? `${flagged} flagged (fix the register and refresh, or change / remove with a reason). ` : ""}
                {unconfirmed ? `${unconfirmed} not confirmed — not paid unless you confirm them with a reason.` : ""}
              </p>
            ) : null}

            {showAdd && editable ? (
              <div className="mt-3 grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-xs sm:grid-cols-5">
                <label>
                  Date
                  <input type="date" className={field} value={addDate} min={`${sheet.month}-01`} max={istToday()} onChange={(e) => setAddDate(e.target.value)} />
                </label>
                <label>
                  {unit === "hour" ? "Hours" : unit === "period" ? "Periods" : "Days"}
                  <input className={field} value={addQty} inputMode="decimal" onChange={(e) => setAddQty(e.target.value)} />
                </label>
                <label className="sm:col-span-1">
                  What
                  <input className={field} value={addNote} placeholder="e.g. Annual day rehearsal" onChange={(e) => setAddNote(e.target.value)} />
                </label>
                <label className="sm:col-span-1">
                  Reason
                  <input className={field} value={addReason} placeholder="why it is not on the register" onChange={(e) => setAddReason(e.target.value)} />
                </label>
                <button
                  type="button"
                  className={`${btn} self-end`}
                  disabled={busy}
                  onClick={() =>
                    void act({ action: "add", date: addDate, qty: Number(addQty), note: addNote, reason: addReason }).then(() => {
                      setAddNote("");
                      setAddReason("");
                    })
                  }
                >
                  Add
                </button>
              </div>
            ) : null}

            <ErpTableShell className="mt-3" density="compact">
            <div className="overflow-x-auto">
              <ErpTable minWidth="min-w-[640px]" className="text-xs">
                <ErpTableHead>
                  <tr>
                    <th className="px-2 py-1.5">Date</th>
                    <th className="px-2">Work</th>
                    <th className="px-2">From</th>
                    <th className="px-2 text-right">Qty</th>
                    <th className="px-2 text-right">Amount</th>
                    <th className="px-2">State</th>
                    <th className="w-10" />
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-2 py-3 text-center text-[var(--muted)]">
                        No work found for this month.
                      </td>
                    </tr>
                  ) : null}
                  {lines.map((l) => (
                    <tr key={l.id} className={`border-t border-[var(--border)] ${LINE_TONE[l.status]}`}>
                      <td className="px-2 py-1.5 whitespace-nowrap">{l.date}</td>
                      <td className="px-2">
                        {l.note}
                        {l.adjustedAt ? (
                          <div className="text-[10px] text-[var(--muted)]">
                            {l.adjustedBy}: {l.adjustReason}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2">{l.source}</td>
                      <td className="px-2 text-right tabular-nums">{l.status === "counted" ? `${l.qty} ${l.unit}` : "—"}</td>
                      <td className="px-2 text-right tabular-nums">{l.status === "counted" ? inr(l.amountPaise) : "—"}</td>
                      <td className="px-2">{LINE_LABEL[l.status]}</td>
                      <td>
                        <RowActionMenu row={l} actions={lineActions} />
                      </td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable>
            </div>
            </ErpTableShell>

            {sheet.status === "approved" ? (
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-xs">
                <p className="text-sm font-semibold text-[var(--brand-deep)]">Pay {inr(sheet.netPaise)}</p>
                {sheet.paymentKey ? (
                  <p className="mt-1 text-[var(--warning)]">
                    Held by a {sheet.paymentKey.split(":")[0]} payment in progress — only that payment can finish this sheet
                    {sheet.paymentKey.startsWith("cashfree:") ? " (cancel it from Payments to pay another way)" : " (record it again the same way to finish)"}.
                  </p>
                ) : null}
                {payout ? (
                  <p className="mt-1">
                    Cashfree: {requestStatusSentence(payout.status, payout.channel)}
                    {payout.lastError ? <span className="text-[var(--danger)]"> — {payout.lastError}</span> : null}{" "}
                    <button type="button" className="underline" disabled={busy} onClick={() => void act({ action: "refresh_payout" })}>
                      Check status
                    </button>
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label>
                    How
                    <select className={field} value={payMode} onChange={(e) => setPayMode(e.target.value as typeof payMode)}>
                      <option value="cashfree">Cashfree (bank / UPI / pay link)</option>
                      <option value="cash">Cash from the cash box</option>
                      <option value="bank">Bank transfer made by hand</option>
                    </select>
                  </label>
                  {payMode === "cashfree" ? (
                    <label>
                      Send as
                      <select className={field} value={payChannel} onChange={(e) => setPayChannel(e.target.value as typeof payChannel)}>
                        <option value="">Best available (bank, UPI, else link)</option>
                        <option value="transfer">Bank / UPI transfer</option>
                        <option value="link">Pay link to their phone</option>
                      </select>
                    </label>
                  ) : (
                    <>
                      <label>
                        Paid on
                        <input type="date" className={field} value={payDate} max={istToday()} onChange={(e) => setPayDate(e.target.value)} />
                      </label>
                      {payMode === "bank" ? (
                        <label>
                          From bank
                          <select className={field} value={payBank} onChange={(e) => setPayBank(e.target.value)}>
                            {banks.map((b) => (
                              <option key={b.code} value={b.code}>
                                {b.code} · {b.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label>
                        {payMode === "bank" ? "UTR / reference" : "Receipt / note"}
                        <input className={field} value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                      </label>
                    </>
                  )}
                  <button
                    type="button"
                    className={btn}
                    disabled={busy}
                    onClick={() =>
                      payMode === "cashfree"
                        ? void act(
                            { action: "pay_cashfree", channel: payChannel },
                            `Pay ${inr(sheet.netPaise)} to ${sheet.staffName} from the Cashfree wallet? It is booked when Cashfree confirms.`,
                          )
                        : void act(
                            { action: "pay_hand", mode: payMode, date: payDate, ref: payRef, bankLedgerCode: payBank },
                            `Record ${inr(sheet.netPaise)} paid to ${sheet.staffName} ${payMode === "cash" ? "in cash from the cash box" : "by bank transfer"} on ${payDate}? It posts to the books.`,
                          )
                    }
                  >
                    {payMode === "cashfree" ? "Send payment" : "Record payment"}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-[var(--muted)]">
                  Books: Dr 5075 Visiting faculty fees {inr(sheet.grossPaise)}
                  {sheet.tdsPaise ? ` / Cr 2310 TDS Payable ${inr(sheet.tdsPaise)}` : ""} / Cr{" "}
                  {payMode === "cashfree" ? "1110 Cashfree wallet" : payMode === "cash" ? "1000 Cash in hand" : "the bank"} {inr(sheet.netPaise)}.
                </p>
              </div>
            ) : null}
            {sheet.status === "paid" ? (
              <p className="mt-4 text-sm text-[var(--success)]">
                Paid {sheet.payMode}
                {sheet.paidRef ? ` · ${sheet.paidRef}` : ""} · voucher {sheet.ledgerVoucherNo} · by {sheet.paidBy}
              </p>
            ) : null}

            {audit.length ? (
              <details className="mt-4 text-xs">
                <summary className="cursor-pointer font-semibold">History ({audit.length})</summary>
                <ul className="mt-2 space-y-1">
                  {audit.map((a) => (
                    <li key={a.id}>
                      <span className="text-[var(--muted)]">{new Date(a.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span> · {a.by} ·{" "}
                      {a.action.replace(/_/g, " ")}
                      {a.reason ? ` — ${a.reason}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
