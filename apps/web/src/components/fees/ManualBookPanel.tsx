"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collectPayment,
  computeHouseholdDues,
  formatInr,
  formatManualBookRef,
  householdSiblingIds,
  listManualBooks,
  listManualPostings,
  loadFees,
  openFeeDues,
  searchFeeStudents,
  tenderModeLabel,
  TENDER_MODES,
  voucherLineFromDue,
  type FeeDueLine,
  type StudentSearchHit,
  type TenderMode,
  type VoucherLine,
  type VoucherTender,
} from "@/lib/fees";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";
import { StudentTypeBadge } from "@/components/students/StudentAvatar";
import { DueBreakupPicker } from "@/components/fees/DueBreakupPicker";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

type TenderLine = {
  key: string;
  mode: TenderMode;
  amount: string;
  ref: string;
  instrumentDate: string;
  bankName: string;
};

type TenderComposer = {
  mode: TenderMode | "";
  ref: string;
  instrumentDate: string;
  bankName: string;
  amount: string;
};

function emptyComposer(mode: TenderMode | "" = ""): TenderComposer {
  return {
    mode,
    ref: "",
    instrumentDate: todayIso(),
    bankName: "",
    amount: "",
  };
}

function newTenderKey() {
  return `t_${Math.random().toString(36).slice(2, 9)}`;
}

