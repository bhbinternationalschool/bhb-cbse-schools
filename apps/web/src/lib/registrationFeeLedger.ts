/**
 * Post registration fee (paid / waived) into Fee Take student ledger.
 * Paid installments use R/{ay}/#### receipts (daybook series R).
 * Remainder stays due until fully paid — no auto-waiver on partial.
 */

import type {
  AdmissionLead,
  AdmissionsState,
  RegistrationFeePayment,
  RegistrationTender,
} from "@/lib/admissions";
import { createFeeAdjustment } from "@/lib/feeAdjustments";
import {
  collectPayment,
  computeStudentDues,
  loadFees,
  tenderModeLabel,
  voucherLineFromDue,
  type CollectionVoucher,
  type FeeDueLine,
  type TenderMode,
  type VoucherTender,
} from "@/lib/fees";
import { loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function findRegistrationDue(
  dues: FeeDueLine[],
  feeHeadId: string,
): FeeDueLine | null {
  const open = dues.filter((d) => d.balancePaise > 0);
  if (feeHeadId) {
    const hit = open.find((d) => d.feeHeadId === feeHeadId);
    if (hit) return hit;
  }
  const masters = loadMasters();
  const head = masters.feeHeads.find((h) => h.id === feeHeadId);
  const code = (head?.code || "").toUpperCase();
  const name = (head?.nameEn || "").toLowerCase();
  const byMeta = open.find((d) => {
    const h = masters.feeHeads.find((x) => x.id === d.feeHeadId);
    if (!h) return false;
    if (code && h.code.toUpperCase() === code) return true;
    if (
      /admis|registr/i.test(h.code) ||
      /admis|registr/i.test(h.nameEn || "")
    ) {
      return true;
    }
    if (name && (h.nameEn || "").toLowerCase().includes(name)) return true;
    return false;
  });
  if (byMeta) return byMeta;
  return (
    open.find(
      (d) =>
        /admis|registr/i.test(d.feeHeadName) ||
        /admis|registr/i.test(d.label),
    ) || null
  );
}

function ensureDueForHead(
  studentId: string,
  feeHeadId: string,
  feeHeadName: string,
  amountPaise: number,
  by: string,
  ay: string,
): FeeDueLine | null {
  const amount = Math.max(0, Math.round(amountPaise));
  if (amount <= 0) return null;
  const adj = createFeeAdjustment({
    studentId,
    type: "adhoc",
    label: feeHeadName || "Registration fee",
    amountPaise: amount,
    reasonCode: "other",
    reason: "Registration fee billed from admissions for ledger / Fee Take",
    createdBy: by,
    feeHeadId: feeHeadId || null,
    dueOn: todayYmd(),
    academicYearCode: ay,
  });
  if (!adj.ok) return null;
  const masters = loadMasters();
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === studentId);
  if (!student) return null;
  const dues = computeStudentDues(student, masters, loadFees());
  return dues.find((d) => d.dueKey === `adj:${adj.adjustment.id}`) || null;
}

function isTenderMode(v: string): v is TenderMode {
  return (
    v === "cash" ||
    v === "upi" ||
    v === "card" ||
    v === "cheque" ||
    v === "rtgs" ||
    v === "neft" ||
    v === "imps" ||
    v === "bank"
  );
}

function registrationTendersToVoucher(
  payment: RegistrationFeePayment,
  collectAmount: number,
): VoucherTender[] {
  const paidOn = (payment.paidAt || todayYmd()).slice(0, 10);
  const fromRows: RegistrationTender[] =
    payment.tenders?.length > 0
      ? payment.tenders
      : [
          {
            mode:
              payment.mode === "counter"
                ? "cash"
                : payment.mode === "upi_link"
                  ? "upi"
                  : isTenderMode(payment.mode)
                    ? payment.mode
                    : "cash",
            amountPaise: collectAmount,
            ref: payment.upiRef || payment.code,
            bankName: "",
            instrumentDate: paidOn,
          },
        ];

  const mapped = fromRows
    .map((t) => ({
      mode: isTenderMode(t.mode) ? t.mode : ("cash" as TenderMode),
      amountPaise: Math.max(0, Math.round(t.amountPaise || 0)),
      ref: t.ref || payment.upiRef || payment.code,
      bankName: t.bankName || "",
      instrumentDate: (t.instrumentDate || paidOn).slice(0, 10),
      realisation: "cleared" as const,
    }))
    .filter((t) => t.amountPaise > 0);

  if (mapped.length === 0) {
    return [
      {
        mode: "cash",
        amountPaise: collectAmount,
        ref: payment.upiRef || payment.code,
        bankName: "",
        instrumentDate: paidOn,
        realisation: "cleared",
      },
    ];
  }

  const sum = mapped.reduce((s, t) => s + t.amountPaise, 0);
  if (sum === collectAmount) return mapped;

  // Scale / clamp to collectAmount if CRM tenders differ slightly
  const scale = collectAmount / sum;
  let running = 0;
  return mapped.map((t, i) => {
    if (i === mapped.length - 1) {
      return { ...t, amountPaise: collectAmount - running };
    }
    const amt = Math.round(t.amountPaise * scale);
    running += amt;
    return { ...t, amountPaise: amt };
  });
}

