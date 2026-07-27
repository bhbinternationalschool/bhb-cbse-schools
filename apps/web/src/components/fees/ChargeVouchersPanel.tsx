"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createChargeVoucher,
  formatInr,
  listChargeVouchers,
  loadFees,
  openChargeVoucherCount,
  searchFeeStudents,
  suggestChargeVoucherHeads,
  voidChargeVoucher,
  type ChargeVoucher,
  type StudentSearchHit,
} from "@/lib/fees";
import {
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { useDemoSession } from "@/components/shell/SessionContext";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

type DraftLine = {
  feeHeadId: string;
  feeHeadName: string;
  amount: string;
  selected: boolean;
  status: string;
  structureAmountPaise: number;
};

/**
 * Create supplementary charge vouchers for heads left out of an already-paid
 * month — open lines appear on Fee Take Collect for payment.
 */
export function ChargeVouchersPanel({
  tick,
  onChanged,
}: {
  tick: number;
  onChanged: () => void;
}) {
  const session = useDemoSession();
  const ay = session.academicYearCode;
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [rows, setRows] = useState<ChargeVoucher[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentSearchHit[]>([]);
  const [studentId, setStudentId] = useState("");
  const [installmentId, setInstallmentId] = useState("");
  const [dueOn, setDueOn] = useState(todayIso);
  const [reason, setReason] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [extraHeadId, setExtraHeadId] = useState("");
  const [extraAmount, setExtraAmount] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    const m = loadMasters();
    const s = loadSis();
    setMasters(m);
    setSis(s);
    setRows(listChargeVouchers(loadFees(), { includeVoided: true }));
  }

  useEffect(() => {
    refresh();
  }, [tick, ay]);

  useEffect(() => {
    if (!sis || !masters) return;
    setHits(
      searchFeeStudents(query, sis, masters, loadFees(), {
        academicYearCode: ay,
      }).slice(0, 20),
    );
  }, [query, sis, masters, ay]);

  const installments = useMemo(() => {
    if (!masters) return [];
    return masters.installments
      .filter((i) => i.academicYearCode === ay && i.isActive)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [masters, ay]);

  const student = sis?.students.find((s) => s.id === studentId) ?? null;

  useEffect(() => {
    if (!studentId || !installmentId || !masters) {
      setDraftLines([]);
      return;
    }
    const suggested = suggestChargeVoucherHeads({
      studentId,
      installmentId,
      masters,
    });
    setDraftLines(
      suggested.map((s) => ({
        feeHeadId: s.feeHeadId,
        feeHeadName: s.feeHeadName,
        amount:
          s.suggestedPaise > 0
            ? String(s.suggestedPaise / 100)
            : s.status === "paid"
              ? String(s.structureAmountPaise / 100)
              : "",
        selected: s.status === "missing" && s.suggestedPaise > 0,
        status: s.status,
        structureAmountPaise: s.structureAmountPaise,
      })),
    );
    const inst = masters.installments.find((i) => i.id === installmentId);
    if (inst?.dueOn) setDueOn(inst.dueOn);
  }, [studentId, installmentId, masters, tick]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function pickStudent(hit: StudentSearchHit) {
    setStudentId(hit.student.id);
    setQuery("");
    setHits([]);
  }

  function onAddExtraHead() {
    if (!extraHeadId || !masters) return;
    const head = masters.feeHeads.find((h) => h.id === extraHeadId);
    if (!head) return;
    if (draftLines.some((d) => d.feeHeadId === extraHeadId)) {
      setDraftLines((prev) =>
        prev.map((d) =>
          d.feeHeadId === extraHeadId
            ? {
                ...d,
                selected: true,
                amount: extraAmount || d.amount || String(0),
              }
            : d,
        ),
      );
    } else {
      setDraftLines((prev) => [
        ...prev,
        {
          feeHeadId: head.id,
          feeHeadName: head.nameEn,
          amount: extraAmount || "",
          selected: true,
          status: "extra",
          structureAmountPaise: 0,
        },
      ]);
    }
    setExtraHeadId("");
    setExtraAmount("");
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId) {
      setError("Select a student");
      return;
    }
    if (!installmentId) {
      setError("Select the month / installment");
      return;
    }
    const lines = draftLines
      .filter((d) => d.selected && Number(d.amount) > 0)
      .map((d) => ({
        feeHeadId: d.feeHeadId,
        feeHeadName: d.feeHeadName,
        amountPaise: Math.round(Number(d.amount) * 100),
      }));
    const result = createChargeVoucher({
      studentId,
      installmentId,
      dueOn,
      reason,
      createdBy: session.fullName,
      academicYearCode: student?.academicYearCode || ay,
      lines,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    flash(
      `${result.voucher.code} created · ${formatInr(result.voucher.totalPaise)} — open on Fee Take Collect`,
    );
    setReason("");
    setDraftLines((prev) =>
      prev.map((d) => ({ ...d, selected: false, amount: "" })),
    );
    refresh();
    onChanged();
  }

  const openCount = openChargeVoucherCount();

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Charge vouchers
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Create a separate voucher when a month was already collected but some
          fee heads were left out. The voucher appears on{" "}
          <strong>Collect</strong> for payment
          {openCount > 0 ? ` · ${openCount} open` : ""}.
        </p>
      </div>

      {notice ? (
        <p className="rounded-lg bg-[rgba(67,160,71,0.12)] px-3 py-2 text-sm text-[#2e7d32]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={onCreate}
        className="grid gap-4 lg:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.4fr)]"
      >
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
            Student
          </h3>
          {student ? (
            <div className="mt-2 rounded-lg bg-[rgba(32,48,80,0.05)] px-3 py-2 text-sm">
              <div className="font-semibold text-[var(--brand-deep)]">
                <StudentNameLabel student={student} />
              </div>
              <div className="text-xs text-[var(--muted)]">
                {student.admissionNo}
              </div>
              <button
                type="button"
                className="mt-1 text-[11px] font-semibold text-[var(--brand-mid)]"
                onClick={() => setStudentId("")}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                className="field mt-2"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name / admission…"
              />
              <ul className="mt-2 max-h-56 overflow-auto divide-y divide-[rgba(32,48,80,0.06)]">
                {hits.map((h) => (
                  <li key={h.student.id}>
                    <button
                      type="button"
                      className="w-full px-2 py-2 text-left text-sm hover:bg-[rgba(32,48,80,0.04)]"
                      onClick={() => pickStudent(h)}
                    >
                      {h.student.fullName}
                      <span className="block text-[11px] text-[var(--muted)]">
                        {h.student.admissionNo} · {h.classLabel}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-[var(--muted)]">
              Month / installment
            </span>
            <select
              className="field"
              value={installmentId}
              onChange={(e) => setInstallmentId(e.target.value)}
              required
            >
              <option value="">Select month…</option>
              {installments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label} ({i.code}) · due {i.dueOn}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-[var(--muted)]">Due date</span>
            <input
              type="date"
              className="field"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </label>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
              Heads to bill on voucher
            </h3>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Missing = not on structure dues for this month. Tick heads and set
              amounts. Paid months are pre-filled so you can re-add left-out
              heads.
            </p>
            {!installmentId || !studentId ? (
              <p className="mt-4 text-sm text-[var(--muted)]">
                Select student and month to load heads.
              </p>
            ) : (
              <ul className="mt-3 max-h-64 overflow-auto divide-y divide-[rgba(32,48,80,0.08)]">
                {draftLines.map((d) => (
                  <li
                    key={d.feeHeadId}
                    className="flex flex-wrap items-center gap-2 py-2 text-sm"
                  >
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={d.selected}
                        onChange={(e) =>
                          setDraftLines((prev) =>
                            prev.map((x) =>
                              x.feeHeadId === d.feeHeadId
                                ? { ...x, selected: e.target.checked }
                                : x,
                            ),
                          )
                        }
                      />
                      <span>
                        <span className="font-medium text-[var(--brand-deep)]">
                          {d.feeHeadName}
                        </span>
                        <span className="ml-1 text-[11px] text-[var(--muted)]">
                          · {d.status}
                          {d.structureAmountPaise > 0
                            ? ` · structure ${formatInr(d.structureAmountPaise)}`
                            : ""}
                        </span>
                      </span>
                    </label>
                    <input
                      className="field !w-28 !py-1"
                      inputMode="decimal"
                      placeholder="₹"
                      value={d.amount}
                      disabled={!d.selected}
                      onChange={(e) =>
                        setDraftLines((prev) =>
                          prev.map((x) =>
                            x.feeHeadId === d.feeHeadId
                              ? { ...x, amount: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[rgba(32,48,80,0.08)] pt-3">
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Add other head
                </span>
                <select
                  className="field !py-1.5"
                  value={extraHeadId}
                  onChange={(e) => setExtraHeadId(e.target.value)}
                >
                  <option value="">Head…</option>
                  {(masters?.feeHeads ?? [])
                    .filter((h) => h.isActive)
                    .map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.nameEn}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Amount ₹
                </span>
                <input
                  className="field !w-28 !py-1.5"
                  value={extraAmount}
                  onChange={(e) => setExtraAmount(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold"
                onClick={onAddExtraHead}
              >
                Add head
              </button>
            </div>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block text-[var(--muted)]">Reason</span>
              <textarea
                className="field min-h-[64px]"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. April receipt missed Amenity + Transport"
                required
              />
            </label>

            <button
              type="submit"
              className="btn-accent mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold"
              disabled={!studentId || !installmentId}
            >
              Create voucher · show on Fee Take
            </button>
          </div>
        </div>
      </form>

      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          Recent charge vouchers
        </h3>
        <ul className="mt-2 divide-y divide-[rgba(32,48,80,0.08)] text-sm">
          {rows.slice(0, 40).map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div>
                <div className="font-medium text-[var(--brand-deep)]">
                  {v.code} · {v.studentName}
                  {v.voidedAt ? (
                    <span className="ml-2 text-[11px] text-[var(--danger)]">
                      voided
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {v.installmentLabel} · {formatInr(v.totalPaise)} ·{" "}
                  {v.lines.map((l) => l.feeHeadName).join(", ")} · {v.reason}
                </div>
              </div>
              {!v.voidedAt ? (
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--danger)]"
                  onClick={() => {
                    if (!window.confirm(`Void ${v.code}?`)) return;
                    voidChargeVoucher(v.id, session.fullName);
                    refresh();
                    onChanged();
                    flash(`${v.code} voided`);
                  }}
                >
                  Void
                </button>
              ) : null}
            </li>
          ))}
          {rows.length === 0 ? (
            <li className="py-6 text-center text-[var(--muted)]">
              No charge vouchers yet
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
