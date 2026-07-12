"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collectPayment,
  computeHouseholdDues,
  formatInr,
  householdSiblingIds,
  loadFees,
  chequeStats,
  dayCloseNeedsAttention,
  openFeeDues,
  isCollectionDateLocked,
  deliverWhatsAppFeeReceipt,
  searchFeeStudents,
  tenderModeLabel,
  TENDER_MODES,
  voidVoucher,
  voucherLineFromDue,
  type CollectionVoucher,
  type FeeDueLine,
  type StudentSearchHit,
  type TenderMode,
  type VoucherLine,
  type VoucherTender,
} from "@/lib/fees";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import {
  householdWhatsApp,
  isValidMobile,
  loadSis,
  normalizeMobile,
  updateHouseholdWhatsApp,
  type Household,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import { StudentTypeBadge } from "@/components/students/StudentAvatar";
import { FilterExportButtons } from "@/components/reports/FilterExportButtons";
import { describeFilters } from "@/lib/reportExport";
import { TENANT } from "@/lib/types";
import {
  FeeReceiptSheet,
  printFeeReceipt,
} from "@/components/fees/FeeReceiptSheet";
import { ChequesPanel } from "@/components/fees/ChequesPanel";
import { ManualBookPanel } from "@/components/fees/ManualBookPanel";
import { DayClosePanel } from "@/components/fees/DayClosePanel";
import { DueBreakupPicker } from "@/components/fees/DueBreakupPicker";
import { PayLinksPanel } from "@/components/fees/PayLinksPanel";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  buildPaymentSharePayload,
  buildPaymentShareUrl,
  composeWhatsAppPaymentLinkMessage,
  createPaymentLink,
  openPaymentLinkCount,
  whatsAppPaymentLinkUrl,
} from "@/lib/payments";

type Tab =
  | "collect"
  | "receipts"
  | "cheques"
  | "manual"
  | "paylinks"
  | "dayclose";

/** One confirmed payment row on the voucher */
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

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