export type RegistrationLedgerResult = {
  payment: RegistrationFeePayment;
  voucher?: CollectionVoucher;
  dueKey: string;
  cleared: "paid" | "waived" | "already" | "skipped";
  detail: string;
};

/**
 * Sync one registration payment into the student fee ledger.
 * Idempotent when feeVoucherId / ledgerDueKey already set for paid path.
 */
export function postRegistrationFeeToStudentLedger(
  state: AdmissionsState,
  lead: AdmissionLead,
  payment: RegistrationFeePayment,
  by: string,
):
  | { ok: true; state: AdmissionsState; result: RegistrationLedgerResult }
  | { ok: false; reason: string } {
  if (!lead.studentId) {
    return {
      ok: false,
      reason: "Admit student to SIS first — ledger posts on enroll or after",
    };
  }
  if (payment.status !== "paid" && payment.status !== "waived") {
    return { ok: false, reason: "Payment is not paid or waived" };
  }
  if (payment.feeVoucherId || payment.ledgerPostedAt) {
    return {
      ok: true,
      state,
      result: {
        payment,
        dueKey: payment.ledgerDueKey || "",
        cleared: "already",
        detail: payment.feeReceiptNo
          ? `Already on ledger · ${payment.feeReceiptNo}`
          : "Already posted to ledger",
      },
    };
  }

  const sis = loadSis();
  const student = sis.students.find((s) => s.id === lead.studentId);
  if (!student) return { ok: false, reason: "SIS student not found" };
  if (!student.householdId) {
    return { ok: false, reason: "Student has no fee household" };
  }

  const masters = loadMasters();
  const ay = student.academicYearCode || lead.academicYearCode || "";
  let dues = computeStudentDues(student, masters, loadFees(), {
    includePaid: true,
  });

  const feeHeadId = payment.feeHeadId || lead.registrationFeeHeadId;
  let due = findRegistrationDue(
    dues.filter((d) => d.balancePaise > 0),
    feeHeadId,
  );

  // Prefer an open matching head; create full-fee due so partials leave balance
  if (!due) {
    const paidMatch = dues.find(
      (d) =>
        d.balancePaise <= 0 &&
        d.paidPaise > 0 &&
        (d.feeHeadId === feeHeadId ||
          /admis|registr/i.test(d.feeHeadName) ||
          /admis|registr/i.test(d.label)),
    );
    if (payment.status === "waived" && paidMatch) {
      const marked = patchPayment(state, payment.id, {
        ledgerDueKey: paidMatch.dueKey,
        ledgerPostedAt: new Date().toISOString(),
        note: [payment.note, "Head already clear on Fee Take"]
          .filter(Boolean)
          .join(" · "),
      });
      return {
        ok: true,
        state: marked,
        result: {
          payment: marked.registrationPayments.find((p) => p.id === payment.id)!,
          dueKey: paidMatch.dueKey,
          cleared: "already",
          detail: "Fee Take already shows this head as paid",
        },
      };
    }
    due = ensureDueForHead(
      student.id,
      feeHeadId,
      payment.feeHeadName || "Registration fee",
      paidMatch
        ? payment.amountPaise || lead.registrationFeeAmountPaise
        : lead.registrationFeeAmountPaise > 0
          ? lead.registrationFeeAmountPaise
          : payment.amountPaise,
      by,
      ay,
    );
    if (!due) {
      return { ok: false, reason: "Could not create registration due on ledger" };
    }
  }

  if (payment.status === "waived" || payment.mode === "waived") {
    const waive = createFeeAdjustment({
      studentId: student.id,
      type: "waiver",
      dueKey: due.dueKey,
      label: `${due.feeHeadName} · registration waived`,
      amountPaise: due.balancePaise,
      reasonCode: "management",
      reason: `Registration fee waived · ${payment.code}`,
      createdBy: by,
      feeHeadId: due.feeHeadId || feeHeadId || null,
      academicYearCode: ay,
    });
    if (!waive.ok) return { ok: false, reason: waive.error };
    if (waive.adjustment.status !== "posted") {
      return {
        ok: false,
        reason: "Waiver needs Principal approval — post from Fee Adjustments",
      };
    }
    const next = patchPayment(state, payment.id, {
      ledgerDueKey: due.dueKey,
      ledgerPostedAt: new Date().toISOString(),
      note: [payment.note, `Ledger waiver ${due.dueKey}`].filter(Boolean).join(" · "),
    });
    return {
      ok: true,
      state: next,
      result: {
        payment: next.registrationPayments.find((p) => p.id === payment.id)!,
        dueKey: due.dueKey,
        cleared: "waived",
        detail: "Waived on student ledger — head blocked in Fee Take",
      },
    };
  }

  // Paid installment → R-series collection voucher (remainder stays due)
  const collectAmount = Math.min(
    due.balancePaise,
    payment.amountPaise > 0 ? payment.amountPaise : due.balancePaise,
  );
  if (collectAmount <= 0) {
    return { ok: false, reason: "Nothing left to collect on this head" };
  }
  const line = {
    ...voucherLineFromDue(due, student.fullName || lead.childName),
    amountPaise: collectAmount,
  };
  const tenders = registrationTendersToVoucher(payment, collectAmount);
  const modeNote = tenders
    .map((t) => `${tenderModeLabel(t.mode)} ${(t.amountPaise / 100).toFixed(0)}`)
    .join(" + ");
  const collected = collectPayment({
    householdId: student.householdId,
    lines: [line],
    tenders,
    cashierName: by || payment.createdBy || "Registration",
    note: `Registration ${payment.code} · ${modeNote} · admissions`,
    academicYearCode: ay,
    collectionDate: (payment.paidAt || todayYmd()).slice(0, 10),
    transactionDate: (payment.paidAt || todayYmd()).slice(0, 10),
    transactionId: payment.upiRef || payment.code,
    source: "payment_link",
    receiptSeries: "R",
    allowDuplicate: true,
    allowBackdate: true,
  });
  if (!collected.ok) return { ok: false, reason: collected.error };

  const next = patchPayment(state, payment.id, {
    feeVoucherId: collected.voucher.id,
    feeReceiptNo: collected.voucher.receiptNo,
    ledgerDueKey: due.dueKey,
    ledgerPostedAt: new Date().toISOString(),
    note: [
      payment.note,
      `R receipt ${collected.voucher.receiptNo}`,
    ]
      .filter(Boolean)
      .join(" · "),
  });

  const remainder = due.balancePaise - collectAmount;
  return {
    ok: true,
    state: next,
    result: {
      payment: next.registrationPayments.find((p) => p.id === payment.id)!,
      voucher: collected.voucher,
      dueKey: due.dueKey,
      cleared: "paid",
      detail:
        remainder > 0
          ? `Posted R receipt ${collected.voucher.receiptNo} · bal due ₹${(remainder / 100).toFixed(0)}`
          : `Posted R receipt ${collected.voucher.receiptNo} — head cleared in Fee Take`,
    },
  };
}

