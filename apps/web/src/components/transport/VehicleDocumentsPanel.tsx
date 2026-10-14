"use client";

/**
 * Vehicle papers — insurance, PUC, fitness, permit, road tax, CNG hydro test,
 * AIS-140, fire extinguisher — saved on the server (/api/transport/vehicle-docs).
 *
 * A renewal is a new document, so the history stays. A fee is "entered
 * once": recorded on the document, and booked to Accounts from the same row
 * (Dr the vehicle-papers head / Cr cash box or bank) by someone holding
 * Accounts · edit. Voiding a document whose fee is booked reverses the voucher.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInr } from "@/lib/fees";
import { uploadMedia } from "@/lib/mediaUpload";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";
import { VoucherDetailDialog } from "@/components/accounts/VoucherDetailDialog";
import {
  VEHICLE_DOC_LABELS,
  VEHICLE_DOC_TYPES,
  currentDocsFor,
  expiryStatus,
  istToday,
  vehicleDocAlerts,
  type ExpiryStatus,
  type VehicleDoc,
  type VehicleDocType,
} from "@/lib/transportFinance";

type VehicleRef = { id: string; label: string; isActive: boolean };

export type VehicleDocsData = {
  docs: VehicleDoc[];
  vehicles: VehicleRef[];
  expenseHead: { code: string; name: string } | null;
  banks: { code: string; name: string }[];
  canPost: boolean;
  canReverse: boolean;
};

export async function fetchVehicleDocs(): Promise<{ ok: true; data: VehicleDocsData } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch("/api/transport/vehicle-docs", { credentials: "same-origin", cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as Partial<VehicleDocsData> & { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) return { ok: false, error: body.error || `Could not load the vehicle papers (${res.status})`, status: res.status };
    return {
      ok: true,
      data: {
        docs: body.docs ?? [],
        vehicles: body.vehicles ?? [],
        expenseHead: body.expenseHead ?? null,
        banks: body.banks ?? [],
        canPost: !!body.canPost,
        canReverse: !!body.canReverse,
      },
    };
  } catch {
    return { ok: false, error: "Could not reach the server — the papers are not shown, not missing.", status: 0 };
  }
}

async function postAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; voucherNo?: string; reversalVoucherNo?: string }> {
  try {
    const res = await fetch("/api/transport/vehicle-docs", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; voucherNo?: string; reversalVoucherNo?: string };
    return out.ok && res.ok ? { ...out, ok: true } : { ok: false, error: out.error || `Refused (${res.status})` };
  } catch {
    return { ok: false, error: "Could not reach the server — nothing was saved." };
  }
}

const STATUS_CLASS: Record<ExpiryStatus, string> = {
  expired: "bg-[var(--danger-soft)] text-[var(--danger)]",
  due: "bg-[var(--warning-soft)] text-[var(--warning)]",
  ok: "bg-[var(--success-soft)] text-[var(--success)]",
  missing: "bg-[var(--surface-sunken)] text-[var(--muted)]",
};

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function statusText(status: ExpiryStatus, daysLeft: number | null): string {
  if (status === "missing") return "Not recorded";
  if (status === "expired") return `Expired ${Math.abs(daysLeft ?? 0)}d ago`;
  if (status === "due") return daysLeft === 0 ? "Expires today" : `${daysLeft}d left`;
  return "OK";
}

type Draft = {
  id?: string;
  baseUpdatedAt?: string;
  feeLocked?: boolean;
  vehicleId: string;
  type: VehicleDocType;
  number: string;
  issuedOn: string;
  expiresOn: string;
  fee: string;
  insurer: string;
  policyNo: string;
  fileUrl: string;
  fileName: string;
  note: string;
};

function blankDraft(vehicleId = "", type: VehicleDocType = "puc"): Draft {
  return { vehicleId, type, number: "", issuedOn: istToday(), expiresOn: "", fee: "", insurer: "", policyNo: "", fileUrl: "", fileName: "", note: "" };
}

export function VehicleDocumentsPanel({ canEdit, onFlash }: { canEdit: boolean; onFlash: (m: string) => void }) {
  const [data, setData] = useState<VehicleDocsData | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [feeFor, setFeeFor] = useState<VehicleDoc | null>(null);
  const [voidFor, setVoidFor] = useState<VehicleDoc | null>(null);
  const [filterVehicle, setFilterVehicle] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [openVoucher, setOpenVoucher] = useState<string | null>(null);
  const today = istToday();

  const load = useCallback(async () => {
    const r = await fetchVehicleDocs();
    if (r.ok) {
      setData(r.data);
      setLoadErr("");
    } else setLoadErr(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const vehicles = useMemo(
    () => (data?.vehicles ?? []).slice().sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.label.localeCompare(b.label)),
    [data],
  );
  const vehicleLabel = (id: string) => vehicles.find((v) => v.id === id)?.label || id;
  const alerts = useMemo(() => (data ? vehicleDocAlerts(data.docs, vehicles.filter((v) => v.isActive), today) : []), [data, vehicles, today]);
  const history = useMemo(
    () =>
      (data?.docs ?? [])
        .filter((d) => (!filterVehicle || d.vehicleId === filterVehicle) && (showVoid || d.status === "active"))
        .sort((a, b) => b.expiresOn.localeCompare(a.expiresOn) || b.createdAt.localeCompare(a.createdAt)),
    [data, filterVehicle, showVoid],
  );

  if (loadErr && !data) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
        {loadErr}{" "}
        <button type="button" className="font-semibold text-[var(--brand-mid)]" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-[var(--muted)]">Reading the vehicle papers…</p>;

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">Vehicle papers</h2>
          <p className="text-[11px] text-[var(--muted)]">
            Insurance, PUC, fitness, permit, road tax, CNG hydro test, AIS-140 and fire extinguisher — saved on the server. Red = expired, amber = 30 days or less.
          </p>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-bold text-[var(--primary-foreground)]"
            onClick={() => setDraft(blankDraft(vehicles.find((v) => v.isActive)?.id ?? ""))}
          >
            Add a paper
          </button>
        ) : null}
      </div>

      {alerts.length > 0 ? (
        <div className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          <b>{alerts.filter((a) => a.status === "expired").length} expired</b>, {alerts.filter((a) => a.status === "due").length} due within 30 days:{" "}
          {alerts
            .slice(0, 8)
            .map((a) => `${a.vehicleLabel} ${VEHICLE_DOC_LABELS[a.type]} (${fmtDate(a.expiresOn)})`)
            .join(" · ")}
          {alerts.length > 8 ? ` · +${alerts.length - 8} more` : ""}
        </div>
      ) : null}

      {/* Status grid: one row per vehicle, one column per paper. */}
      <ErpTableShell density="compact">
        <div className="overflow-x-auto">
          <ErpTable minWidth="min-w-[980px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2">Vehicle</th>
                {VEHICLE_DOC_TYPES.map((t) => (
                  <th key={t} className="px-2 py-2">
                    {VEHICLE_DOC_LABELS[t]}
                  </th>
                ))}
                <th className="px-2 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {vehicles.length === 0 ? (
                <tr>
                  <td colSpan={VEHICLE_DOC_TYPES.length + 2} className="px-3 py-3 text-sm text-[var(--muted)]">
                    No vehicles in the fleet yet.
                  </td>
                </tr>
              ) : (
                vehicles.map((v) => {
                  const cur = currentDocsFor(data.docs, v.id);
                  return (
                    <tr key={v.id} className={v.isActive ? "" : "opacity-60"}>
                      <td className="px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]">
                        {v.label}
                        {v.isActive ? "" : " (inactive)"}
                      </td>
                      {VEHICLE_DOC_TYPES.map((t) => {
                        const d = cur[t];
                        const s = d ? expiryStatus(d.expiresOn, today) : { status: "missing" as const, daysLeft: null };
                        return (
                          <td key={t} className="px-2 py-2">
                            <button
                              type="button"
                              disabled={!canEdit}
                              title={d ? `${VEHICLE_DOC_LABELS[t]} valid to ${fmtDate(d.expiresOn)} — click to record the renewal` : `Record ${VEHICLE_DOC_LABELS[t]}`}
                              onClick={() => setDraft(blankDraft(v.id, t))}
                              className={`w-full rounded-md px-1.5 py-1 text-left text-[10px] font-bold ${STATUS_CLASS[s.status]} disabled:cursor-default`}
                            >
                              {d ? fmtDate(d.expiresOn) : "—"}
                              <div className="font-semibold">{statusText(s.status, s.daysLeft)}</div>
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right">
                        <RowActionMenu
                          row={v}
                          actions={[
                            { id: "add", label: "Add a paper", hidden: () => !canEdit, onSelect: (r) => setDraft(blankDraft(r.id)) },
                            { id: "history", label: "Show its history", onSelect: (r) => setFilterVehicle(r.id) },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </ErpTableBody>
          </ErpTable>
        </div>
      </ErpTableShell>

      {draft ? (
        <DocForm
          draft={draft}
          vehicles={vehicles}
          onCancel={() => setDraft(null)}
          onSaved={(msg) => {
            setDraft(null);
            onFlash(msg);
            void load();
          }}
        />
      ) : null}
      {feeFor ? (
        <FeeForm
          doc={feeFor}
          vehicleLabel={vehicleLabel(feeFor.vehicleId)}
          data={data}
          onCancel={() => setFeeFor(null)}
          onDone={(msg) => {
            setFeeFor(null);
            onFlash(msg);
            void load();
          }}
        />
      ) : null}
      {voidFor ? (
        <VoidForm
          doc={voidFor}
          onCancel={() => setVoidFor(null)}
          onDone={(msg) => {
            setVoidFor(null);
            onFlash(msg);
            void load();
          }}
        />
      ) : null}

      {/* Every paper, newest expiry first. */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <h3 className="text-xs font-bold uppercase text-[var(--muted)]">All papers</h3>
        <select className="field !w-auto !py-1 text-xs" value={filterVehicle} onChange={(e) => setFilterVehicle(e.target.value)}>
          <option value="">Every vehicle</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} /> Show voided
        </label>
        {data.canPost ? (
          <span className="text-[11px] text-[var(--muted)]">
            Fees book to {data.expenseHead ? `${data.expenseHead.code} ${data.expenseHead.name}` : "— no vehicle insurance / permits head in the chart; fees are recorded, not booked"}
          </span>
        ) : null}
      </div>
      <ErpTableShell density="compact" exportAs="vehicle_papers" exportTitle="Vehicle papers">
        <div className="overflow-x-auto">
          <ErpTable minWidth="min-w-[980px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Paper</th>
                <th className="px-3 py-2">Number / policy</th>
                <th className="px-3 py-2">Issued</th>
                <th className="px-3 py-2">Expires</th>
                <th className="px-3 py-2 text-right">Fee</th>
                <th className="px-3 py-2">In the books</th>
                <th className="px-3 py-2">File</th>
                <th className="px-2 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-3 text-sm text-[var(--muted)]">
                    No papers recorded yet.
                  </td>
                </tr>
              ) : (
                history.map((d) => {
                  const s = expiryStatus(d.expiresOn, today);
                  return (
                    <tr key={d.id} className={d.status === "void" ? "opacity-50 line-through" : ""}>
                      <td className="px-3 py-2 text-xs">{vehicleLabel(d.vehicleId)}</td>
                      <td className="px-3 py-2 text-xs font-semibold">{VEHICLE_DOC_LABELS[d.type]}</td>
                      <td className="px-3 py-2 text-xs">
                        {d.number || "—"}
                        {d.type === "insurance" && (d.insurer || d.policyNo) ? (
                          <div className="text-[10px] text-[var(--muted)]">
                            {d.insurer}
                            {d.policyNo ? ` · ${d.policyNo}` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs">{fmtDate(d.issuedOn)}</td>
                      <td className="px-3 py-2 text-xs">
                        {fmtDate(d.expiresOn)}
                        {d.status === "active" ? (
                          <span className={`ml-1 rounded px-1 text-[10px] font-bold ${STATUS_CLASS[s.status]}`}>{statusText(s.status, s.daysLeft)}</span>
                        ) : (
                          <div className="text-[10px] text-[var(--muted)]">Void: {d.voidReason}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">{d.feePaise > 0 ? formatInr(d.feePaise) : "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {d.fee ? (
                          <>
                            <button type="button" className="font-semibold text-[var(--brand-mid)] hover:underline" onClick={() => setOpenVoucher(d.fee!.voucherNo)}>
                              {d.fee.voucherNo}
                            </button>
                            <div className="text-[10px] text-[var(--muted)]">
                              {d.fee.mode === "cash" ? "Cash box" : `Bank ${d.fee.bankCode}`} · {fmtDate(d.fee.paidOn)}
                              {d.fee.reversalVoucherNo ? ` · reversed ${d.fee.reversalVoucherNo}` : ""}
                            </div>
                          </>
                        ) : d.feePaise > 0 ? (
                          <span className="text-[var(--warning)]">Not booked</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {d.fileUrl ? (
                          <a href={d.fileUrl} target="_blank" rel="noreferrer" className="font-semibold text-[var(--brand-mid)]">
                            {d.fileName || "Open"}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <RowActionMenu
                          row={d}
                          actions={[
                            {
                              id: "edit",
                              label: "Edit",
                              hidden: (r) => !canEdit || r.status === "void",
                              onSelect: (r) =>
                                setDraft({
                                  id: r.id,
                                  baseUpdatedAt: r.updatedAt,
                                  feeLocked: !!r.fee,
                                  vehicleId: r.vehicleId,
                                  type: r.type,
                                  number: r.number,
                                  issuedOn: r.issuedOn,
                                  expiresOn: r.expiresOn,
                                  fee: r.feePaise ? String(r.feePaise / 100) : "",
                                  insurer: r.insurer,
                                  policyNo: r.policyNo,
                                  fileUrl: r.fileUrl,
                                  fileName: r.fileName,
                                  note: r.note,
                                }),
                            },
                            {
                              id: "renew",
                              label: "Record the renewal",
                              hidden: (r) => !canEdit || r.status === "void",
                              onSelect: (r) => setDraft({ ...blankDraft(r.vehicleId, r.type), insurer: r.insurer }),
                            },
                            {
                              id: "fee",
                              label: "Book the fee in Accounts",
                              hidden: (r) => !data.canPost || !canEdit || r.status === "void" || !!r.fee || !(r.feePaise > 0) || !data.expenseHead,
                              onSelect: (r) => setFeeFor(r),
                            },
                            {
                              id: "voucher",
                              label: "Open the fee voucher",
                              hidden: (r) => !r.fee,
                              onSelect: (r) => setOpenVoucher(r.fee!.voucherNo),
                            },
                            {
                              id: "void",
                              label: "Void",
                              tone: "danger",
                              separatorAbove: true,
                              hidden: (r) => !canEdit || r.status === "void" || (!!r.fee && !r.fee.reversalVoucherNo && !data.canReverse),
                              onSelect: (r) => setVoidFor(r),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </ErpTableBody>
          </ErpTable>
        </div>
      </ErpTableShell>
      {openVoucher ? <VoucherDetailDialog target={{ voucherNo: openVoucher }} onClose={() => setOpenVoucher(null)} /> : null}
    </div>
  );
}

function DocForm({
  draft: initial,
  vehicles,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  vehicles: VehicleRef[];
  onCancel: () => void;
  onSaved: (msg: string) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setD(initial), [initial]);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!d.vehicleId) {
      setErr("Choose the vehicle first");
      return;
    }
    setUploading(true);
    setErr("");
    const r = await uploadMedia({ file, visibility: "private", pathPrefix: `transport/vehicle-papers/${d.vehicleId}`, verbatim: file.type === "application/pdf" });
    setUploading(false);
    if (r.ok) set({ fileUrl: r.url, fileName: file.name.slice(0, 160) });
    else setErr(`Not uploaded: ${r.error}`);
  }

  async function save() {
    const feeRupees = d.fee.trim() ? Number(d.fee.replace(/,/g, "")) : 0;
    if (!Number.isFinite(feeRupees) || feeRupees < 0) {
      setErr("The fee must be an amount in rupees");
      return;
    }
    setBusy(true);
    setErr("");
    const r = await postAction({
      action: "save",
      id: d.id,
      baseUpdatedAt: d.baseUpdatedAt,
      doc: {
        vehicleId: d.vehicleId,
        type: d.type,
        number: d.number,
        issuedOn: d.issuedOn,
        expiresOn: d.expiresOn,
        feePaise: Math.round(feeRupees * 100),
        insurer: d.insurer,
        policyNo: d.policyNo,
        fileUrl: d.fileUrl,
        fileName: d.fileName,
        note: d.note,
      },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error || "Not saved");
      return;
    }
    onSaved(`${VEHICLE_DOC_LABELS[d.type]} saved`);
  }

  const label = "text-[11px] font-semibold text-[var(--muted)]";
  return (
    <div className="rounded-xl border border-[var(--brand-mid)] bg-[var(--surface-sunken)] p-3">
      <div className="text-sm font-bold text-[var(--brand-deep)]">{d.id ? "Edit paper" : "Record a paper / renewal"}</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className={label}>
          Vehicle
          <select className="field mt-1 !py-1.5" value={d.vehicleId} disabled={d.feeLocked} onChange={(e) => set({ vehicleId: e.target.value })}>
            <option value="">Choose…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Paper
          <select className="field mt-1 !py-1.5" value={d.type} onChange={(e) => set({ type: e.target.value as VehicleDocType })}>
            {VEHICLE_DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {VEHICLE_DOC_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Certificate / receipt no.
          <input className="field mt-1 !py-1.5" value={d.number} onChange={(e) => set({ number: e.target.value })} />
        </label>
        <label className={label}>
          Fee ₹{d.feeLocked ? " (in the books)" : ""}
          <input className="field mt-1 !py-1.5" inputMode="decimal" value={d.fee} disabled={d.feeLocked} onChange={(e) => set({ fee: e.target.value })} />
        </label>
        <label className={label}>
          Issued on
          <input className="field mt-1 !py-1.5" type="date" value={d.issuedOn} onChange={(e) => set({ issuedOn: e.target.value })} />
        </label>
        <label className={label}>
          Valid until
          <input className="field mt-1 !py-1.5" type="date" value={d.expiresOn} onChange={(e) => set({ expiresOn: e.target.value })} />
        </label>
        {d.type === "insurance" ? (
          <>
            <label className={label}>
              Insurer
              <input className="field mt-1 !py-1.5" value={d.insurer} onChange={(e) => set({ insurer: e.target.value })} />
            </label>
            <label className={label}>
              Policy no.
              <input className="field mt-1 !py-1.5" value={d.policyNo} onChange={(e) => set({ policyNo: e.target.value })} />
            </label>
          </>
        ) : null}
        <label className={`${label} sm:col-span-2`}>
          Document (photo or PDF)
          <input
            className="field mt-1 !py-1"
            type="file"
            accept="image/*,application/pdf"
            disabled={uploading}
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          {uploading ? <span className="text-[10px]">Uploading…</span> : null}
          {d.fileUrl ? (
            <span className="text-[10px]">
              Attached: {d.fileName || "file"}{" "}
              <button type="button" className="text-[var(--danger)]" onClick={() => set({ fileUrl: "", fileName: "" })}>
                remove
              </button>
            </span>
          ) : null}
        </label>
        <label className={`${label} sm:col-span-2`}>
          Note
          <input className="field mt-1 !py-1.5" value={d.note} onChange={(e) => set({ note: e.target.value })} />
        </label>
      </div>
      {err ? <p className="mt-2 text-xs font-semibold text-[var(--danger)]">{err}</p> : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy || uploading}
          onClick={() => void save()}
          className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-bold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold">
          Cancel
        </button>
      </div>
    </div>
  );
}

function FeeForm({
  doc,
  vehicleLabel,
  data,
  onCancel,
  onDone,
}: {
  doc: VehicleDoc;
  vehicleLabel: string;
  data: VehicleDocsData;
  onCancel: () => void;
  onDone: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"cash" | "bank">("cash");
  const [bankCode, setBankCode] = useState(data.banks[0]?.code ?? "");
  const [paidOn, setPaidOn] = useState(doc.issuedOn && doc.issuedOn <= istToday() ? doc.issuedOn : istToday());
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function book() {
    setBusy(true);
    setErr("");
    const r = await postAction({ action: "post-fee", id: doc.id, mode, bankCode: mode === "bank" ? bankCode : "", paidOn, ref });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error || "Not booked");
      return;
    }
    onDone(`Fee booked — voucher ${r.voucherNo}`);
  }

  return (
    <div className="rounded-xl border border-[var(--brand-mid)] bg-[var(--surface-sunken)] p-3 text-xs">
      <div className="text-sm font-bold text-[var(--brand-deep)]">
        Book {formatInr(doc.feePaise)} — {VEHICLE_DOC_LABELS[doc.type]}, {vehicleLabel}
      </div>
      <p className="mt-1 text-[var(--muted)]">
        Dr {data.expenseHead?.code} {data.expenseHead?.name} / Cr {mode === "cash" ? "1000 Cash in Hand (cash box)" : "the bank below"}. One voucher per paper — booking twice is not possible.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <label className="font-semibold text-[var(--muted)]">
          Paid
          <select className="field mt-1 !py-1.5" value={mode} onChange={(e) => setMode(e.target.value === "bank" ? "bank" : "cash")}>
            <option value="cash">Cash (cash box)</option>
            <option value="bank">Bank / UPI</option>
          </select>
        </label>
        {mode === "bank" ? (
          <label className="font-semibold text-[var(--muted)]">
            From bank
            <select className="field mt-1 !py-1.5" value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
              {data.banks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} · {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="font-semibold text-[var(--muted)]">
          Paid on
          <input className="field mt-1 !py-1.5" type="date" max={istToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </label>
        <label className="font-semibold text-[var(--muted)]">
          Receipt / UTR
          <input className="field mt-1 !py-1.5" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
      </div>
      {err ? <p className="mt-2 font-semibold text-[var(--danger)]">{err}</p> : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void book()}
          className="rounded-lg bg-[var(--primary)] px-3 py-1.5 font-bold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {busy ? "Booking…" : "Book the fee"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-semibold">
          Cancel
        </button>
      </div>
    </div>
  );
}

function VoidForm({ doc, onCancel, onDone }: { doc: VehicleDoc; onCancel: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true);
    setErr("");
    const r = await postAction({ action: "void", id: doc.id, reason });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error || "Not voided");
      return;
    }
    onDone(r.reversalVoucherNo ? `Voided — fee reversed (${r.reversalVoucherNo})` : "Voided");
  }
  return (
    <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-xs">
      <div className="font-bold text-[var(--danger)]">
        Void {VEHICLE_DOC_LABELS[doc.type]} {doc.number}
        {doc.fee ? ` — its fee voucher ${doc.fee.voucherNo} will be reversed` : ""}
      </div>
      <input className="field mt-2 !py-1.5" placeholder="Why (entered twice, wrong vehicle…)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {err ? <p className="mt-2 font-semibold text-[var(--danger)]">{err}</p> : null}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => void go()} className="rounded-lg bg-[var(--danger)] px-3 py-1.5 font-bold text-white disabled:opacity-50">
          {busy ? "Voiding…" : "Void"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-semibold">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The Transport dashboard's strip: expired and due-soon papers, from the server. */
export function VehicleDocsSummary({ onOpen }: { onOpen: () => void }) {
  const [state, setState] = useState<{ expired: number; due: number; list: string[]; recorded: number } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    void fetchVehicleDocs().then((r) => {
      if (!live) return;
      if (!r.ok) {
        // No transport view at all (403) — say nothing rather than alarm.
        setErr(r.status === 403 ? "" : r.error);
        return;
      }
      const vehicles = r.data.vehicles.filter((v) => v.isActive);
      const alerts = vehicleDocAlerts(r.data.docs, vehicles, istToday());
      setState({
        expired: alerts.filter((a) => a.status === "expired").length,
        due: alerts.filter((a) => a.status === "due").length,
        list: alerts.slice(0, 4).map((a) => `${a.vehicleLabel} ${VEHICLE_DOC_LABELS[a.type]}`),
        recorded: r.data.docs.filter((d) => d.status === "active").length,
      });
    });
    return () => {
      live = false;
    };
  }, []);
  if (err) return <p className="mt-4 text-xs text-[var(--muted)]">Vehicle papers: {err}</p>;
  if (!state) return null;
  const bad = state.expired + state.due > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`mt-4 flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2 text-left text-xs ${
        state.expired > 0
          ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
          : bad
            ? "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]"
            : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"
      }`}
    >
      <span className="font-bold">
        Vehicle papers:{" "}
        {state.recorded === 0
          ? "none recorded yet — record insurance, PUC, fitness, permit…"
          : bad
            ? `${state.expired} expired · ${state.due} due within 30 days`
            : "all in date"}
      </span>
      <span>{state.list.join(" · ")}</span>
    </button>
  );
}