export function ManualBookPanel({
  tick,
  cashierName,
  onPosted,
  onOpenReceipt,
}: {
  tick: number;
  cashierName: string;
  onPosted: (voucherId: string) => void;
  onOpenReceipt: (voucherId: string) => void;
}) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [seriesCode, setSeriesCode] = useState("FEE-BOOK-A");
  const [leaf, setLeaf] = useState("");
  const [paperDate, setPaperDate] = useState(todayIso);
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [hits, setHits] = useState<StudentSearchHit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [includeFuture, setIncludeFuture] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([]);
  const [composer, setComposer] = useState<TenderComposer>(emptyComposer);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const books = useMemo(() => {
    void tick;
    return listManualBooks();
  }, [tick]);

  const postings = useMemo(() => {
    void tick;
    return listManualPostings().slice(0, 20);
  }, [tick]);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive);
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    return masters.sections.filter(
      (s) => s.classId === classId && s.isActive,
    );
  }, [masters, classId]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const m = loadMasters();
    const s = loadSis();
    setMasters(m);
    setSis(s);
    if (books[0] && !books.some((b) => b.seriesCode === seriesCode)) {
      setSeriesCode(books[0].seriesCode);
    }
  }, [tick, books, seriesCode]);

  useEffect(() => {
    if (!sectionId) return;
    if (!sectionOptions.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [sectionId, sectionOptions]);

  useEffect(() => {
    if (!sis || !masters) return;
    setHits(
      searchFeeStudents(query, sis, masters, loadFees(), {
        classId,
        sectionId,
      }),
    );
  }, [query, classId, sectionId, sis, masters, tick]);

  const selectedStudent = useMemo(() => {
    if (!sis || !selectedId) return null;
    return sis.students.find((s) => s.id === selectedId) ?? null;
  }, [sis, selectedId]);

  const householdBundle = useMemo(() => {
    if (!sis || !masters || !selectedStudent) return [];
    const members = householdSiblingIds(sis, selectedStudent);
    return computeHouseholdDues(
      selectedStudent.householdId,
      sis,
      masters,
      loadFees(),
      { includeFuture },
    ).filter((row) => members.some((m) => m.id === row.student.id));
  }, [sis, masters, selectedStudent, includeFuture, tick]);

  const allDues = useMemo(
    () => householdBundle.flatMap((r) => r.dues),
    [householdBundle],
  );
  const selectedDues = useMemo(
    () => allDues.filter((d) => selectedKeys.has(d.dueKey)),
    [allDues, selectedKeys],
  );
  const collectTotal = selectedDues.reduce((s, d) => s + d.balancePaise, 0);
  const tenderSum = tenderLines.reduce(
    (sum, t) => sum + Math.round((Number(t.amount) || 0) * 100),
    0,
  );
  const remainingPaise = Math.max(0, collectTotal - tenderSum);
  const matched =
    collectTotal > 0 && tenderSum === collectTotal && tenderSum > 0;
  const manualRef = formatManualBookRef(seriesCode, leaf);
  const modeMeta = TENDER_MODES.find((m) => m.value === composer.mode);
  const hasUncleared = tenderLines.some((t) => t.mode === "cheque");
  const today = todayIso();
  const siblingCount = householdBundle.length;
  const householdDueTotal = householdBundle.reduce(
    (s, r) => s + r.dues.reduce((a, d) => a + d.balancePaise, 0),
    0,
  );

  function patchComposer(patch: Partial<TenderComposer>) {
    setComposer((prev) => ({ ...prev, ...patch }));
  }

  function addTenderLine() {
    if (remainingPaise <= 0) {
      setError("Collection amount is already fully covered");
      return;
    }
    if (!composer.mode) {
      setError("Select a payment mode");
      return;
    }
    const meta = TENDER_MODES.find((m) => m.value === composer.mode);
    const amountPaise = Math.round((Number(composer.amount) || 0) * 100);
    if (amountPaise <= 0) {
      setError("Enter payment amount");
      return;
    }
    if (meta?.needsRef && !composer.ref.trim()) {
      setError(`Enter ${meta.refLabel.toLowerCase()}`);
      return;
    }
    if (meta?.needsInstrumentDate && !composer.instrumentDate) {
      setError("Enter instrument / txn date");
      return;
    }
    if (meta?.needsBank && !composer.bankName.trim()) {
      setError("Enter bank name");
      return;
    }
    setTenderLines((prev) => [
      ...prev,
      {
        key: newTenderKey(),
        mode: composer.mode as TenderMode,
        amount: composer.amount,
        ref: composer.ref.trim(),
        instrumentDate: composer.instrumentDate || paperDate,
        bankName: composer.bankName.trim(),
      },
    ]);
    setComposer(emptyComposer());
    setError(null);
  }

  function removeTenderLine(key: string) {
    setTenderLines((prev) => prev.filter((t) => t.key !== key));
  }

  function fillRemaining() {
    if (remainingPaise <= 0) return;
    patchComposer({ amount: String(remainingPaise / 100) });
  }

  function classLabel(s: SisStudent) {
    const c = masters?.classes.find((x) => x.id === s.classId)?.name ?? "—";
    const sec = masters?.sections.find((x) => x.id === s.sectionId)?.name ?? "";
    return sec ? `${c}-${sec}` : c;
  }

  function feeGroupLabel(s: SisStudent) {
    if (!s.feeGroupId) return "No fee group";
    return (
      masters?.feeGroups.find((g) => g.id === s.feeGroupId)?.name ?? "Fee group"
    );
  }

  function toggleDue(d: FeeDueLine) {
    if (d.balancePaise <= 0) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(d.dueKey)) next.delete(d.dueKey);
      else next.add(d.dueKey);
      return next;
    });
  }

  function toggleMonth(monthDues: FeeDueLine[], select: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const d of monthDues) {
        if (d.balancePaise <= 0) continue;
        if (select) next.add(d.dueKey);
        else next.delete(d.dueKey);
      }
      return next;
    });
  }

  function selectStudentDues(studentId: string) {
    const keys = openFeeDues(allDues)
      .filter((d) => d.studentId === studentId)
      .map((d) => d.dueKey);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }

  function clearStudentDues(studentId: string) {
    const drop = new Set(
      allDues.filter((d) => d.studentId === studentId).map((d) => d.dueKey),
    );
    setSelectedKeys((prev) => {
      const next = new Set<string>();
      for (const k of prev) if (!drop.has(k)) next.add(k);
      return next;
    });
  }

  function toggleStudentAll(studentId: string) {
    const keys = openFeeDues(allDues)
      .filter((d) => d.studentId === studentId)
      .map((d) => d.dueKey);
    const allOn =
      keys.length > 0 && keys.every((k) => selectedKeys.has(k));
    if (allOn) clearStudentDues(studentId);
    else selectStudentDues(studentId);
  }

  function selectAllSiblings() {
    setSelectedKeys(new Set(openFeeDues(allDues).map((d) => d.dueKey)));
  }

  function selectOverdue() {
    setSelectedKeys(
      new Set(
        openFeeDues(allDues)
          .filter((d) => d.dueOn <= today)
          .map((d) => d.dueKey),
      ),
    );
  }

  function pick(hit: StudentSearchHit) {
    setSelectedId(hit.student.id);
    setSelectedKeys(new Set());
    setTenderLines([]);
    setComposer(emptyComposer());
    setError(null);
  }

  function post(opts?: { allowBackdate?: boolean; allowDuplicate?: boolean }) {
    if (!selectedStudent || !sis) return;
    if (!matched) {
      setError("Add payments until total matches selected dues");
      return;
    }
    const nameById = new Map(
      sis.students.map((s) => [s.id, s.fullName] as const),
    );
    const lines: VoucherLine[] = selectedDues.map((d) =>
      voucherLineFromDue(d, nameById.get(d.studentId) ?? "Student"),
    );

    const tenders: VoucherTender[] = tenderLines.map((t) => ({
      mode: t.mode,
      amountPaise: Math.round((Number(t.amount) || 0) * 100),
      ref: t.ref,
      instrumentDate: t.instrumentDate || paperDate,
      bankName: t.bankName,
      realisation:
        t.mode === "cheque" ? "subject_to_clearance" : "cleared",
    }));

    const result = collectPayment({
      householdId: selectedStudent.householdId,
      lines,
      tenders,
      cashierName,
      academicYearCode: DEFAULT_AY,
      collectionDate: paperDate,
      transactionDate: paperDate,
      source: "manual_book",
      manualBookSeries: seriesCode,
      manualBookLeaf: leaf,
      allowBackdate: opts?.allowBackdate,
      allowDuplicate: opts?.allowDuplicate,
      note: tenders.some((t) => t.realisation === "subject_to_clearance")
        ? "Cheque realisation subject to clearance"
        : undefined,
    });

    if (!result.ok) {
      if (result.code === "backdate") {
        if (window.confirm(`${result.error}\n\nPost anyway?`)) {
          post({ ...opts, allowBackdate: true });
        }
        return;
      }
      if (result.code === "duplicate") {
        if (window.confirm(`${result.error}\n\nPost anyway?`)) {
          post({ ...opts, allowDuplicate: true });
        }
        return;
      }
      setError(result.error);
      return;
    }

    setError(null);
    setNotice(`Posted ${manualRef} → ${result.voucher.receiptNo}`);
    setLeaf("");
    setSelectedKeys(new Set());
    setTenderLines([]);
    setComposer(emptyComposer());
    onPosted(result.voucher.id);
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Post manual receipt
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Paper carbon book → ERP ledger. Links as{" "}
          <span className="font-semibold">FEE-BOOK-A/4521</span> (same field as
          Collect&apos;s school receipt no.) — leaf numbers are unique across
          both screens. System still issues <span className="font-semibold">REC/…</span>.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Book series
            </span>
            <select
              className="field"
              value={seriesCode}
              onChange={(e) => setSeriesCode(e.target.value)}
            >
              {books.map((b) => (
                <option key={b.id} value={b.seriesCode}>
                  {b.seriesCode} — {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Receipt # (leaf)
            </span>
            <input
              className="field"
              value={leaf}
              onChange={(e) =>
                setLeaf(e.target.value.replace(/\D/g, "").slice(0, 8))
              }
              inputMode="numeric"
              placeholder="4521"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Paper date
            </span>
            <input
              className="field"
              type="date"
              value={paperDate}
              onChange={(e) => setPaperDate(e.target.value)}
            />
          </label>
          <div className="flex flex-col justify-end text-sm">
            <span className="text-[11px] text-[var(--muted)]">
              School receipt no. (linked)
            </span>
            <span className="font-bold text-[var(--brand-deep)]">
              {manualRef || "—"}
            </span>
            <span className="text-[11px] text-[var(--muted)]">
              Posted by {cashierName}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
          <label className="block text-sm">
            <span className="mb-1.5 block text-[var(--muted)]">Find student</span>
            <input
              className="field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, admission no, or mobile…"
              autoComplete="off"
              autoFocus={mounted}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-[var(--muted)]">Class</span>
            <select
              className="field"
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setSectionId("");
              }}
            >
              <option value="">All classes</option>
              {classOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-[var(--muted)]">Section</span>
            <select
              className="field"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              disabled={!classId}
            >
              <option value="">
                {classId ? "All sections" : "Pick class first"}
              </option>
              {sectionOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {(query.trim() || classId || sectionId) && !selectedStudent ? (
          <div className="mt-3">
            <p className="mb-2 text-[11px] text-[var(--muted)]">
              {hits.length} match{hits.length === 1 ? "" : "es"} — pick one to
              open household
            </p>
            {hits.length === 0 ? (
              <p className="rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-3 text-sm text-[var(--muted)]">
                No students match. Check fee group on SIS if balances look empty.
              </p>
            ) : (
              <ul className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                {hits.map((h) => (
                  <li key={h.student.id}>
                    <button
                      type="button"
                      onClick={() => pick(h)}
                      className="rounded-lg border border-[rgba(32,48,80,0.14)] bg-[rgba(32,48,80,0.03)] px-3 py-2 text-left hover:border-[rgba(197,160,40,0.45)] hover:bg-[rgba(197,160,40,0.1)]"
                    >
                      <div className="text-sm font-semibold text-[var(--brand-deep)]">
                        <StudentTypeBadge type={h.student.studentType} />
                        {h.student.fullName}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {h.classLabel} · {formatInr(h.balancePaise)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {selectedStudent ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(32,48,80,0.08)] pt-3">
            <div className="text-sm text-[var(--brand-deep)]">
              <span className="font-semibold">{selectedStudent.fullName}</span>
              <span className="text-[var(--muted)]">
                {" "}
                · {selectedStudent.admissionNo} · household open
              </span>
            </div>
            <button
              type="button"
              className="text-xs font-semibold text-[var(--brand-mid)]"
              onClick={() => {
                setSelectedId(null);
                setSelectedKeys(new Set());
                setTenderLines([]);
                setComposer(emptyComposer());
              }}
            >
              Change student
            </button>
          </div>
        ) : null}
      </div>

      {!selectedStudent ? (
        <div className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-white px-6 py-12 text-center">
          <p className="text-base font-semibold text-[var(--brand-deep)]">
            Search to post a manual receipt
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Same as Fee Take Collect — search or filter by class; household
            siblings open side by side.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[var(--brand-deep)]">
                Household fees
              </h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {siblingCount} student{siblingCount === 1 ? "" : "s"}
                {siblingCount > 1 ? " (siblings)" : ""} · open dues{" "}
                <span
                  className={`font-semibold ${
                    householdBundle.some((r) =>
                    openFeeDues(r.dues).some((d) => d.dueOn <= today),
                    )
                      ? "text-[#dc2626]"
                      : "text-[var(--brand-deep)]"
                  }`}
                >
                  {formatInr(householdDueTotal)}
                </span>
                {" · "}
                selected{" "}
                <span
                  className={`font-semibold ${
                    collectTotal > 0 ? "text-[#16a34a]" : "text-[var(--muted)]"
                  }`}
                >
                  {formatInr(collectTotal)}
                </span>
                <span className="mt-0.5 block font-normal text-[10px] leading-snug">
                  Grouped by month — tick a month or only the heads to clear
                </span>
              </p>
            </div>
            <label className="flex max-w-[14rem] items-start gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={includeFuture}
                onChange={(e) => setIncludeFuture(e.target.checked)}
              />
              <span>
                Include future months
                <span className="mt-0.5 block font-normal text-[10px] leading-snug">
                  Off = only through this month
                </span>
              </span>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <MiniBtn onClick={selectAllSiblings}>
              {siblingCount > 1 ? "Select all siblings" : "Select all dues"}
            </MiniBtn>
            <MiniBtn onClick={selectOverdue}>Select all overdue</MiniBtn>
            <MiniBtn onClick={() => setSelectedKeys(new Set())}>
              Clear all
            </MiniBtn>
          </div>

          <div
            className={`mt-4 grid max-h-[min(70vh,40rem)] gap-3 overflow-auto ${
              siblingCount > 1
                ? "sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(17rem,1fr))]"
                : "grid-cols-1"
            }`}
          >
            {householdBundle.every((r) => openFeeDues(r.dues).length === 0) &&
            householdBundle.every((r) => r.dues.length === 0) ? (
              <p className="text-sm text-[var(--muted)] sm:col-span-full">
                No open dues
                {!selectedStudent.feeGroupId
                  ? " — assign a fee group on the student profile"
                  : ""}
                .
              </p>
            ) : (
              householdBundle.map((row) => {
                const openDues = openFeeDues(row.dues);
                const dueKeys = openDues.map((d) => d.dueKey);
                const selectedForStudent = openDues.filter((d) =>
                  selectedKeys.has(d.dueKey),
                );
                const allSelected =
                  dueKeys.length > 0 &&
                  dueKeys.every((k) => selectedKeys.has(k));
                const someSelected =
                  !allSelected && selectedForStudent.length > 0;
                const rowTotal = openDues.reduce(
                  (s, d) => s + d.balancePaise,
                  0,
                );
                const rowSelected = selectedForStudent.reduce(
                  (s, d) => s + d.balancePaise,
                  0,
                );
                const hasOverdue = openDues.some((d) => d.dueOn <= today);
                const isFocus = row.student.id === selectedStudent.id;
                const isSibling = !isFocus && siblingCount > 1;

                return (
                  <div
                    key={row.student.id}
                    className={`flex min-h-0 flex-col rounded-xl border p-3 ${
                      isFocus
                        ? "border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.06)]"
                        : "border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.02)]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <label className="flex min-w-0 cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          className="mt-1.5"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={() => toggleStudentAll(row.student.id)}
                          disabled={openDues.length === 0}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[var(--brand-deep)]">
                            <StudentTypeBadge type={row.student.studentType} />
                            {row.student.fullName}
                            {isSibling ? (
                              <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                                Sibling
                              </span>
                            ) : siblingCount > 1 ? (
                              <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-gold)]">
                                Opened
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--muted)]">
                            {row.student.admissionNo} ·{" "}
                            {classLabel(row.student)}
                          </div>
                          <div className="text-[11px] text-[var(--muted)]">
                            {feeGroupLabel(row.student)}
                          </div>
                        </div>
                      </label>
                      <div className="text-right">
                        <div
                          className={`text-sm font-bold ${
                            hasOverdue
                              ? "text-[#dc2626]"
                              : rowTotal === 0 && row.dues.length > 0
                                ? "text-[#15803d]"
                                : "text-[var(--brand-deep)]"
                          }`}
                        >
                          {formatInr(rowTotal)}
                        </div>
                        <div
                          className={`text-[11px] font-semibold ${
                            rowSelected > 0
                              ? "text-[#16a34a]"
                              : "text-[var(--muted)]"
                          }`}
                        >
                          {selectedForStudent.length}/{openDues.length} open ·{" "}
                          {formatInr(rowSelected)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <MiniBtn
                        onClick={() => toggleStudentAll(row.student.id)}
                      >
                        {allSelected ? "Unselect" : "Select child"}
                      </MiniBtn>
                      <MiniBtn
                        onClick={() => {
                          setSelectedKeys((prev) => {
                            const next = new Set(prev);
                            for (const d of openDues) {
                              if (d.dueOn <= today) next.add(d.dueKey);
                            }
                            return next;
                          });
                        }}
                      >
                        Overdue
                      </MiniBtn>
                      {someSelected || allSelected ? (
                        <MiniBtn
                          onClick={() => clearStudentDues(row.student.id)}
                        >
                          Clear
                        </MiniBtn>
                      ) : null}
                    </div>

                    {row.dues.length === 0 ? (
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        No fee lines for this student
                      </p>
                    ) : (
                      <DueBreakupPicker
                        dues={row.dues}
                        selectedKeys={selectedKeys}
                        today={today}
                        onToggle={toggleDue}
                        onToggleMonth={toggleMonth}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {selectedStudent && collectTotal > 0 ? (
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Amount to post
              </p>
              <p className="text-2xl font-extrabold text-[var(--brand-deep)]">
                {formatInr(collectTotal)}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                Payments {formatInr(tenderSum)}
                {tenderSum > 0 && tenderSum < collectTotal
                  ? ` · still need ${formatInr(collectTotal - tenderSum)}`
                  : ""}
                {tenderSum > collectTotal
                  ? ` · ${formatInr(tenderSum - collectTotal)} over`
                  : ""}
                {matched ? " · matched" : ""}
              </p>
            </div>
          </div>

          {tenderLines.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {tenderLines.map((t, i) => (
                <li
                  key={t.key}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.03)] px-3 py-2.5"
                >
                  <div className="min-w-0 text-sm">
                    <div className="font-semibold text-[var(--brand-deep)]">
                      <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-gold)] text-[10px] font-bold text-[var(--brand-deep)]">
                        {i + 1}
                      </span>
                      {tenderModeLabel(t.mode)} ·{" "}
                      {formatInr(Math.round((Number(t.amount) || 0) * 100))}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {[t.ref, t.instrumentDate, t.bankName]
                        .filter(Boolean)
                        .join(" · ")}
                      {t.mode === "cheque"
                        ? " · Subject to realisation"
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold text-[var(--danger)]"
                    onClick={() => removeTenderLine(t.key)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 rounded-xl border border-[rgba(197,160,40,0.35)] bg-[rgba(248,248,240,0.97)] p-3">
            {collectTotal > 0 && tenderSum >= collectTotal ? (
              <p className="text-sm font-semibold text-[var(--ok)]">
                Amount fully matched — remove a payment if you need to change
                modes.
              </p>
            ) : (
              <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--brand-deep)]">
                {tenderLines.length === 0 ? "Add payment" : "Add another"}
              </div>
              {remainingPaise > 0 && composer.mode ? (
                <button
                  type="button"
                  className="rounded-full bg-[rgba(197,160,40,0.2)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--brand-deep)]"
                  onClick={fillRemaining}
                >
                  Use remaining {formatInr(remainingPaise)}
                </button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
              <label className="block min-w-0 flex-1 text-sm lg:max-w-[9rem]">
                <span className="mb-1 block text-[11px] font-medium text-[var(--muted)]">
                  Mode
                </span>
                <select
                  className="field !py-1.5"
                  value={composer.mode}
                  onChange={(e) =>
                    patchComposer({
                      mode: e.target.value as TenderMode | "",
                      ref: "",
                      bankName: "",
                      amount: "",
                      instrumentDate: paperDate || todayIso(),
                    })
                  }
                >
                  <option value="">Select…</option>
                  {TENDER_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              {composer.mode && modeMeta ? (
                <>
                  {modeMeta.needsRef ? (
                    <label className="block min-w-0 flex-[1.2] text-sm">
                      <span className="mb-1 block text-[11px] font-medium text-[var(--muted)]">
                        {modeMeta.refLabel}
                      </span>
                      <input
                        className="field !py-1.5"
                        value={composer.ref}
                        onChange={(e) => patchComposer({ ref: e.target.value })}
                        placeholder={modeMeta.refLabel}
                        autoComplete="off"
                      />
                    </label>
                  ) : null}

                  {modeMeta.needsBank ? (
                    <label className="block min-w-0 flex-1 text-sm">
                      <span className="mb-1 block text-[11px] font-medium text-[var(--muted)]">
                        Bank
                      </span>
                      <input
                        className="field !py-1.5"
                        value={composer.bankName}
                        onChange={(e) =>
                          patchComposer({ bankName: e.target.value })
                        }
                        placeholder="Bank name"
                        autoComplete="off"
                      />
                    </label>
                  ) : null}

                  {modeMeta.needsInstrumentDate ? (
                    <label className="block min-w-0 text-sm lg:w-[9.5rem]">
                      <span className="mb-1 block text-[11px] font-medium text-[var(--muted)]">
                        Date
                      </span>
                      <input
                        className="field !py-1.5"
                        type="date"
                        value={composer.instrumentDate}
                        onChange={(e) =>
                          patchComposer({ instrumentDate: e.target.value })
                        }
                      />
                    </label>
                  ) : null}

                  <label className="block min-w-0 text-sm lg:w-[7.5rem]">
                    <span className="mb-1 block text-[11px] font-medium text-[var(--muted)]">
                      Amount (₹)
                    </span>
                    <input
                      className="field !border-[rgba(197,160,40,0.45)] !bg-[rgba(197,160,40,0.08)] !py-1.5 font-semibold"
                      inputMode="decimal"
                      value={composer.amount}
                      onChange={(e) =>
                        patchComposer({
                          amount: e.target.value.replace(/[^\d.]/g, ""),
                        })
                      }
                      placeholder="0"
                    />
                  </label>

                  <button
                    type="button"
                    className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-xs font-bold text-white"
                    onClick={addTenderLine}
                  >
                    Add
                  </button>
                </>
              ) : null}
            </div>

            {composer.mode === "cheque" ? (
              <p className="mt-2 rounded-lg bg-[rgba(197,160,40,0.2)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)]">
                Cheque will be marked: realisation subject to clearance
              </p>
            ) : null}
              </>
            )}
          </div>

          {hasUncleared ? (
            <p className="mt-3 text-[11px] font-semibold text-[var(--brand-mid)]">
              Receipt will show: cheque realisation subject to clearance.
            </p>
          ) : null}

          <button
            type="button"
            className={`mt-4 w-full rounded-xl px-4 py-3 text-sm font-bold uppercase tracking-wide text-white disabled:cursor-not-allowed ${
              matched
                ? "bg-[#22c55e] hover:bg-[#16a34a]"
                : "bg-[#ef4444] disabled:opacity-90"
            }`}
            disabled={!manualRef || !matched}
            onClick={() => post()}
          >
            {matched
              ? `Post to ledger · ${manualRef}`
              : !manualRef
                ? "Enter book series & leaf no."
                : tenderSum <= 0
                  ? "Add payment to match amount"
                  : tenderSum < collectTotal
                    ? `Still need ${formatInr(collectTotal - tenderSum)}`
                    : `Reduce by ${formatInr(tenderSum - collectTotal)}`}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-[rgba(180,60,60,0.1)] px-3 py-2 text-sm font-medium text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-2 text-sm font-medium text-[var(--ok)]">
          {notice}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Recent manual postings
          </h2>
        </div>
        {postings.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted)]">
            No manual book receipts posted yet.
          </p>
        ) : (
          <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
            {postings.map((v) => (
              <li
                key={v.id}
                className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${
                  v.voidedAt ? "opacity-60" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[var(--brand-deep)]">
                    {v.schoolReceiptNo || "—"}
                    <span className="ml-2 text-xs font-semibold text-[var(--muted)]">
                      → {v.receiptNo}
                    </span>
                    {v.voidedAt ? (
                      <span className="ml-2 text-[10px] font-bold uppercase text-[var(--danger)]">
                        Void
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    {v.collectionDate} ·{" "}
                    {Array.from(new Set(v.lines.map((l) => l.studentName))).join(
                      ", ",
                    )}{" "}
                    · {v.tenders.map((t) => tenderModeLabel(t.mode)).join("+")}{" "}
                    · {v.cashierName}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tabular-nums">
                    {formatInr(v.totalPaise)}
                  </span>
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
                    onClick={() => onOpenReceipt(v.id)}
                  >
                    Open
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MiniBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