function patchPayment(
  state: AdmissionsState,
  paymentId: string,
  patch: Partial<RegistrationFeePayment>,
): AdmissionsState {
  return {
    ...state,
    registrationPayments: (state.registrationPayments || []).map((p) =>
      p.id === paymentId ? { ...p, ...patch } : p,
    ),
  };
}

/**
 * Post unposted paid/waived registration rows for a lead.
 * Works for partials (does not require registrationFeePaid).
 */
export function syncLeadRegistrationToLedger(
  state: AdmissionsState,
  leadId: string,
  by: string,
  preferPaymentId?: string,
): {
  state: AdmissionsState;
  result: RegistrationLedgerResult | null;
  reason?: string;
} {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead?.studentId) {
    return { state, result: null, reason: "No SIS student yet" };
  }

  const candidates = (state.registrationPayments || []).filter(
    (p) =>
      p.leadId === leadId &&
      (p.status === "paid" || p.status === "waived") &&
      !p.feeVoucherId &&
      !p.ledgerPostedAt,
  );

  if (preferPaymentId) {
    const pref = candidates.find((p) => p.id === preferPaymentId);
    if (pref) {
      const r = postRegistrationFeeToStudentLedger(state, lead, pref, by);
      if (!r.ok) return { state, result: null, reason: r.reason };
      // Continue posting any other pending installments
      return syncLeadRegistrationToLedger(r.state, leadId, by);
    }
  }

  if (candidates.length === 0) {
    const anyPosted = (state.registrationPayments || []).some(
      (p) =>
        p.leadId === leadId &&
        (p.feeVoucherId || p.ledgerPostedAt) &&
        (p.status === "paid" || p.status === "waived"),
    );
    if (anyPosted) {
      return { state, result: null, reason: "Already synced" };
    }
    return { state, result: null, reason: "No registration payment row to post" };
  }

  let next = state;
  let last: RegistrationLedgerResult | null = null;
  for (const payment of candidates) {
    const r = postRegistrationFeeToStudentLedger(next, lead, payment, by);
    if (!r.ok) {
      return { state: next, result: last, reason: r.reason };
    }
    next = r.state;
    last = r.result;
  }
  return { state: next, result: last };
}
