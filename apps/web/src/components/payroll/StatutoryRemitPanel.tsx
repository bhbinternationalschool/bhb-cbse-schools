"use client";

import { useEffect, useMemo, useState } from "react";
import { downloadTextFile, formatInr } from "@/lib/payroll";
import {
  loadStatutoryRemit,
  markEpfChallanPaid,
  markEpfReturnFiled,
  markEsicChallanPaid,
  remitStatusLabel,
  statutoryRemitCsv,
  type StatutoryRemitBatch,
} from "@/lib/statutoryRemit";
import {
  computeEstimatedPenalty,
  statutoryDueDate,
} from "@/lib/statutoryCompliance";
import { loadMasters } from "@/lib/masters";
import { normalizeStatutoryConfig } from "@/lib/foundationMasters";
import { useDemoSession } from "@/components/shell/SessionContext";

const RECEIPT_ACCEPT = "application/pdf,image/jpeg,image/png";
const RECEIPT_MAX_BYTES = 15 * 1024 * 1024;

type BatchDraft = {
  returnFileId: string;
  totalMembers: string;
  epfChallanRefNo: string;
  esicChallanRefNo: string;
};

function emptyDraft(b: StatutoryRemitBatch): BatchDraft {
  return {
    returnFileId: b.returnFileId,
    totalMembers: String(b.totalMembers || b.lines.length),
    epfChallanRefNo: b.epf.challanRefNo,
    esicChallanRefNo: b.esic.challanRefNo,
  };
}

