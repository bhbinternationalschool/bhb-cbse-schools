"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  captureRegistrationPayment,
  composeRegistrationReceiptWhatsApp,
  composeRegistrationWhatsAppMessage,
  createFamilyRegistrationsFromDesk,
  createRegistrationUpiLink,
  enrollLead,
  groupLeadsByParent,
  householdOf,
  listLeadRegistrationPayments,
  listRegistrationQueue,
  markVerified,
  registrationBalancePaise,
  registrationCollectedPaise,
  registrationFeeHeads,
  registrationPayAbsoluteUrl,
  setLeadRegistrationFee,
  takeRegistrationPayment,
  waiveRegistrationFee,
  type AdmissionsState,
  type RegistrationFeePayment,
} from "@/lib/admissions";
import { formatInr, TENDER_MODES, type TenderMode } from "@/lib/fees";
import { type MastersState } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import { SisParentMatchBanner } from "@/components/admissions/SisParentMatchBanner";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";

function waUrl(mobile: string, message: string): string {
  const digits = mobile.replace(/\D/g, "");
  const phone = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

const inp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm";

type SiblingDraft = {
  key: string;
  childName: string;
  classSoughtId: string;
  feeAmountInr: string;
};

function emptySiblingDraft(feeDefault: string): SiblingDraft {
  return {
    key: `sib-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    childName: "",
    classSoughtId: "",
    feeAmountInr: feeDefault,
  };
}

export function AdmissionRegistrationPanel({
  state,
  masters,
  by,
  canEdit,
  onCommit,
  onOpenCrmLead,
}: {
  state: AdmissionsState;
  masters: MastersState;
  by: string;
  canEdit: boolean;
  onCommit: (next: AdmissionsState, msg?: string) => void;
  onOpenCrmLead: (id: string) => void;
}) {
  const queue = useMemo(() => listRegistrationQueue(state), [state]);
  const feeHeads = useMemo(() => registrationFeeHeads(masters), [masters]);
  const classes = useMemo(
    () => (masters.classes ?? []).filter((c) => c.isActive),
    [masters],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    queue.find((l) => l.id === selectedId) ??
    state.leads.find((l) => l.id === selectedId) ??
    null;

  /** After family save — land on take-fee with these sibling lead ids */
  const [collectFocusIds, setCollectFocusIds] = useState<string[]>([]);
  const takeFeeRef = useRef<HTMLDivElement | null>(null);

  const [feeHeadId, setFeeHeadId] = useState(feeHeads[0]?.id || "");
  const [amountInr, setAmountInr] = useState("500");
  const [collectInr, setCollectInr] = useState("");
  const [collectMode, setCollectMode] = useState<TenderMode>("cash");
  const [collectRef, setCollectRef] = useState("");
  const [collectBank, setCollectBank] = useState("");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [lastPayUrl, setLastPayUrl] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [nGuardian, setNGuardian] = useState("");
  const [nMother, setNMother] = useState("");
  const [nMobile, setNMobile] = useState("");
  const [siblings, setSiblings] = useState<SiblingDraft[]>(() => [
    emptySiblingDraft("500"),
  ]);

  const familyFeeTotalPaise = useMemo(
    () =>
      siblings.reduce(
        (s, row) =>
          s + Math.max(0, Math.round(Number(row.feeAmountInr) * 100) || 0),
        0,
      ),
    [siblings],
  );

  useEffect(() => {
    if (selected?.registrationFeeHeadId) {
      setFeeHeadId(selected.registrationFeeHeadId);
    }
    if (selected?.registrationFeeAmountPaise) {
      setAmountInr(String(selected.registrationFeeAmountPaise / 100));
    }
    if (selected) {
      const bal = registrationBalancePaise(state, selected);
      setCollectInr(bal > 0 ? String(bal / 100) : "");
      setCollectRef("");
      setCollectBank("");
      setCollectMode("cash");
    }
  }, [selected?.id]);

  const parentGroups = useMemo(() => {
    if (!selected?.householdId) return [];
    return groupLeadsByParent(state, selected.householdId);
  }, [state, selected?.householdId]);

  const collectedPaise = selected
    ? registrationCollectedPaise(state, selected.id)
    : 0;
  const balancePaise = selected
    ? registrationBalancePaise(state, selected)
    : 0;
  const familySiblings = useMemo(() => {
    if (collectFocusIds.length > 0) {
      return collectFocusIds
        .map((id) => state.leads.find((l) => l.id === id))
        .filter((l): l is NonNullable<typeof l> => !!l);
    }
    if (!selected?.householdId) return [];
    const key = selected.parentGroupKey || selected.mobile;
    return state.leads.filter(
      (l) =>
        l.householdId === selected.householdId &&
        (l.parentGroupKey || l.mobile) === key &&
        (l.stage === "applied" ||
          l.stage === "verified" ||
          l.stage === "enrolled" ||
          l.stage === "enquiry"),
    );
  }, [
    collectFocusIds,
    state.leads,
    selected?.householdId,
    selected?.parentGroupKey,
    selected?.mobile,
  ]);
  const familyFeeDuePaise = useMemo(
    () =>
      familySiblings.reduce(
        (s, l) => s + registrationBalancePaise(state, l),
        0,
      ),
    [familySiblings, state],
  );
  const familyFeeAssignedPaise = useMemo(
    () =>
      familySiblings.reduce((s, l) => s + (l.registrationFeeAmountPaise || 0), 0),
    [familySiblings],
  );
  const leadPayments = useMemo(() => {
    if (!selected) return [];
    return listLeadRegistrationPayments(state, selected.id);
  }, [state, selected?.id]);

  const modeMeta = TENDER_MODES.find((m) => m.value === collectMode);

  const openPayment = useMemo(() => {
    if (!selected?.registrationPaymentId) return null;
    return (
      (state.registrationPayments || []).find(
        (p) => p.id === selected.registrationPaymentId && p.status === "open",
      ) || null
    );
  }, [state.registrationPayments, selected]);

  useEffect(() => {
    if (!openPayment) {
      setQrUrl(null);
      setLastPayUrl(null);
      return;
    }
    const portal = `https://${TENANT.publicPortal}`;
    const url = registrationPayAbsoluteUrl(portal, openPayment);
    setLastPayUrl(url);
    let cancelled = false;
    void QRCode.toDataURL(url, {
      width: 180,
      margin: 1,
      color: { dark: "#203050", light: "#ffffff" },
    }).then((d) => {
      if (!cancelled) setQrUrl(d);
    });
    return () => {
      cancelled = true;
    };
  }, [openPayment?.id]);

  function applyFeeToLead() {
    if (!selected || !canEdit) return;
    const paise = Math.round(Number(amountInr) * 100);
    if (!feeHeadId || paise < 0) return;
    onCommit(
      setLeadRegistrationFee(state, selected.id, feeHeadId, paise),
      "Registration fee set on lead (CRM synced)",
    );
  }

  function onTakeCollect() {
    if (!selected || !canEdit) return;
    const next = setLeadRegistrationFee(
      state,
      selected.id,
      feeHeadId || selected.registrationFeeHeadId,
      Math.round(Number(amountInr) * 100),
    );
    const lead = next.leads.find((l) => l.id === selected.id)!;
    const bal = registrationBalancePaise(next, lead);
    const paise = Math.round(Number(collectInr || amountInr) * 100);
    if (paise <= 0) {
      onCommit(next, "Enter collect amount");
      return;
    }
    if (paise > bal) {
      onCommit(next, `Exceeds balance due ${formatInr(bal)}`);
      return;
    }
    if (modeMeta?.needsRef && !collectRef.trim()) {
      onCommit(next, `${modeMeta.refLabel} required`);
      return;
    }
    const r = takeRegistrationPayment(next, selected.id, by, {
      amountPaise: paise,
      tenders: [
        {
          mode: collectMode,
          amountPaise: paise,
          ref: collectRef.trim(),
          bankName: collectBank.trim(),
          instrumentDate: new Date().toISOString().slice(0, 10),
        },
      ],
    });
    if (!r.ok) {
      onCommit(next, r.reason);
      return;
    }
    const stillDue = registrationBalancePaise(r.state, {
      id: selected.id,
      registrationFeeAmountPaise:
        r.state.leads.find((l) => l.id === selected.id)
          ?.registrationFeeAmountPaise || 0,
    });
    const ledgerNote = r.payment.feeReceiptNo
      ? ` · R ${r.payment.feeReceiptNo}`
      : " · ledger posts on SIS admit";
    setCollectRef("");

    if (stillDue > 0) {
      onCommit(
        r.state,
        `Partial ${r.payment.code} · bal ${formatInr(stillDue)}${ledgerNote}`,
      );
      setCollectInr(String(stillDue / 100));
      return;
    }

    // Advance to next unpaid sibling in this family take-fee session
    const focusIds =
      collectFocusIds.length > 0
        ? collectFocusIds
        : familySiblings.map((l) => l.id);
    const nextUnpaid = focusIds
      .map((id) => r.state.leads.find((l) => l.id === id))
      .find(
        (l) =>
          l &&
          l.id !== selected.id &&
          registrationBalancePaise(r.state, l) > 0 &&
          l.registrationPaymentStatus !== "waived",
      );
    if (nextUnpaid) {
      setSelectedId(nextUnpaid.id);
      setFeeHeadId(nextUnpaid.registrationFeeHeadId || feeHeadId);
      setAmountInr(String(nextUnpaid.registrationFeeAmountPaise / 100));
      setCollectInr(
        String(registrationBalancePaise(r.state, nextUnpaid) / 100),
      );
      onCommit(
        r.state,
        `Fee collected · ${r.payment.code}${ledgerNote} · next: ${nextUnpaid.childName}`,
      );
      window.setTimeout(() => {
        takeFeeRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 60);
    } else {
      setCollectInr("");
      if (collectFocusIds.length > 0) setCollectFocusIds([]);
      onCommit(
        r.state,
        `Fee collected · ${r.payment.code}${ledgerNote}`,
      );
    }
  }

  function onCreateUpi() {
    if (!selected || !canEdit) return;
    const head = feeHeads.find((h) => h.id === feeHeadId);
    const next = setLeadRegistrationFee(
      state,
      selected.id,
      feeHeadId || selected.registrationFeeHeadId,
      Math.round(Number(amountInr) * 100),
    );
    const lead = next.leads.find((l) => l.id === selected.id)!;
    const bal = registrationBalancePaise(next, lead);
    const linkPaise = Math.round(Number(collectInr || String(bal / 100)) * 100);
    const r = createRegistrationUpiLink(
      next,
      selected.id,
      by,
      head?.name || "Registration fee",
      linkPaise > 0 ? linkPaise : bal,
    );
    if (!r.ok) {
      onCommit(next, r.reason);
      return;
    }
    onCommit(
      r.state,
      `UPI link ${r.payment.code} · ${formatInr(r.payment.amountPaise)} — share WhatsApp / QR`,
    );
  }

  function onWhatsApp(payment: RegistrationFeePayment) {
    const url =
      lastPayUrl ||
      registrationPayAbsoluteUrl(`https://${TENANT.publicPortal}`, payment);
    const msg = composeRegistrationWhatsAppMessage(
      payment,
      url,
      TENANT.nameDisplay,
    );
    window.open(
      waUrl(payment.mobile || selected?.mobile || "", msg),
      "_blank",
      "noopener",
    );
  }

  function onCapture() {
    if (!openPayment || !canEdit) return;
    const upi =
      window.prompt(
        `Capture UTR / ref for ${openPayment.code}`,
        openPayment.upiRef || `UPI-${openPayment.code}`,
      ) || "";
    if (!upi.trim()) return;
    const r = captureRegistrationPayment(state, openPayment.id, upi);
    if (!r.ok) {
      onCommit(state, r.reason);
      return;
    }
    const ledgerNote = r.payment.feeReceiptNo
      ? ` · R ${r.payment.feeReceiptNo}`
      : r.payment.ledgerPostedAt
        ? " · ledger updated"
        : " · ledger posts on SIS admit";
    const lead = r.state.leads.find((l) => l.id === selected?.id);
    const still =
      lead != null ? registrationBalancePaise(r.state, lead) : 0;
    onCommit(
      r.state,
      still > 0
        ? `Partial captured · ${r.payment.code} · bal ${formatInr(still)}${ledgerNote}`
        : `Payment captured · ${r.payment.code}${ledgerNote}`,
    );
    const receipt = composeRegistrationReceiptWhatsApp(
      r.payment,
      TENANT.nameDisplay,
      by,
    );
    window.open(
      waUrl(r.payment.mobile || selected?.mobile || "", receipt),
      "_blank",
      "noopener",
    );
  }

  function onWaive() {
    if (!selected || !canEdit) return;
    const reason = window.prompt("Waiver reason?", "Principal waiver") || "";
    const next = waiveRegistrationFee(state, selected.id, reason, by);
    const pay = next.registrationPayments.find(
      (p) => p.id === next.leads.find((l) => l.id === selected.id)?.registrationPaymentId,
    );
    onCommit(
      next,
      pay?.ledgerPostedAt
        ? "Fee waived · cleared on Fee Take ledger (head blocked)"
        : "Fee waived (CRM) · ledger clears on SIS admit",
    );
  }

  function onVerify() {
    if (!selected || !canEdit) return;
    const r = markVerified(state, selected.id);
    if (!r.ok) {
      onCommit(state, r.reason);
      return;
    }
    onCommit(r.state, "Verified");
  }

  function onAdmit() {
    if (!selected || !canEdit) return;
    const paid =
      selected.registrationPaymentStatus === "paid" ||
      selected.registrationPaymentStatus === "waived" ||
      selected.registrationFeePaid;
    if (!paid) {
      onCommit(
        state,
        "Take registration fee first (or waive), then Send to student record",
      );
      return;
    }
    const r = enrollLead(state, selected.id, by, masters);
    if (!r.ok) {
      onCommit(state, r.reason);
      return;
    }
    onCommit(
      r.state,
      `Sent to Students · Adm ${r.admissionNo} · ${r.srn} · admission ${r.admissionDate}`,
    );
    setSelectedId(null);
  }

  function onSaveNew() {
    if (!canEdit) return;
    const head = feeHeads.find((h) => h.id === feeHeadId);
    const savedHeadId = feeHeadId || head?.id || "";
    const r = createFamilyRegistrationsFromDesk(
      state,
      {
        guardianName: nGuardian,
        motherName: nMother,
        mobile: nMobile,
        source: "walk_in",
        feeHeadName: head?.name || "Registration fee",
        children: siblings.map((row) => ({
          childName: row.childName,
          classSoughtId: row.classSoughtId,
          feeHeadId: savedHeadId,
          feeAmountPaise: Math.max(
            0,
            Math.round(Number(row.feeAmountInr) * 100) || 0,
          ),
        })),
      },
      by,
    );
    if (!r.ok) {
      onCommit(state, r.reason);
      return;
    }
    const names = r.leads.map((l) => l.childName).join(", ");
    onCommit(
      r.state,
      r.leads.length > 1
        ? `Family registered (${names}) · take fee now · total ${formatInr(r.totalFeePaise)}`
        : `Registered ${r.leads[0]?.enquiryNo} · take fee now`,
    );
    setNGuardian("");
    setNMother("");
    setNMobile("");
    setSiblings([emptySiblingDraft(amountInr || "500")]);

    const first = r.leads[0];
    const headId = first?.registrationFeeHeadId || savedHeadId;
    setFeeHeadId(headId);
    setCollectFocusIds(r.leads.map((l) => l.id));
    setSelectedId(first?.id || null);
    setShowNew(false);
    if (first && first.registrationFeeAmountPaise > 0) {
      setAmountInr(String(first.registrationFeeAmountPaise / 100));
      setCollectInr(String(first.registrationFeeAmountPaise / 100));
    }
    setCollectMode("cash");
    setCollectRef("");
    setCollectBank("");
    window.setTimeout(() => {
      takeFeeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  function patchSibling(key: string, patch: Partial<SiblingDraft>) {
    setSiblings((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addSiblingRow() {
    setSiblings((rows) => [...rows, emptySiblingDraft(amountInr || "500")]);
  }

  function removeSiblingRow(key: string) {
    setSiblings((rows) =>
      rows.length <= 1 ? rows : rows.filter((r) => r.key !== key),
    );
  }

  function applyDefaultFeeToAll() {
    setSiblings((rows) =>
      rows.map((row) => ({ ...row, feeAmountInr: amountInr || "0" })),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[var(--muted)]">
          <strong>1. Take registration</strong> (fee) →{" "}
          <strong>2. Send to student record</strong> (SIS gets Admission no. +
          SRN + today’s admission date). Same house / different parents stay
          parent-wise siblings.
        </p>
        {canEdit ? (
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
            onClick={() => setShowNew((v) => !v)}
          >
            {showNew ? "Close form" : "+ New family registration"}
          </button>
        ) : null}
      </div>

      {showNew ? (
        <MastersWorkCard
          title="New registration — family / siblings"
          hint="One parent can register multiple children. Each child is a separate Registered lead with its own registration fee."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Parent / guardian *
              <input
                className={`${inp} mt-1`}
                value={nGuardian}
                onChange={(e) => setNGuardian(e.target.value)}
                placeholder="Father, mother, or guardian"
              />
            </label>
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Other parent (optional)
              <input
                className={`${inp} mt-1`}
                value={nMother}
                onChange={(e) => setNMother(e.target.value)}
                placeholder="Leave blank for single parent"
              />
            </label>
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Mobile * (parent key)
              <input
                className={`${inp} mt-1`}
                inputMode="numeric"
                maxLength={10}
                value={nMobile}
                onChange={(e) =>
                  setNMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
                }
              />
            </label>
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Default fee head
              <select
                className={`${inp} mt-1`}
                value={feeHeadId}
                onChange={(e) => setFeeHeadId(e.target.value)}
              >
                {feeHeads.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.code})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
            <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
              Children · fee per student
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] font-semibold text-[var(--muted)]">
                Default fee ₹
                <input
                  className={`${inp} mt-1 w-28`}
                  inputMode="decimal"
                  value={amountInr}
                  onChange={(e) => setAmountInr(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold"
                onClick={applyDefaultFeeToAll}
              >
                Apply to all
              </button>
            </div>
          </div>

          <div className="mt-2 space-y-2">
            {siblings.map((row, idx) => (
              <div
                key={row.key}
                className="grid gap-2 rounded-lg border border-[rgba(32,48,80,0.1)] bg-white p-2 sm:grid-cols-12 sm:items-end"
              >
                <div className="sm:col-span-1">
                  <span className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                    #{idx + 1}
                  </span>
                </div>
                <label className="text-[11px] font-semibold text-[var(--muted)] sm:col-span-4">
                  Child name *
                  <input
                    className={`${inp} mt-1`}
                    value={row.childName}
                    onChange={(e) =>
                      patchSibling(row.key, { childName: e.target.value })
                    }
                  />
                </label>
                <label className="text-[11px] font-semibold text-[var(--muted)] sm:col-span-3">
                  Class *
                  <select
                    className={`${inp} mt-1`}
                    value={row.classSoughtId}
                    onChange={(e) =>
                      patchSibling(row.key, {
                        classSoughtId: e.target.value,
                      })
                    }
                  >
                    <option value="">Select…</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-[var(--muted)] sm:col-span-2">
                  Fee ₹ *
                  <input
                    className={`${inp} mt-1`}
                    inputMode="decimal"
                    value={row.feeAmountInr}
                    onChange={(e) =>
                      patchSibling(row.key, { feeAmountInr: e.target.value })
                    }
                  />
                </label>
                <div className="flex items-end sm:col-span-2">
                  {siblings.length > 1 ? (
                    <button
                      type="button"
                      className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold text-[#9a3412]"
                      onClick={() => removeSiblingRow(row.key)}
                    >
                      Remove
                    </button>
                  ) : (
                    <span className="pb-2 text-[10px] text-[var(--muted)]">
                      Min. 1
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold"
              onClick={addSiblingRow}
            >
              + Add sibling
            </button>
            <p className="text-[13px] font-semibold text-[var(--brand-deep)]">
              {siblings.filter((s) => s.childName.trim()).length ||
                siblings.length}{" "}
              student
              {(siblings.filter((s) => s.childName.trim()).length ||
                siblings.length) === 1
                ? ""
                : "s"}{" "}
              · total registration fee{" "}
              <span className="text-[#0f766e]">
                {formatInr(familyFeeTotalPaise)}
              </span>
            </p>
          </div>

          <div className="mt-3">
            <SisParentMatchBanner
              guardianName={nGuardian}
              motherName={nMother}
              mobile={nMobile}
            />
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg bg-[#0f766e] px-3 py-2 text-[11px] font-semibold text-white"
            onClick={onSaveNew}
          >
            Save & take fee →
          </button>
        </MastersWorkCard>
      ) : null}

      {selected && collectFocusIds.length > 0 ? (
        <div
          ref={takeFeeRef}
          className="rounded-xl border border-[rgba(15,118,110,0.35)] bg-[rgba(15,118,110,0.08)] px-3 py-2 text-[12px]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-[var(--brand-deep)]">
              Take registration fee now ·{" "}
              {collectFocusIds.length} student
              {collectFocusIds.length === 1 ? "" : "s"} · head pre-selected ·
              collect per child
            </p>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] bg-white px-2.5 py-1 text-[11px] font-semibold"
              onClick={() => setCollectFocusIds([])}
            >
              Show full queue
            </button>
          </div>
        </div>
      ) : null}

      {!(selected && collectFocusIds.length > 0) ? (
      <MastersTableCard title="Registration queue — from Lead CRM">
        {queue.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
            No Registered / Verified leads — Register from Lead CRM or use New registration.
          </div>
        ) : (
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2">Lead no.</th>
                <th className="px-3 py-2">Child</th>
                <th className="px-3 py-2">Parent / mobile</th>
                <th className="px-3 py-2">Fee</th>
                <th className="px-3 py-2">Payment</th>
                <th className="px-3 py-2">House / siblings</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {queue.map((l) => {
                const hh = householdOf(state, l.householdId);
                const groups = l.householdId
                  ? groupLeadsByParent(state, l.householdId)
                  : [];
                const active = selectedId === l.id;
                return (
                  <tr
                    key={l.id}
                    className={`cursor-pointer ${
                      active ? "bg-[rgba(21,128,61,0.12)]" : ""
                    }`}
                    onClick={() => {
                      setCollectFocusIds([]);
                      setSelectedId(l.id);
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-[12px]">
                      {l.enquiryNo}
                      <div className="text-[10px] text-[var(--muted)]">
                        {l.applicationNo || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium text-[var(--brand-deep)]">
                      {l.childName}
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      {l.guardianName}
                      <div className="text-[10px] text-[var(--muted)]">
                        {l.mobile}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      {l.registrationFeeAmountPaise > 0
                        ? formatInr(l.registrationFeeAmountPaise)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-[11px] font-semibold">
                      {l.registrationPaymentStatus === "paid" ? (
                        <span className="text-[#15803d]">Paid</span>
                      ) : l.registrationPaymentStatus === "partial" ? (
                        <span className="text-[#9a3412]">Partial</span>
                      ) : l.registrationPaymentStatus === "pending" ? (
                        <span className="text-[#9a3412]">Pending UPI</span>
                      ) : l.registrationPaymentStatus === "waived" ? (
                        <span className="text-[var(--muted)]">Waived</span>
                      ) : (
                        <span className="text-[var(--muted)]">Unpaid</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[var(--muted)]">
                      {hh?.code || "—"}
                      {groups.length > 1 ? (
                        <div className="text-[#9a3412]">
                          {groups.length} parent groups
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        )}
      </MastersTableCard>
      ) : null}

      {selected ? (
        <div className="space-y-4" ref={collectFocusIds.length === 0 ? takeFeeRef : undefined}>
          <MastersWorkCard
            title={`1 · Take registration — ${selected.childName}`}
            hint={
              collectFocusIds.length > 0
                ? "Fee head & amount pre-filled from registration · collect now (partial OK) · then next sibling"
                : "Any mode · partial OK · receipts post as R-series on ledger / daybook (Fee Take uses F)"
            }
          >
            <div className="mb-3">
              <SisParentMatchBanner
                guardianName={selected.guardianName}
                motherName={selected.motherName}
                mobile={selected.mobile}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-[11px] font-semibold text-[var(--muted)]">
                Fee head
                <select
                  className={`${inp} mt-1`}
                  disabled={!canEdit}
                  value={feeHeadId}
                  onChange={(e) => setFeeHeadId(e.target.value)}
                >
                  {feeHeads.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-semibold text-[var(--muted)]">
                Full fee (₹)
                <input
                  className={`${inp} mt-1`}
                  disabled={!canEdit}
                  value={amountInr}
                  onChange={(e) => setAmountInr(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold"
                      onClick={applyFeeToLead}
                    >
                      Save fee → CRM
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold"
                      onClick={onWaive}
                    >
                      Waive fee
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            <p className="mt-3 text-[12px]">
              Fee status:{" "}
              <strong
                className={
                  selected.registrationPaymentStatus === "paid" ||
                  selected.registrationFeePaid
                    ? "text-[#15803d]"
                    : selected.registrationPaymentStatus === "waived"
                      ? "text-[var(--muted)]"
                      : "text-[#9a3412]"
                }
              >
                {selected.registrationPaymentStatus === "paid" ||
                selected.registrationFeePaid
                  ? "Paid"
                  : selected.registrationPaymentStatus === "waived"
                    ? "Waived"
                    : selected.registrationPaymentStatus === "partial"
                      ? "Partial"
                      : selected.registrationPaymentStatus === "pending"
                        ? "Pending UPI"
                        : "Not taken"}
              </strong>
              {selected.registrationFeeAmountPaise > 0 ? (
                <span className="text-[var(--muted)]">
                  {" "}
                  · this student {formatInr(selected.registrationFeeAmountPaise)}
                  {collectedPaise > 0
                    ? ` · received ${formatInr(collectedPaise)}`
                    : ""}
                  {balancePaise > 0 &&
                  selected.registrationPaymentStatus !== "waived"
                    ? ` · due ${formatInr(balancePaise)}`
                    : ""}
                </span>
              ) : null}
              {selected.registrationFeeNote
                ? ` · ${selected.registrationFeeNote}`
                : ""}
            </p>

            {familySiblings.length > 1 ? (
              <div className="mt-2 rounded-lg border border-[rgba(15,118,110,0.25)] bg-[rgba(15,118,110,0.06)] px-3 py-2 text-[12px]">
                <strong className="text-[var(--brand-deep)]">
                  Family · {familySiblings.length} siblings
                </strong>
                <span className="text-[var(--muted)]">
                  {" "}
                  · assigned {formatInr(familyFeeAssignedPaise)}
                  {familyFeeDuePaise > 0
                    ? ` · still due ${formatInr(familyFeeDuePaise)}`
                    : " · all registration fees cleared"}
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {familySiblings.map((sib) => (
                    <button
                      key={sib.id}
                      type="button"
                      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        sib.id === selected.id
                          ? "bg-[var(--brand-deep)] text-white"
                          : "border border-[rgba(32,48,80,0.15)] bg-white"
                      }`}
                      onClick={() => setSelectedId(sib.id)}
                    >
                      {sib.childName} ·{" "}
                      {formatInr(sib.registrationFeeAmountPaise)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {canEdit &&
            balancePaise > 0 &&
            selected.registrationPaymentStatus !== "waived" ? (
              <div className="mt-4 grid gap-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.03)] p-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-[11px] font-semibold text-[var(--muted)]">
                  Collect now (₹)
                  <input
                    className={`${inp} mt-1`}
                    value={collectInr}
                    onChange={(e) => setCollectInr(e.target.value)}
                    placeholder={String(balancePaise / 100)}
                  />
                </label>
                <label className="text-[11px] font-semibold text-[var(--muted)]">
                  Mode
                  <select
                    className={`${inp} mt-1`}
                    value={collectMode}
                    onChange={(e) =>
                      setCollectMode(e.target.value as TenderMode)
                    }
                  >
                    {TENDER_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-[var(--muted)]">
                  {modeMeta?.refLabel || "Ref"}
                  <input
                    className={`${inp} mt-1`}
                    value={collectRef}
                    onChange={(e) => setCollectRef(e.target.value)}
                    placeholder={modeMeta?.needsRef ? "Required" : "Optional"}
                  />
                </label>
                {modeMeta?.needsBank ? (
                  <label className="text-[11px] font-semibold text-[var(--muted)]">
                    Bank
                    <input
                      className={`${inp} mt-1`}
                      value={collectBank}
                      onChange={(e) => setCollectBank(e.target.value)}
                    />
                  </label>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
                      onClick={onTakeCollect}
                    >
                      Collect
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-[#0f766e] px-3 py-2 text-[11px] font-semibold text-white"
                      onClick={onCreateUpi}
                    >
                      QR + WhatsApp
                    </button>
                  </div>
                )}
                {modeMeta?.needsBank ? (
                  <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
                      onClick={onTakeCollect}
                    >
                      Collect
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-[#0f766e] px-3 py-2 text-[11px] font-semibold text-white"
                      onClick={onCreateUpi}
                    >
                      QR + WhatsApp (this amount)
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {leadPayments.length > 0 ? (
              <ErpTableShell className="mt-3 overflow-x-auto">
                <ErpTable className="text-[11px]">
                  <ErpTableHead>
                    <tr>
                      <th className="px-2 py-1.5 font-semibold">Code</th>
                      <th className="px-2 py-1.5 font-semibold">Amount</th>
                      <th className="px-2 py-1.5 font-semibold">Mode</th>
                      <th className="px-2 py-1.5 font-semibold">Status</th>
                      <th className="px-2 py-1.5 font-semibold">R receipt</th>
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {leadPayments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-2 py-1.5 font-mono">{p.code}</td>
                        <td className="px-2 py-1.5">{formatInr(p.amountPaise)}</td>
                        <td className="px-2 py-1.5">
                          {p.tenders?.length
                            ? p.tenders
                                .map((t) => t.mode.toUpperCase())
                                .join("+")
                            : p.mode}
                        </td>
                        <td className="px-2 py-1.5">{p.status}</td>
                        <td className="px-2 py-1.5 font-mono">
                          {p.feeReceiptNo || "—"}
                        </td>
                      </tr>
                    ))}
                  </ErpTableBody>
                </ErpTable>
              </ErpTableShell>
            ) : null}

            {openPayment ? (
              <div className="mt-4 flex flex-wrap gap-4 rounded-xl border border-[rgba(15,118,110,0.25)] bg-[rgba(15,118,110,0.06)] p-3">
                {qrUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrUrl}
                    alt="Registration fee QR"
                    className="h-[140px] w-[140px] rounded-lg bg-white"
                  />
                ) : null}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
                    {openPayment.code} · {formatInr(openPayment.amountPaise)} ·
                    pending
                  </p>
                  <p className="break-all font-mono text-[11px] text-[var(--muted)]">
                    {lastPayUrl}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-[#15803d] px-3 py-1.5 text-[11px] font-semibold text-white"
                      onClick={() => onWhatsApp(openPayment)}
                    >
                      WhatsApp to parent
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white"
                      onClick={onCapture}
                    >
                      Capture payment
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </MastersWorkCard>

          <MastersWorkCard
            title="2 · Send to student record"
            hint="Creates the student in Students (SIS) with Admission no., SRN, and admission date = today (send date). Parent-wise household for siblings."
          >
            {parentGroups.length > 1 ? (
              <p className="mb-3 rounded-lg border border-[rgba(180,83,9,0.35)] bg-[rgba(180,83,9,0.08)] px-3 py-2 text-[12px] text-[#9a3412]">
                This house has {parentGroups.length} parent groups — send creates
                / joins the SIS household for{" "}
                <strong>
                  {selected.guardianName} ({selected.mobile})
                </strong>{" "}
                only.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {canEdit && selected.stage === "applied" ? (
                <button
                  type="button"
                  className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold"
                  onClick={onVerify}
                >
                  Verify docs
                </button>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  className="rounded-lg bg-[#166534] px-4 py-2.5 text-[12px] font-semibold text-white"
                  onClick={onAdmit}
                >
                  Send to student record
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold"
                onClick={() => onOpenCrmLead(selected.id)}
              >
                View in Lead CRM
              </button>
              {selected.studentId ? (
                <a
                  href={`/students/${selected.studentId}/edit`}
                  className="rounded-lg border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-deep)]"
                >
                  Open student →
                </a>
              ) : null}
            </div>
          </MastersWorkCard>

          {parentGroups.length > 0 ? (
            <MastersWorkCard
              title="Parent-wise siblings (same house)"
              hint="Different guardian mobiles → separate SIS households; same parent share siblings."
            >
              <div className="space-y-3">
                {parentGroups.map((g) => (
                  <div
                    key={g.parentKey}
                    className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-white px-3 py-2"
                  >
                    <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
                      {g.guardianName} · {g.mobile || "no mobile"}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
                      {g.leads.map((l) => (
                        <li key={l.id}>
                          {l.childName} · {l.enquiryNo} · {l.stage}
                          {l.id === selected.id ? " · selected" : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </MastersWorkCard>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