export function FeeTakeWorkspace() {
  const session = useDemoSession();
  const [tab, setTab] = useState<Tab>("collect");
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [hits, setHits] = useState<StudentSearchHit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [includeFuture, setIncludeFuture] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([]);
  const [composer, setComposer] = useState<TenderComposer>(emptyComposer);
  const [collectionDate, setCollectionDate] = useState(todayIso);
  const [schoolReceiptNo, setSchoolReceiptNo] = useState("");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<CollectionVoucher[]>([]);
  const [previewReceiptId, setPreviewReceiptId] = useState<string | null>(
    null,
  );
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);

  function refresh() {
    const m = loadMasters();
    const s = loadSis();
    setMasters(m);
    setSis(s);
    setHits(
      searchFeeStudents(query, s, m, loadFees(), { classId, sectionId }),
    );
    setReceipts(loadFees().vouchers);
    setTick((t) => t + 1);
  }

  useEffect(() => {
    setMounted(true);
    void (async () => {
      const { ensureSisHydrated } = await import("@/lib/sisPersistence");
      await ensureSisHydrated();
      refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sis || !masters) return;
    setHits(
      searchFeeStudents(query, sis, masters, loadFees(), {
        classId,
        sectionId,
      }),
    );
  }, [query, classId, sectionId, sis, masters, tick]);

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
    if (!sectionId) return;
    if (!sectionOptions.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [sectionId, sectionOptions]);

  const selectedStudent = useMemo(() => {
    if (!sis || !selectedId) return null;
    return sis.students.find((s) => s.id === selectedId) ?? null;
  }, [sis, selectedId]);

  const householdBundle = useMemo(() => {
    if (!sis || !masters || !selectedStudent) return [];
    const fees = loadFees();
    const members = householdSiblingIds(sis, selectedStudent);
    return computeHouseholdDues(
      selectedStudent.householdId,
      sis,
      masters,
      fees,
      { includeFuture },
    ).filter((row) => members.some((m) => m.id === row.student.id));
  }, [sis, masters, selectedStudent, includeFuture, tick]);

  const allDues = useMemo(
    () => householdBundle.flatMap((row) => row.dues),
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

  const householdReceipts = useMemo(() => {
    if (!selectedStudent) return [];
    const memberIds = new Set(householdBundle.map((r) => r.student.id));
    return receipts
      .filter(
        (v) =>
          v.householdId === selectedStudent.householdId ||
          v.lines.some((l) => memberIds.has(l.studentId)),
      )
      .slice()
      .sort((a, b) => {
        const byDate = b.collectionDate.localeCompare(a.collectionDate);
        if (byDate !== 0) return byDate;
        return b.collectedAt.localeCompare(a.collectedAt);
      });
  }, [receipts, selectedStudent, householdBundle]);

  const previewVoucher =
    receipts.find((v) => v.id === previewReceiptId) ?? null;

  const openChequeCount = useMemo(() => {
    void tick;
    const s = chequeStats();
    return s.receivedCount + s.depositedCount;
  }, [tick]);

  const openPayLinkCount = useMemo(() => {
    void tick;
    return openPaymentLinkCount();
  }, [tick]);

  const dayClosePending = useMemo(() => {
    void tick;
    return dayCloseNeedsAttention();
  }, [tick]);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function resetPaymentFields() {
    setTenderLines([]);
    setComposer(emptyComposer());
    setCollectionDate(todayIso());
    setSchoolReceiptNo("");
    setNote("");
  }

  function pickStudent(hit: StudentSearchHit) {
    setSelectedId(hit.student.id);
    setSelectedKeys(new Set());
    resetPaymentFields();
  }

  function toggleDue(due: FeeDueLine) {
    if (due.balancePaise <= 0) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(due.dueKey)) next.delete(due.dueKey);
      else next.add(due.dueKey);
      return next;
    });
  }

  /** Select or clear every open head in one month group. */
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

  function selectOverdue() {
    const today = todayIso();
    setSelectedKeys(
      new Set(
        openFeeDues(allDues)
          .filter((d) => d.dueOn <= today)
          .map((d) => d.dueKey),
      ),
    );
  }

  /** All open dues for every sibling currently listed. */
  function selectAllSiblings() {
    setSelectedKeys(new Set(openFeeDues(allDues).map((d) => d.dueKey)));
  }

  function clearSelection() {
    setSelectedKeys(new Set());
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
    if (keys.length === 0) return;
    const allOn = keys.every((k) => selectedKeys.has(k));
    if (allOn) clearStudentDues(studentId);
    else selectStudentDues(studentId);
  }

  function selectStudentOverdue(studentId: string) {
    const today = todayIso();
    const keys = openFeeDues(allDues)
      .filter((d) => d.studentId === studentId && d.dueOn <= today)
      .map((d) => d.dueKey);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }

  // Drop selections that are no longer open (paid / hidden future)
  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      const allowed = new Set(openFeeDues(allDues).map((d) => d.dueKey));
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (allowed.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [allDues]);

  function patchComposer(patch: Partial<TenderComposer>) {
    setComposer((prev) => ({ ...prev, ...patch }));
  }

  function addTenderLine() {
    if (remainingPaise <= 0) {
      flash("Collection amount is already fully covered");
      return;
    }
    if (!composer.mode) {
      flash("Choose a payment mode first");
      return;
    }
    const meta = TENDER_MODES.find((m) => m.value === composer.mode);
    const amountPaise = Math.round((Number(composer.amount) || 0) * 100);
    if (amountPaise <= 0) {
      flash("Enter amount");
      return;
    }
    if (meta?.needsRef && !composer.ref.trim()) {
      flash(`Enter ${meta.refLabel.toLowerCase()}`);
      return;
    }
    if (meta?.needsInstrumentDate && !composer.instrumentDate) {
      flash("Enter instrument / txn date");
      return;
    }
    if (meta?.needsBank && !composer.bankName.trim()) {
      flash("Enter bank name");
      return;
    }
    setTenderLines((prev) => [
      ...prev,
      {
        key: newTenderKey(),
        mode: composer.mode as TenderMode,
        amount: composer.amount,
        ref: composer.ref.trim(),
        instrumentDate: composer.instrumentDate,
        bankName: composer.bankName.trim(),
      },
    ]);
    setComposer(emptyComposer());
  }

  function removeTenderLine(key: string) {
    setTenderLines((prev) => prev.filter((t) => t.key !== key));
  }

  function fillRemainingAmount() {
    if (remainingPaise <= 0) return;
    patchComposer({ amount: String(remainingPaise / 100) });
  }

  function onCollect() {
    if (!selectedStudent || !sis) return;
    const nameById = new Map(
      sis.students.map((s) => [s.id, s.fullName] as const),
    );
    const lines: VoucherLine[] = selectedDues.map((d) =>
      voucherLineFromDue(d, nameById.get(d.studentId) ?? "Student"),
    );
    const voucherTenders: VoucherTender[] = tenderLines.map((t) => ({
      mode: t.mode,
      amountPaise: Math.round((Number(t.amount) || 0) * 100),
      ref: t.ref,
      instrumentDate: t.instrumentDate,
      bankName: t.bankName,
      realisation:
        t.mode === "cheque" ? "subject_to_clearance" : "cleared",
    }));

    const primaryTxn =
      voucherTenders.find((t) => t.ref)?.ref ??
      voucherTenders.find((t) => t.instrumentDate)?.instrumentDate ??
      "";
    const primaryTxnDate =
      voucherTenders.find((t) => t.instrumentDate)?.instrumentDate ||
      collectionDate;

    const result = collectPayment({
      householdId: selectedStudent.householdId,
      lines,
      tenders: voucherTenders,
      cashierName: session.fullName,
      academicYearCode: DEFAULT_AY,
      collectionDate,
      transactionDate: primaryTxnDate,
      transactionId: primaryTxn,
      schoolReceiptNo,
      note:
        voucherTenders.some((t) => t.realisation === "subject_to_clearance")
          ? [note.trim(), "Cheque realisation subject to clearance"]
              .filter(Boolean)
              .join(" · ")
          : note,
    });
    if (!result.ok) {
      flash(result.error);
      return;
    }
    setSelectedKeys(new Set());
    resetPaymentFields();
    refresh();
    flash(`Collected ${result.voucher.receiptNo}`);
    setPreviewReceiptId(result.voucher.id);
  }

  function onSendUpiLink() {
    if (!selectedStudent || !sis || !masters) return;
    const selectedDues = householdBundle.flatMap((b) =>
      b.dues.filter((d) => selectedKeys.has(d.dueKey)),
    );
    if (selectedDues.length === 0) {
      flash("Select dues to include on the payment link");
      return;
    }
    const className =
      masters.classes.find((c) => c.id === selectedStudent.classId)?.name ??
      "";
    const sectionName =
      masters.sections.find((s) => s.id === selectedStudent.sectionId)
        ?.name ?? "";
    const classLabel = sectionName
      ? `${className}-${sectionName}`
      : className;

    const created = createPaymentLink({
      householdId: selectedStudent.householdId,
      studentId: selectedStudent.id,
      studentName: selectedStudent.fullName,
      classLabel,
      dues: selectedDues,
      createdBy: session.fullName,
      academicYearCode: selectedStudent.academicYearCode || DEFAULT_AY,
      note: note.trim(),
    });
    if (!created.ok) {
      flash(created.error);
      return;
    }

    const payload = buildPaymentSharePayload(
      created.link,
      TENANT.nameDisplay,
    );
    const url = buildPaymentShareUrl(payload);
    const hh = sis.households.find(
      (h) => h.id === selectedStudent.householdId,
    );
    const mobile = householdWhatsApp(hh);
    if (mobile && isValidMobile(mobile)) {
      const msg = composeWhatsAppPaymentLinkMessage(
        created.link,
        url,
        TENANT.nameDisplay,
      );
      window.open(whatsAppPaymentLinkUrl(mobile, msg), "_blank", "noopener");
      flash(
        `UPI link ${created.link.code} · ${formatInr(created.link.amountPaise)} — WhatsApp opened`,
      );
    } else {
      void navigator.clipboard.writeText(url).then(
        () =>
          flash(
            `UPI link ${created.link.code} copied — set WhatsApp on household to send`,
          ),
        () => flash(`Created ${created.link.code}: ${url}`),
      );
    }
    setSelectedKeys(new Set());
    refresh();
    setTab("paylinks");
  }

  function onVoid(id: string) {
    if (!window.confirm("Void this receipt? Dues will reopen.")) return;
    voidVoucher(id);
    if (previewReceiptId === id) setPreviewReceiptId(null);
    refresh();
    flash("Receipt voided");
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
            Fee Take
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Collect academic + transport + special + store dues · counter or UPI
            link · dated receipt
          </p>
        </div>
        <div className="flex gap-2">
          <TabBtn active={tab === "collect"} onClick={() => setTab("collect")}>
            Collect
          </TabBtn>
          <TabBtn
            active={tab === "receipts"}
            onClick={() => setTab("receipts")}
          >
            Receipts
          </TabBtn>
          <TabBtn
            active={tab === "cheques"}
            onClick={() => setTab("cheques")}
          >
            Cheques
            {mounted && openChequeCount > 0 ? ` (${openChequeCount})` : ""}
          </TabBtn>
          <TabBtn active={tab === "manual"} onClick={() => setTab("manual")}>
            Manual book
          </TabBtn>
          <TabBtn
            active={tab === "paylinks"}
            onClick={() => setTab("paylinks")}
          >
            Pay links
            {mounted && openPayLinkCount > 0 ? ` (${openPayLinkCount})` : ""}
          </TabBtn>
          <TabBtn
            active={tab === "dayclose"}
            onClick={() => setTab("dayclose")}
          >
            Day close{mounted && dayClosePending ? " ●" : ""}
          </TabBtn>
          <Link
            href="/fees/defaulters"
            className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--brand-deep)]"
          >
            Defaulters
          </Link>
        </div>
      </div>

      {notice ? (
        <p className="mt-3 rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      {tab === "collect" ? (
        <div className="mt-6 space-y-5">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
              <label className="block text-sm">
                <span className="mb-1.5 block text-[var(--muted)]">
                  Find student
                </span>
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
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-[var(--muted)]">
                PDF / Excel exports the current search &amp; class filter (
                {hits.length} student{hits.length === 1 ? "" : "s"}).
              </p>
              <FilterExportButtons
                title="Fee Take · student search"
                subtitle={`${TENANT.shortName} · ${DEFAULT_AY}`}
                filterNote={describeFilters([
                  classOptions.find((c) => c.id === classId)?.name
                    ? `Class ${classOptions.find((c) => c.id === classId)?.name}`
                    : "",
                  sectionOptions.find((s) => s.id === sectionId)?.name
                    ? `Sec ${sectionOptions.find((s) => s.id === sectionId)?.name}`
                    : "",
                  query.trim() ? `Search “${query.trim()}”` : "",
                ])}
                fileBaseName="fee_take_students"
                columns={[
                  { key: "admissionNo", header: "Adm no", width: 1.1 },
                  { key: "fullName", header: "Name", width: 1.6 },
                  { key: "classLabel", header: "Class", width: 0.9 },
                  { key: "type", header: "Type", width: 0.9 },
                  { key: "mobile", header: "Mobile", width: 1 },
                  {
                    key: "balance",
                    header: "Open balance",
                    width: 1,
                    align: "right",
                  },
                ]}
                rows={hits.map((h) => ({
                  admissionNo: h.student.admissionNo,
                  fullName: h.student.fullName,
                  classLabel: h.classLabel,
                  type: h.student.studentType,
                  mobile: h.household?.mobile ?? "",
                  balance: formatInr(h.balancePaise),
                }))}
                onMessage={flash}
              />
            </div>

            {/* Compact match strip — replaces left list */}
            {(query.trim() || classId || sectionId) && !selectedStudent ? (
              <div className="mt-3">
                <p className="mb-2 text-[11px] text-[var(--muted)]">
                  {hits.length} match{hits.length === 1 ? "" : "es"} — pick one
                  to open household
                </p>
                {hits.length === 0 ? (
                  <p className="rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-3 text-sm text-[var(--muted)]">
                    No students match. Check fee group on SIS if balances look
                    empty.
                  </p>
                ) : (
                  <ul className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                    {hits.map((h) => (
                      <li key={h.student.id}>
                        <button
                          type="button"
                          onClick={() => pickStudent(h)}
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
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[rgba(32,48,80,0.08)] pt-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="text-sm text-[var(--brand-deep)]">
                    <span className="font-semibold">
                      {selectedStudent.fullName}
                    </span>
                    <span className="text-[var(--muted)]">
                      {" "}
                      · {selectedStudent.admissionNo} · household open
                    </span>
                  </div>
                  <WhatsAppInline
                    household={
                      sis?.households.find(
                        (h) => h.id === selectedStudent.householdId,
                      ) ?? null
                    }
                    onUpdated={() => {
                      refresh();
                      flash("WhatsApp number updated for all communications");
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs font-semibold text-[var(--brand-mid)]"
                  onClick={() => {
                    setSelectedId(null);
                    setSelectedKeys(new Set());
                    resetPaymentFields();
                  }}
                >
                  Change student
                </button>
              </div>
            ) : null}
          </div>

          {!selectedStudent ? (
            <div className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-white px-6 py-16 text-center">
              <p className="text-base font-semibold text-[var(--brand-deep)]">
                Search to start Fee Take
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
                Type a name, admission number, or mobile — or filter by class.
                Matches appear as chips above; the household dues panel fills
                this space.
              </p>
            </div>
          ) : (
            <CollectPanel
              student={selectedStudent}
              householdBundle={householdBundle}
              selectedKeys={selectedKeys}
              includeFuture={includeFuture}
              onIncludeFuture={setIncludeFuture}
              onToggle={toggleDue}
              onToggleMonth={toggleMonth}
              onSelectOverdue={selectOverdue}
              onSelectAllSiblings={selectAllSiblings}
              onClear={clearSelection}
              onToggleStudentAll={toggleStudentAll}
              onSelectStudentOverdue={selectStudentOverdue}
              onClearStudent={clearStudentDues}
              collectTotal={collectTotal}
              tenderLines={tenderLines}
              composer={composer}
              tenderSum={tenderSum}
              remainingPaise={remainingPaise}
              collectionDate={collectionDate}
              schoolReceiptNo={schoolReceiptNo}
              note={note}
              onPatchComposer={patchComposer}
              onAddTender={addTenderLine}
              onRemoveTender={removeTenderLine}
              onFillRemaining={fillRemainingAmount}
              onCollectionDate={setCollectionDate}
              onSchoolReceiptNo={setSchoolReceiptNo}
              onNote={setNote}
              onCollect={onCollect}
              onSendUpiLink={onSendUpiLink}
              masters={masters}
              cashierName={session.fullName}
              priorReceipts={householdReceipts}
              onOpenReceipt={setPreviewReceiptId}
            />
          )}
        </div>
      ) : tab === "receipts" ? (
        <ReceiptsPanel
          receipts={receipts}
          sis={sis}
          onVoid={onVoid}
          onPreview={setPreviewReceiptId}
        />
      ) : tab === "cheques" ? (
        <ChequesPanel
          tick={tick}
          sis={sis}
          onChanged={() => {
            refresh();
            flash("Cheque register updated");
          }}
          onOpenReceipt={(voucherId) => {
            setPreviewReceiptId(voucherId);
          }}
        />
      ) : tab === "manual" ? (
        <ManualBookPanel
          tick={tick}
          cashierName={session.fullName}
          onPosted={(voucherId) => {
            refresh();
            setPreviewReceiptId(voucherId);
            flash("Manual receipt posted to ledger");
          }}
          onOpenReceipt={setPreviewReceiptId}
        />
      ) : tab === "paylinks" ? (
        <PayLinksPanel
          tick={tick}
          cashierName={session.fullName}
          onChanged={() => {
            refresh();
          }}
          onOpenReceipt={setPreviewReceiptId}
        />
      ) : (
        <DayClosePanel
          tick={tick}
          cashierName={session.fullName}
          onChanged={() => {
            refresh();
          }}
          onOpenReceipt={setPreviewReceiptId}
        />
      )}

      {previewVoucher ? (
        <ReceiptPreviewModal
          voucher={previewVoucher}
          sis={sis}
          masters={masters}
          onClose={() => setPreviewReceiptId(null)}
          onSentWhatsApp={() => {
            refresh();
            flash("Fee receipt delivered on WhatsApp (PDF + digital link)");
          }}
        />
      ) : null}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
        active
          ? "bg-[var(--brand-deep)] text-white"
          : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
      }`}
    >
      {children}
    </button>
  );
}

function CollectPanel({
  student,
  householdBundle,
  selectedKeys,
  includeFuture,
  onIncludeFuture,
  onToggle,
  onToggleMonth,
  onSelectOverdue,
  onSelectAllSiblings,
  onClear,
  onToggleStudentAll,
  onSelectStudentOverdue,
  onClearStudent,
  collectTotal,
  tenderLines,
  composer,
  tenderSum,
  remainingPaise,
  collectionDate,
  schoolReceiptNo,
  note,
  onPatchComposer,
  onAddTender,
  onRemoveTender,
  onFillRemaining,
  onCollectionDate,
  onSchoolReceiptNo,
  onNote,
  onCollect,
  onSendUpiLink,
  masters,
  cashierName,
  priorReceipts,
  onOpenReceipt,
}: {
  student: SisStudent;
  householdBundle: { student: SisStudent; dues: FeeDueLine[] }[];
  selectedKeys: Set<string>;
  includeFuture: boolean;
  onIncludeFuture: (v: boolean) => void;
  onToggle: (d: FeeDueLine) => void;
  onToggleMonth: (monthDues: FeeDueLine[], select: boolean) => void;
  onSelectOverdue: () => void;
  onSelectAllSiblings: () => void;
  onClear: () => void;
  onToggleStudentAll: (studentId: string) => void;
  onSelectStudentOverdue: (studentId: string) => void;
  onClearStudent: (studentId: string) => void;
  collectTotal: number;
  tenderLines: TenderLine[];
  composer: TenderComposer;
  tenderSum: number;
  remainingPaise: number;
  collectionDate: string;
  schoolReceiptNo: string;
  note: string;
  onPatchComposer: (patch: Partial<TenderComposer>) => void;
  onAddTender: () => void;
  onRemoveTender: (key: string) => void;
  onFillRemaining: () => void;
  onCollectionDate: (v: string) => void;
  onSchoolReceiptNo: (v: string) => void;
  onNote: (v: string) => void;
  onCollect: () => void;
  onSendUpiLink: () => void;
  masters: MastersState | null;
  cashierName: string;
  priorReceipts: CollectionVoucher[];
  onOpenReceipt: (id: string) => void;
}) {
  const today = todayIso();
  const modeMeta = TENDER_MODES.find((m) => m.value === composer.mode);
  const hasUncleared = tenderLines.some((t) => t.mode === "cheque");
  const siblingCount = householdBundle.length;
  const householdDueTotal = householdBundle.reduce(
    (s, r) => s + r.dues.reduce((a, d) => a + d.balancePaise, 0),
    0,
  );

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

  return (
    <div className="space-y-4">
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
              onChange={(e) => onIncludeFuture(e.target.checked)}
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
          {siblingCount > 1 ? (
            <MiniBtn onClick={onSelectAllSiblings}>
              Select all siblings
            </MiniBtn>
          ) : (
            <MiniBtn onClick={onSelectAllSiblings}>Select all dues</MiniBtn>
          )}
          <MiniBtn onClick={onSelectOverdue}>Select all overdue</MiniBtn>
          <MiniBtn onClick={onClear}>Clear all</MiniBtn>
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
              {!student.feeGroupId
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
              const isFocus = row.student.id === student.id;
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
                        onChange={() => onToggleStudentAll(row.student.id)}
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
                          {row.student.admissionNo} · {classLabel(row.student)}
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
                      onClick={() => onToggleStudentAll(row.student.id)}
                    >
                      {allSelected ? "Unselect" : "Select child"}
                    </MiniBtn>
                    <MiniBtn
                      onClick={() => onSelectStudentOverdue(row.student.id)}
                    >
                      Overdue
                    </MiniBtn>
                    {someSelected || allSelected ? (
                      <MiniBtn onClick={() => onClearStudent(row.student.id)}>
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
                      onToggle={onToggle}
                      onToggleMonth={onToggleMonth}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div
        className="relative overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.14)] shadow-[0_12px_40px_rgba(32,48,80,0.1)]"
        style={{
          background:
            "linear-gradient(165deg, #203050 0%, #2a3d66 42%, #1a2740 100%)",
        }}
      >
        <div
          className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-[rgba(197,160,40,0.18)] blur-2xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-16 left-10 h-44 w-44 rounded-full bg-[rgba(197,160,40,0.12)] blur-3xl"
          aria-hidden
        />
        <div className="relative p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#f0d878]">
                Counter collection
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-3xl font-extrabold tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)] sm:text-4xl">
                  {formatInr(collectTotal)}
                </span>
                {siblingCount > 1 ? (
                  <span className="rounded-full bg-[#c5a028] px-2.5 py-0.5 text-[11px] font-bold text-[#1a2740]">
                    Household · {siblingCount} students
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-[#f0d878]">
                    to collect
                  </span>
                )}
              </div>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] font-medium text-white/65">
                Collection date
              </span>
              <input
                className="field !border-white/20 !bg-white/95 !py-1.5 !text-[var(--brand-deep)]"
                type="date"
                value={collectionDate}
                onChange={(e) => onCollectionDate(e.target.value)}
                required
              />
              {isCollectionDateLocked(collectionDate) ? (
                <span className="mt-1 block text-[10px] font-semibold leading-snug text-[#fca5a5]">
                  This date is day-closed — pick another date or reject handover
                </span>
              ) : null}
            </label>
            <label className="block min-w-[10rem] text-sm sm:min-w-[12rem]">
              <span className="mb-1 block text-[11px] font-medium text-white/65">
                School receipt no.
              </span>
              <input
                className="field !border-white/20 !bg-white/95 !py-1.5 !text-[var(--brand-deep)]"
                value={schoolReceiptNo}
                onChange={(e) => onSchoolReceiptNo(e.target.value)}
                placeholder="Optional · e.g. FEE-BOOK-A/4521"
                autoComplete="off"
              />
              <span className="mt-1 block text-[10px] leading-snug text-white/55">
                Same pool as Manual book leaves — duplicates blocked. Prefer
                Manual book tab for full paper postings.
              </span>
            </label>
          </div>

          {/* Added payments */}
          {tenderLines.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {tenderLines.map((t, i) => (
                <li
                  key={t.key}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-sm"
                >
                  <div className="min-w-0 text-sm">
                    <div className="font-semibold text-white">
                      <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-gold)] text-[10px] font-bold text-[var(--brand-deep)]">
                        {i + 1}
                      </span>
                      {tenderModeLabel(t.mode)} ·{" "}
                      {formatInr(Math.round((Number(t.amount) || 0) * 100))}
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/65">
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
                    className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-[#ffb4a8] hover:bg-white/15"
                    onClick={() => onRemoveTender(t.key)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Single-row composer — locked when amount already fully matched */}
          {collectTotal > 0 && tenderSum >= collectTotal ? (
            <div className="mt-4 rounded-xl border border-[rgba(60,160,100,0.45)] bg-[rgba(60,160,100,0.12)] px-3 py-2.5 text-sm font-semibold text-[#b8f0cc]">
              Amount fully matched — remove a payment if you need to change modes.
            </div>
          ) : (
          <div className="mt-4 rounded-xl border border-[rgba(197,160,40,0.35)] bg-[rgba(248,248,240,0.97)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--brand-deep)]">
                {tenderLines.length === 0 ? "Add payment" : "Add another"}
              </div>
              {remainingPaise > 0 && composer.mode ? (
                <button
                  type="button"
                  className="rounded-full bg-[rgba(197,160,40,0.2)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--brand-deep)]"
                  onClick={onFillRemaining}
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
                  className="field !border-[rgba(32,48,80,0.18)] !py-1.5"
                  value={composer.mode}
                  onChange={(e) =>
                    onPatchComposer({
                      mode: e.target.value as TenderMode | "",
                      ref: "",
                      bankName: "",
                      amount: "",
                      instrumentDate: collectionDate || todayIso(),
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
                        className="field !border-[rgba(32,48,80,0.18)] !py-1.5"
                        value={composer.ref}
                        onChange={(e) =>
                          onPatchComposer({ ref: e.target.value })
                        }
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
                        className="field !border-[rgba(32,48,80,0.18)] !py-1.5"
                        value={composer.bankName}
                        onChange={(e) =>
                          onPatchComposer({ bankName: e.target.value })
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
                        className="field !border-[rgba(32,48,80,0.18)] !py-1.5"
                        type="date"
                        value={composer.instrumentDate}
                        onChange={(e) =>
                          onPatchComposer({ instrumentDate: e.target.value })
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
                        onPatchComposer({
                          amount: e.target.value.replace(/[^\d.]/g, ""),
                        })
                      }
                      placeholder="0"
                      autoComplete="off"
                    />
                  </label>

                  <button
                    type="button"
                    className="rounded-xl bg-[#c5a028] px-4 py-2.5 text-sm font-extrabold text-[#152238] shadow-[0_4px_14px_rgba(197,160,40,0.4)] hover:bg-[#f0d878] lg:shrink-0"
                    onClick={onAddTender}
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
          </div>
          )}

          {hasUncleared ? (
            <p className="mt-3 rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-gold-soft)]">
              Receipt will show: cheque realisation subject to clearance.
            </p>
          ) : null}

          {(() => {
            const matched = collectTotal > 0 && tenderSum === collectTotal;
            const short =
              collectTotal > 0 && tenderSum > 0 && tenderSum < collectTotal;
            const over = collectTotal > 0 && tenderSum > collectTotal;
            const gap = Math.abs(collectTotal - tenderSum);
            return (
              <div
                className={`mt-4 rounded-xl px-3 py-2.5 text-base font-bold ${
                  matched
                    ? "bg-[rgba(60,160,100,0.22)] text-[#b8f0cc]"
                    : short || over
                      ? "bg-[rgba(180,60,60,0.28)] text-[#ffc9c2]"
                      : "bg-white/10 text-white/70"
                }`}
              >
                Payments {formatInr(tenderSum)}
                {short ? ` · still need ${formatInr(gap)}` : ""}
                {over ? ` · ${formatInr(gap)} more than required` : ""}
                {matched ? " · matched ✓" : ""}
              </div>
            );
          })()}

          <label className="mt-4 block text-sm">
            <span className="mb-1.5 block text-[11px] font-medium text-white/65">
              Notes
            </span>
            <input
              className="field !border-white/20 !bg-white/95 !text-[var(--brand-deep)]"
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="Optional note on receipt"
              autoComplete="off"
            />
          </label>

          {(() => {
            const matched =
              collectTotal > 0 && tenderSum === collectTotal && tenderSum > 0;
            return (
              <button
                type="button"
                className={`mt-4 w-full rounded-xl px-4 py-3.5 text-base font-extrabold uppercase tracking-wide transition active:scale-[0.99] disabled:cursor-not-allowed ${
                  matched
                    ? "bg-[#22c55e] text-white shadow-[0_0_0_2px_rgba(255,255,255,0.35),0_10px_28px_rgba(34,197,94,0.55)] hover:bg-[#16a34a] hover:shadow-[0_0_0_2px_rgba(255,255,255,0.5),0_12px_32px_rgba(34,197,94,0.65)]"
                    : "bg-[#ef4444] text-white shadow-[0_0_0_2px_rgba(255,255,255,0.2),0_10px_28px_rgba(239,68,68,0.4)] hover:bg-[#dc2626] disabled:bg-[#ef4444] disabled:opacity-90 disabled:shadow-[0_0_0_2px_rgba(255,255,255,0.15)]"
                }`}
                disabled={!matched}
                onClick={onCollect}
              >
                {matched
                  ? "Collect & print receipt"
                  : collectTotal <= 0
                    ? "Select dues to collect"
                    : tenderSum <= 0
                      ? "Add payment to match amount"
                      : tenderSum < collectTotal
                        ? `Still need ${formatInr(collectTotal - tenderSum)}`
                        : `Reduce by ${formatInr(tenderSum - collectTotal)}`}
              </button>
            );
          })()}
          <button
            type="button"
            className="mt-2 w-full rounded-xl border-2 border-[#128C7E] bg-[#128C7E]/15 px-4 py-3 text-sm font-bold text-[#0f766e] hover:bg-[#128C7E]/25 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={collectTotal <= 0}
            onClick={onSendUpiLink}
          >
            {collectTotal > 0
              ? `Send UPI link · ${formatInr(collectTotal)}`
              : "Select dues for UPI link"}
          </button>
          <p className="mt-2 text-center text-[11px] text-white/65">
            Collecting as{" "}
            <span className="font-semibold text-[#f0d878]">{cashierName}</span>
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Earlier receipts
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Household history · open to view / print / WhatsApp
          </p>
        </div>
        {priorReceipts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted)]">
            No earlier receipts for this household yet.
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto">
            {priorReceipts.map((v) => {
              const voided = !!v.voidedAt;
              const names = Array.from(
                new Set(v.lines.map((l) => l.studentName)),
              );
              const modes = Array.from(
                new Set(v.tenders.map((t) => tenderModeLabel(t.mode))),
              );
              return (
                <li
                  key={v.id}
                  className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 ${
                    voided ? "opacity-60" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-[var(--brand-deep)]">
                        {v.receiptNo}
                      </span>
                      {voided ? (
                        <span className="rounded bg-[rgba(180,60,60,0.12)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--danger)]">
                          Void
                        </span>
                      ) : (
                        <span className="rounded bg-[rgba(15,122,76,0.12)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ok)]">
                          Paid
                        </span>
                      )}
                      {v.schoolReceiptNo ? (
                        <span className="text-[11px] text-[var(--muted)]">
                          Book {v.schoolReceiptNo}
                        </span>
                      ) : null}
                      {v.whatsappSentAt && !voided ? (
                        <span className="rounded bg-[#128C7E]/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#128C7E]">
                          WA
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                      {v.collectionDate} · {names.join(", ")} ·{" "}
                      {modes.join(" + ")} · by {v.cashierName}
                    </p>
                  </div>
                  <div className="text-sm font-bold tabular-nums text-[var(--brand-deep)]">
                    {formatInr(v.totalPaise)}
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.04)]"
                    onClick={() => onOpenReceipt(v.id)}
                  >
                    Open
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function WhatsAppInline({
  household,
  onUpdated,
}: {
  household: Household | null;
  onUpdated: () => void;
}) {
  const current = householdWhatsApp(household);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(householdWhatsApp(household));
    setEditing(false);
    setError(null);
  }, [household?.id, household?.whatsappMobile, household?.mobile]);

  if (!household) return null;

  function save() {
    const value = normalizeMobile(draft);
    if (!isValidMobile(value)) {
      setError("10 digits required");
      return;
    }
    const result = updateHouseholdWhatsApp(household!.id, value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setEditing(false);
    onUpdated();
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.03)] px-2 py-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
          WhatsApp
        </span>
        <span className="text-xs font-semibold tabular-nums text-[var(--brand-deep)]">
          {current || "—"}
        </span>
        <button
          type="button"
          className="text-[11px] font-semibold text-[var(--brand-mid)] hover:underline"
          onClick={() => {
            setDraft(current);
            setEditing(true);
          }}
          title="Change WhatsApp for all household communications"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
        WhatsApp
      </span>
      <input
        className="field !w-[8.5rem] !py-1 !text-xs"
        value={draft}
        onChange={(e) => {
          setDraft(normalizeMobile(e.target.value));
          setError(null);
        }}
        inputMode="numeric"
        maxLength={10}
        autoFocus
        aria-label="WhatsApp number"
      />
      <button
        type="button"
        className="rounded-md bg-[var(--brand-deep)] px-2 py-1 text-[11px] font-bold text-white"
        onClick={save}
      >
        Save
      </button>
      <button
        type="button"
        className="text-[11px] font-semibold text-[var(--muted)]"
        onClick={() => {
          setDraft(current);
          setEditing(false);
          setError(null);
        }}
      >
        Cancel
      </button>
      {household.mobile ? (
        <button
          type="button"
          className="text-[11px] font-semibold text-[var(--brand-mid)]"
          onClick={() => setDraft(normalizeMobile(household.mobile))}
        >
          Use mobile
        </button>
      ) : null}
      {error ? (
        <span className="text-[11px] font-medium text-[var(--danger)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function ReceiptPreviewModal({
  voucher,
  sis,
  masters,
  onClose,
  onSentWhatsApp,
}: {
  voucher: CollectionVoucher;
  sis: SisState | null;
  masters: MastersState | null;
  onClose: () => void;
  onSentWhatsApp?: () => void;
}) {
  const household = sis?.households.find((h) => h.id === voucher.householdId);
  const householdHint = household?.guardianName;
  const waNumber = householdWhatsApp(household);
  const [waDraft, setWaDraft] = useState(waNumber);
  const [waError, setWaError] = useState<string | null>(null);
  const [waNotice, setWaNotice] = useState<string | null>(null);
  const [waBusy, setWaBusy] = useState(false);

  useEffect(() => {
    setWaDraft(householdWhatsApp(household));
    setWaError(null);
    setWaNotice(null);
  }, [voucher.id, household?.id, household?.whatsappMobile, household?.mobile]);

  async function sendWhatsApp() {
    setWaError(null);
    setWaNotice(null);
    if (waDraft.trim() && waDraft !== waNumber && household) {
      const saved = updateHouseholdWhatsApp(household.id, waDraft);
      if (!saved.ok) {
        setWaError(saved.error);
        return;
      }
    }
    setWaBusy(true);
    try {
      const result = await deliverWhatsAppFeeReceipt({
        voucher,
        mobile: waDraft,
        sis,
        masters,
        householdHint: householdHint ?? undefined,
        receiptElement: document.getElementById(`receipt-${voucher.id}`),
      });
      if (!result.ok) {
        setWaError(result.error);
        return;
      }
      if (result.mode === "share_file") {
        setWaNotice(
          `Receipt PDF shared — choose WhatsApp for +91 ${result.mobile}`,
        );
      } else if (result.pdfDownloaded) {
        setWaNotice(
          `Receipt PDF downloaded + WhatsApp opened for +91 ${result.mobile}. Attach the PDF in the chat if needed. Full receipt link is in the message.`,
        );
      } else {
        setWaNotice(
          `WhatsApp opened for +91 ${result.mobile} with full receipt text + digital receipt link`,
        );
      }
      onSentWhatsApp?.();
    } finally {
      setWaBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(15,22,40,0.55)] p-4 print:static print:bg-transparent print:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Receipt print preview"
    >
      <div className="my-4 w-full max-w-2xl print:my-0 print:max-w-none">
        <div className="print-hide mb-3 space-y-3 rounded-xl bg-white px-4 py-3 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-[var(--brand-deep)]">
                Receipt details
              </p>
              <p className="text-xs text-[var(--muted)]">
                {voucher.receiptNo} · full format
                {voucher.whatsappSentAt ? (
                  <span className="ml-1.5 font-semibold text-[#128C7E]">
                    · WhatsApp sent{" "}
                    {voucher.whatsappSentAt.slice(0, 16).replace("T", " ")}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-[#128C7E] px-4 py-2 text-xs font-bold text-white hover:opacity-95 disabled:opacity-60"
                onClick={() => void sendWhatsApp()}
                disabled={!!voucher.voidedAt || waBusy}
              >
                {waBusy ? "Preparing…" : "Send WhatsApp"}
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-xs font-bold text-white"
                onClick={() => printFeeReceipt(voucher.id)}
              >
                Print
              </button>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-4 py-2 text-xs font-semibold text-[var(--brand-deep)]"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>

          {!voucher.voidedAt ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-[rgba(32,48,80,0.08)] pt-3">
              <label className="min-w-[11rem] flex-1 text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  WhatsApp number
                </span>
                <input
                  className="field !py-1.5"
                  inputMode="numeric"
                  value={waDraft}
                  onChange={(e) =>
                    setWaDraft(normalizeMobile(e.target.value))
                  }
                  placeholder="10-digit mobile"
                  maxLength={10}
                />
              </label>
              <p className="pb-2 text-[10px] text-[var(--muted)] sm:max-w-[16rem]">
                Delivers the full receipt: PDF (share/attach), digital receipt
                link, and break-up text in the WhatsApp message.
              </p>
            </div>
          ) : null}

          {waError ? (
            <p className="text-xs font-semibold text-[#dc2626]">{waError}</p>
          ) : null}
          {waNotice ? (
            <p className="text-xs font-semibold text-[#128C7E]">{waNotice}</p>
          ) : null}
        </div>
        <FeeReceiptSheet
          voucher={voucher}
          householdHint={householdHint}
          sis={sis}
          masters={masters}
        />
      </div>
    </div>
  );
}

function ReceiptsPanel({
  receipts,
  sis,
  onVoid,
  onPreview,
}: {
  receipts: CollectionVoucher[];
  sis: SisState | null;
  onVoid: (id: string) => void;
  onPreview: (id: string | null) => void;
}) {
  const guardianOf = (householdId: string) =>
    sis?.households.find((h) => h.id === householdId)?.guardianName;

  if (receipts.length === 0) {
    return (
      <p className="mt-8 text-sm text-[var(--muted)]">
        No receipts yet. Collect from the Collect tab.
      </p>
    );
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
      <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Receipt register
        </h2>
        <p className="text-xs text-[var(--muted)]">
          Compact list — open for full receipt format
        </p>
      </div>
      <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
        {receipts.map((v) => {
          const voided = !!v.voidedAt;
          const students = Array.from(
            new Set(v.lines.map((l) => l.studentName)),
          );
          return (
            <li
              key={v.id}
              className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                voided ? "opacity-60" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-[var(--brand-deep)]">
                    {v.receiptNo}
                  </span>
                  {voided ? (
                    <span className="rounded bg-[rgba(180,60,60,0.12)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--danger)]">
                      Void
                    </span>
                  ) : null}
                  {v.schoolReceiptNo ? (
                    <span className="text-[11px] text-[var(--muted)]">
                      Book {v.schoolReceiptNo}
                    </span>
                  ) : null}
                  {v.whatsappSentAt && !voided ? (
                    <span className="rounded bg-[#128C7E]/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#128C7E]">
                      WA
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  {v.collectionDate} · {students.join(", ")}
                  {guardianOf(v.householdId)
                    ? ` · ${guardianOf(v.householdId)}`
                    : ""}{" "}
                  · by {v.cashierName}
                </p>
              </div>
              <div className="text-sm font-bold tabular-nums text-[var(--brand-deep)]">
                {formatInr(v.totalPaise)}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
                  onClick={() => onPreview(v.id)}
                >
                  Open
                </button>
                {!voided ? (
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--danger)]"
                    onClick={() => onVoid(v.id)}
                  >
                    Void
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
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