export function StatutoryRemitPanel() {
  const session = useDemoSession();
  const [batches, setBatches] = useState<StatutoryRemitBatch[]>([]);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, BatchDraft>>({});
  const [uploading, setUploading] = useState<string | null>(null);

  const config = useMemo(
    () => normalizeStatutoryConfig(loadMasters().statutoryConfig),
    [tick],
  );

  useEffect(() => {
    const loaded = loadStatutoryRemit().batches;
    setBatches(loaded);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const b of loaded) {
        if (!next[b.id]) next[b.id] = emptyDraft(b);
      }
      return next;
    });
  }, [tick]);

  function flash(msg: string, isErr = false) {
    if (isErr) {
      setError(msg);
      setNotice(null);
    } else {
      setNotice(msg);
      setError(null);
    }
    window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 3200);
  }

  function patchDraft(batchId: string, patch: Partial<BatchDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [batchId]: { ...(prev[batchId] || emptyDraft(batches.find((b) => b.id === batchId)!)), ...patch },
    }));
  }

  async function uploadReceipt(file: File): Promise<string | null> {
    const okType = file.type === "application/pdf" || file.type.startsWith("image/");
    if (!okType) {
      flash("Use PDF or image (JPG/PNG) for the receipt", true);
      return null;
    }
    if (file.size > RECEIPT_MAX_BYTES) {
      flash("Receipt file must be under 15 MB", true);
      return null;
    }
    const { uploadSchoolObject } = await import("@/lib/objectStorage");
    const uploaded = await uploadSchoolObject({
      path: `statutory/receipts/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`,
      blob: file,
      contentType: file.type,
    });
    if (!uploaded.ok) {
      flash(uploaded.error, true);
      return null;
    }
    return uploaded.url;
  }

  const pending = batches.filter((b) => b.status === "pending_deposit");
  const done = batches.filter((b) => b.status === "deposited");

  function penaltyFor(batch: StatutoryRemitBatch, kind: "epf" | "esic") {
    const progress = kind === "epf" ? batch.epf : batch.esic;
    if (progress.paidAt) return null;
    const amountDue =
      kind === "epf" ? batch.totalEpfEpsContribution + batch.totalEdliContribution : batch.esicTotal;
    if (amountDue <= 0) return null;
    const penalty = computeEstimatedPenalty(
      statutoryDueDate(batch.month),
      new Date(),
      amountDue,
      kind === "epf" ? config.penalty.damageSlabs : config.penalty.esicDamageSlabs,
      kind === "epf"
        ? config.penalty.interestRatePctPerAnnum
        : config.penalty.esicInterestRatePctPerAnnum,
    );
    return penalty.daysOverdue > 0 ? penalty : null;
  }

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-4 py-3 text-sm text-[var(--muted)]">
        Staff on <strong className="text-[var(--brand-deep)]">PF</strong> /
        <strong className="text-[var(--brand-deep)]"> ESIC</strong> (Assign
        staff cover): employee share is deducted from salary and{" "}
        <strong className="text-[var(--brand-deep)]">
          deposited to Government
        </strong>{" "}
        with the employer share (EPFO / ESIC). Not paid to staff. Batches are
        created when a payroll run is posted. EPF and ESIC are filed and paid
        independently — return first, then challan.
      </p>
      {notice ? (
        <p className="text-sm font-medium text-[var(--brand-deep)]">{notice}</p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-[#b42318]">{error}</p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
          Pending govt deposit ({pending.length})
        </div>
        <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
          {pending.map((b) => {
            const draft = drafts[b.id] || emptyDraft(b);
            const epfPenalty = penaltyFor(b, "epf");
            const esicPenalty = penaltyFor(b, "esic");
            return (
              <li key={b.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-[var(--brand-deep)]">
                      {b.month} · {b.lines.length} staff
                    </div>
                    <p className="text-[11px] text-[var(--muted)]">
                      EPF+EPS {formatInr(b.totalEpfEpsContribution)} · EDLI{" "}
                      {formatInr(b.totalEdliContribution)} · ESIC{" "}
                      {formatInr(b.esicTotal)} · Total {formatInr(b.grandTotal)}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {epfPenalty ? (
                        <span className="rounded-full bg-[rgba(180,35,24,0.1)] px-2 py-0.5 text-[10px] font-semibold text-[#b42318]">
                          EPF est. penalty {formatInr(epfPenalty.estimatedTotal)} ·{" "}
                          {epfPenalty.daysOverdue}d overdue
                        </span>
                      ) : null}
                      {esicPenalty ? (
                        <span className="rounded-full bg-[rgba(180,35,24,0.1)] px-2 py-0.5 text-[10px] font-semibold text-[#b42318]">
                          ESIC est. penalty {formatInr(esicPenalty.estimatedTotal)} ·{" "}
                          {esicPenalty.daysOverdue}d overdue
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-1 text-[11px] font-semibold"
                      onClick={() => setOpenId(openId === b.id ? null : b.id)}
                    >
                      {openId === b.id ? "Hide" : "View"}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-1 text-[11px] font-semibold"
                      onClick={() => {
                        downloadTextFile(
                          `govt_pf_esic_${b.month}.csv`,
                          statutoryRemitCsv(b),
                        );
                        flash("Govt remittance CSV downloaded");
                      }}
                    >
                      Export CSV
                    </button>
                  </div>
                </div>

                {openId === b.id ? (
                  <div className="mt-3 space-y-3">
                    <div className="overflow-x-auto rounded-lg border border-[rgba(32,48,80,0.1)]">
                      <table className="w-full min-w-[720px] text-left text-[11px]">
                        <thead>
                          <tr className="border-b border-[rgba(32,48,80,0.08)] text-[var(--muted)]">
                            <th className="px-2 py-1.5 font-medium">Staff</th>
                            <th className="px-2 py-1.5 font-medium">UAN</th>
                            <th className="px-2 py-1.5 font-medium">EPF wages</th>
                            <th className="px-2 py-1.5 font-medium">EE</th>
                            <th className="px-2 py-1.5 font-medium">EPS</th>
                            <th className="px-2 py-1.5 font-medium">ER</th>
                            <th className="px-2 py-1.5 font-medium">EDLI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.lines.map((l) => (
                            <tr key={l.staffId} className="border-b border-[rgba(32,48,80,0.05)]">
                              <td className="px-2 py-1.5">
                                {l.fullName}
                                <div className="text-[var(--muted)]">{l.empCode}</div>
                              </td>
                              <td className="px-2 py-1.5">{l.uanNumber || "—"}</td>
                              <td className="px-2 py-1.5">{formatInr(l.epfWages)}</td>
                              <td className="px-2 py-1.5">{formatInr(l.pfEmployee)}</td>
                              <td className="px-2 py-1.5">{formatInr(l.epsAmount)}</td>
                              <td className="px-2 py-1.5">
                                {formatInr(Math.max(0, l.pfEmployer - l.epsAmount))}
                              </td>
                              <td className="px-2 py-1.5">{formatInr(l.edliAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-[rgba(32,48,80,0.1)]">
                      <table className="w-full min-w-[520px] text-left text-[11px]">
                        <thead>
                          <tr className="border-b border-[rgba(32,48,80,0.08)] text-[var(--muted)]">
                            <th className="px-2 py-1.5 font-medium">Staff</th>
                            <th className="px-2 py-1.5 font-medium">IP number</th>
                            <th className="px-2 py-1.5 font-medium">IP contribution</th>
                            <th className="px-2 py-1.5 font-medium">Employer</th>
                            <th className="px-2 py-1.5 font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.lines
                            .filter((l) => l.esicEmployee + l.esicEmployer > 0)
                            .map((l) => (
                              <tr key={l.staffId} className="border-b border-[rgba(32,48,80,0.05)]">
                                <td className="px-2 py-1.5">
                                  {l.fullName}
                                  <div className="text-[var(--muted)]">{l.empCode}</div>
                                </td>
                                <td className="px-2 py-1.5">{l.esicIpNumber || "—"}</td>
                                <td className="px-2 py-1.5">{formatInr(l.esicEmployee)}</td>
                                <td className="px-2 py-1.5">{formatInr(l.esicEmployer)}</td>
                                <td className="px-2 py-1.5 font-semibold">
                                  {formatInr(l.esicEmployee + l.esicEmployer)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-[rgba(32,48,80,0.1)] p-3">
                    <div className="mb-2 text-[11px] font-semibold text-[var(--brand-deep)]">
                      EPF (Establishment ID {config.epfEstablishmentId || "not set"})
                    </div>
                    {!b.epf.filedAt ? (
                      <div className="space-y-1.5">
                        <input
                          className="field !py-1.5 text-xs"
                          placeholder="Return File ID"
                          value={draft.returnFileId}
                          onChange={(e) => patchDraft(b.id, { returnFileId: e.target.value })}
                        />
                        <input
                          className="field !py-1.5 text-xs"
                          placeholder="Total members"
                          type="number"
                          value={draft.totalMembers}
                          onChange={(e) => patchDraft(b.id, { totalMembers: e.target.value })}
                        />
                        <button
                          type="button"
                          className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1 text-[11px] font-semibold text-white"
                          onClick={() => {
                            if (!draft.returnFileId.trim()) {
                              flash("Enter the Return File ID", true);
                              return;
                            }
                            const r = markEpfReturnFiled({
                              batchId: b.id,
                              by: session.fullName,
                              returnFileId: draft.returnFileId,
                              totalMembers: Number(draft.totalMembers) || undefined,
                            });
                            if (!r.ok) flash(r.error, true);
                            else {
                              flash("EPF return filed");
                              setTick((n) => n + 1);
                            }
                          }}
                        >
                          File EPF return
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-[var(--muted)]">
                          Filed {new Date(b.epf.filedAt).toLocaleDateString("en-IN")} by{" "}
                          {b.epf.filedBy} · Return {b.returnFileId} · {b.totalMembers} members
                        </p>
                        {!b.epf.paidAt ? (
                          <>
                            <input
                              className="field !py-1.5 text-xs"
                              placeholder="EPFO challan no."
                              value={draft.epfChallanRefNo}
                              onChange={(e) => patchDraft(b.id, { epfChallanRefNo: e.target.value })}
                            />
                            <label className="flex items-center gap-2 text-[11px]">
                              <input
                                type="file"
                                accept={RECEIPT_ACCEPT}
                                disabled={uploading === `${b.id}_epf`}
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  e.target.value = "";
                                  if (!file) return;
                                  setUploading(`${b.id}_epf`);
                                  const url = await uploadReceipt(file);
                                  setUploading(null);
                                  if (!url) return;
                                  if (!draft.epfChallanRefNo.trim()) {
                                    flash("Enter the challan number before uploading", true);
                                    return;
                                  }
                                  const r = markEpfChallanPaid({
                                    batchId: b.id,
                                    by: session.fullName,
                                    challanRefNo: draft.epfChallanRefNo,
                                    receiptFileUrl: url,
                                  });
                                  if (!r.ok) flash(r.error, true);
                                  else {
                                    flash("EPF challan marked paid");
                                    setTick((n) => n + 1);
                                  }
                                }}
                              />
                            </label>
                            <p className="text-[10px] text-[var(--muted)]">
                              Upload the EPFO receipt PDF to mark paid.
                            </p>
                          </>
                        ) : (
                          <p className="text-[11px] font-medium text-[#15803d]">
                            Paid {new Date(b.epf.paidAt).toLocaleDateString("en-IN")} · Challan{" "}
                            {b.epf.challanRefNo}
                            {b.epf.receiptFileUrl ? (
                              <>
                                {" "}
                                ·{" "}
                                <a
                                  href={b.epf.receiptFileUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline"
                                >
                                  Receipt
                                </a>
                              </>
                            ) : null}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-[rgba(32,48,80,0.1)] p-3">
                    <div className="mb-2 text-[11px] font-semibold text-[var(--brand-deep)]">
                      ESIC (Employer code {config.esicEmployerCode || "not set"})
                    </div>
                    {!b.esic.paidAt ? (
                      <div className="space-y-1.5">
                        <input
                          className="field !py-1.5 text-xs"
                          placeholder="ESIC challan no."
                          value={draft.esicChallanRefNo}
                          onChange={(e) => patchDraft(b.id, { esicChallanRefNo: e.target.value })}
                        />
                        <label className="flex items-center gap-2 text-[11px]">
                          <input
                            type="file"
                            accept={RECEIPT_ACCEPT}
                            disabled={uploading === `${b.id}_esic`}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (!file) return;
                              setUploading(`${b.id}_esic`);
                              const url = await uploadReceipt(file);
                              setUploading(null);
                              if (!url) return;
                              if (!draft.esicChallanRefNo.trim()) {
                                flash("Enter the challan number before uploading", true);
                                return;
                              }
                              const r = markEsicChallanPaid({
                                batchId: b.id,
                                by: session.fullName,
                                challanRefNo: draft.esicChallanRefNo,
                                receiptFileUrl: url,
                              });
                              if (!r.ok) flash(r.error, true);
                              else {
                                flash("ESIC challan marked paid");
                                setTick((n) => n + 1);
                              }
                            }}
                          />
                        </label>
                        <p className="text-[10px] text-[var(--muted)]">
                          Upload the ESIC receipt PDF to mark paid.
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11px] font-medium text-[#15803d]">
                        Paid {new Date(b.esic.paidAt).toLocaleDateString("en-IN")} · Challan{" "}
                        {b.esic.challanRefNo}
                        {b.esic.receiptFileUrl ? (
                          <>
                            {" "}
                            ·{" "}
                            <a
                              href={b.esic.receiptFileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              Receipt
                            </a>
                          </>
                        ) : null}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {pending.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-[var(--muted)]">
              No pending deposits — post a payroll run with PF/ESIC staff.
            </li>
          ) : null}
        </ul>
      </div>

      <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
          Deposited history ({done.length})
        </div>
        <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
          {done.map((b) => (
            <li key={b.id} className="px-4 py-3 text-sm">
              <div className="font-semibold text-[var(--brand-deep)]">
                {b.month} · {remitStatusLabel(b.status)} ·{" "}
                {formatInr(b.grandTotal)}
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                EPF challan {b.epf.challanRefNo || "—"} · ESIC challan{" "}
                {b.esic.challanRefNo || "—"} · EPF+EPS{" "}
                {formatInr(b.totalEpfEpsContribution)} · ESIC{" "}
                {formatInr(b.esicTotal)}
              </p>
            </li>
          ))}
          {done.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-[var(--muted)]">
              No deposited batches yet.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
