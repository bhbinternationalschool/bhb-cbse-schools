"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import {
  buildSchoolUpiPayUri,
  captureRegistrationPayment,
  composeRegistrationReceiptWhatsApp,
  createFamilyRegistrationsFromPublic,
  createRegistrationUpiLink,
  loadAdmissions,
  registrationBalancePaise,
  registrationFeeHeads,
  resolveSchoolCollectionsUpi,
  saveAdmissions,
  whatsAppUrl,
  type AdmissionLead,
} from "@/lib/admissions";
import { formatInr } from "@/lib/fees";
import { loadMasters } from "@/lib/masters";
import { TENANT } from "@/lib/types";

const inp =
  "w-full rounded-xl border border-[rgba(32,48,80,0.18)] bg-white px-3 py-3 text-base";

type ChildRow = {
  key: string;
  childName: string;
  classSoughtId: string;
  feeInr: string;
};

function emptyChild(fee: string): ChildRow {
  return {
    key: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    childName: "",
    classSoughtId: "",
    feeInr: fee,
  };
}

export function PublicFamilyRegisterForm({
  initialSrc,
}: {
  initialSrc?: string | null;
}) {
  const masters = useMemo(() => loadMasters(), []);
  const feeHeads = useMemo(() => registrationFeeHeads(masters), [masters]);
  const classes = useMemo(
    () => (masters.classes ?? []).filter((c) => c.isActive),
    [masters],
  );
  const { vpa, payeeName } = useMemo(
    () => resolveSchoolCollectionsUpi(masters),
    [masters],
  );
  const defaultFee = "500";
  const feeHeadId = feeHeads[0]?.id || "";

  const [guardianName, setGuardianName] = useState("");
  const [motherName, setMotherName] = useState("");
  const [mobile, setMobile] = useState("");
  const [children, setChildren] = useState<ChildRow[]>(() => [
    emptyChild(defaultFee),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "pay" | "done">("form");
  const [leadIds, setLeadIds] = useState<string[]>([]);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [upiQr, setUpiQr] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState("");
  const [paymentCode, setPaymentCode] = useState("");
  const [utr, setUtr] = useState("");

  const totalPaise = useMemo(
    () =>
      children.reduce(
        (s, c) => s + Math.max(0, Math.round(Number(c.feeInr) * 100) || 0),
        0,
      ),
    [children],
  );

  const activeLead = useMemo(() => {
    if (!activeLeadId) return null;
    return loadAdmissions().leads.find((l) => l.id === activeLeadId) || null;
  }, [activeLeadId, step, paymentId]);

  async function preparePayForLead(lead: AdmissionLead) {
    const state = loadAdmissions();
    const bal = registrationBalancePaise(state, lead);
    if (bal <= 0) {
      const nextUnpaid = leadIds
        .map((id) => state.leads.find((l) => l.id === id))
        .find((l) => l && registrationBalancePaise(state, l) > 0);
      if (nextUnpaid) {
        setActiveLeadId(nextUnpaid.id);
        await preparePayForLead(nextUnpaid);
        return;
      }
      setStep("done");
      return;
    }
    const link = createRegistrationUpiLink(
      state,
      lead.id,
      "Parent self-register",
      feeHeads[0]?.name || "Registration fee",
      bal,
    );
    if (!link.ok) {
      setError(link.reason);
      return;
    }
    saveAdmissions(link.state);
    setPaymentId(link.payment.id);
    setPaymentCode(link.payment.code);
    setActiveLeadId(lead.id);
    const uri = buildSchoolUpiPayUri({
      vpa,
      payeeName,
      amountPaise: bal,
      note: `${link.payment.code} ${lead.childName}`.trim(),
    });
    const qr = await QRCode.toDataURL(uri, {
      width: 200,
      margin: 1,
      color: { dark: "#203050", light: "#ffffff" },
    });
    setUpiQr(qr);
    setUtr("");
    setStep("pay");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!feeHeadId) {
      setError("School has not configured a registration fee head yet.");
      return;
    }
    const state = loadAdmissions();
    const r = createFamilyRegistrationsFromPublic(
      state,
      {
        guardianName,
        motherName,
        mobile,
        campaignSrc: initialSrc || "website",
        feeHeadName: feeHeads[0]?.name || "Registration fee",
        children: children.map((c) => ({
          childName: c.childName,
          classSoughtId: c.classSoughtId,
          feeHeadId,
          feeAmountPaise: Math.max(
            0,
            Math.round(Number(c.feeInr) * 100) || 0,
          ),
        })),
      },
    );
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    saveAdmissions(r.state);
    const ids = r.leads.map((l) => l.id);
    setLeadIds(ids);
    const first = r.leads[0];
    if (!first) {
      setError("No students created");
      return;
    }
    await preparePayForLead(first);
  }

  function onConfirmPaid() {
    if (!paymentId) return;
    const state = loadAdmissions();
    const r = captureRegistrationPayment(
      state,
      paymentId,
      utr.trim() || `PARENT-${paymentCode}`,
    );
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    saveAdmissions(r.state);
    const receipt = composeRegistrationReceiptWhatsApp(
      r.payment,
      payeeName || TENANT.nameDisplay,
      "Online registration",
    );
    window.open(whatsAppUrl(mobile || r.payment.mobile, receipt), "_blank");

    const nextUnpaid = leadIds
      .map((id) => r.state.leads.find((l) => l.id === id))
      .find(
        (l) =>
          l &&
          l.id !== activeLeadId &&
          registrationBalancePaise(r.state, l) > 0,
      );
    if (nextUnpaid) {
      void preparePayForLead(nextUnpaid);
      return;
    }
    // Check if current still due (partial — we collected full link amount)
    const cur = r.state.leads.find((l) => l.id === activeLeadId);
    if (cur && registrationBalancePaise(r.state, cur) > 0) {
      void preparePayForLead(cur);
      return;
    }
    setStep("done");
  }

  if (step === "done") {
    return (
      <main className="mx-auto max-w-lg px-4 py-12 text-center">
        <Image
          src={TENANT.logoCrestUrl}
          alt=""
          width={64}
          height={66}
          className="logo-mark mx-auto object-contain"
          priority
          aria-hidden
        />
        <p className="mt-4 text-sm font-semibold text-[#15803d]">
          Registration submitted · fee paid
        </p>
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          Thank you. The school will verify documents and confirm admission.
          Keep your WhatsApp receipt.
        </p>
        <p className="mt-4 text-[12px] text-[var(--brand-deep)]">
          {TENANT.nameDisplay}
        </p>
      </main>
    );
  }

  if (step === "pay") {
    const bal = activeLead
      ? registrationBalancePaise(loadAdmissions(), activeLead)
      : 0;
    return (
      <main className="mx-auto max-w-lg space-y-4 px-4 py-10">
        <Image
          src={TENANT.logoCrestUrl}
          alt=""
          width={56}
          height={58}
          className="logo-mark object-contain"
          aria-hidden
        />
        <h1 className="text-xl font-bold text-[var(--brand-deep)]">
          Pay registration fee
        </h1>
        <p className="text-[13px] text-[var(--muted)]">
          {activeLead?.childName || "Student"} · {paymentCode} ·{" "}
          {formatInr(bal || activeLead?.registrationFeeAmountPaise || 0)}
        </p>
        {leadIds.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {leadIds.map((id) => {
              const st = loadAdmissions();
              const l = st.leads.find((x) => x.id === id);
              if (!l) return null;
              const due = registrationBalancePaise(st, l);
              return (
                <button
                  key={id}
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                    id === activeLeadId
                      ? "bg-[var(--brand-deep)] text-white"
                      : "border border-[rgba(32,48,80,0.15)]"
                  }`}
                  onClick={() => void preparePayForLead(l)}
                >
                  {l.childName}
                  {due > 0 ? ` · ${formatInr(due)}` : " · paid"}
                </button>
              );
            })}
          </div>
        ) : null}
        {error ? (
          <p className="text-sm font-medium text-[#b42318]">{error}</p>
        ) : null}
        {upiQr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={upiQr}
            alt="UPI QR"
            className="mx-auto h-[200px] w-[200px] rounded-lg bg-white"
          />
        ) : null}
        <p className="text-center font-mono text-[11px] text-[var(--muted)]">
          {vpa}
        </p>
        <input
          className={inp}
          placeholder="UTR / UPI ref (after paying)"
          value={utr}
          onChange={(e) => setUtr(e.target.value)}
        />
        <button
          type="button"
          className="w-full rounded-2xl bg-[#166534] py-3.5 text-sm font-semibold text-white"
          onClick={onConfirmPaid}
        >
          I have paid · confirm
        </button>
        <p className="text-[11px] text-[var(--muted)]">
          After fee confirmation, school verifies papers and issues admission
          in SIS. Demo records payment in CRM (R-series on admit).
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <Image
        src={TENANT.logoCrestUrl}
        alt=""
        width={64}
        height={66}
        className="logo-mark object-contain"
        priority
        aria-hidden
      />
      <p className="font-brand-name mt-2 text-sm text-[var(--brand-deep)]">
        {TENANT.nameDisplay}
      </p>
      <h1 className="mt-6 text-xl font-bold text-[var(--brand-deep)]">
        Online registration
      </h1>
      <p className="mt-1 text-[13px] text-[var(--muted)]">
        Register one or more children · fee calculated per student · pay to
        confirm registration (school verifies before admission).
      </p>
      {initialSrc ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          Via campaign: {initialSrc}
        </p>
      ) : null}

      <form className="mt-6 space-y-3" onSubmit={onSubmit}>
        <input
          className={inp}
          required
          placeholder="Parent / guardian name *"
          value={guardianName}
          onChange={(e) => setGuardianName(e.target.value)}
        />
        <input
          className={inp}
          placeholder="Other parent (optional)"
          value={motherName}
          onChange={(e) => setMotherName(e.target.value)}
        />
        <input
          className={inp}
          required
          inputMode="numeric"
          maxLength={10}
          placeholder="WhatsApp mobile *"
          value={mobile}
          onChange={(e) =>
            setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
          }
        />

        <div className="space-y-2 pt-2">
          <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
            Children · fee per student
          </p>
          {children.map((row, idx) => (
            <div
              key={row.key}
              className="space-y-2 rounded-xl border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.03)] p-3"
            >
              <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                Student {idx + 1}
              </p>
              <input
                className={inp}
                required
                placeholder="Child name *"
                value={row.childName}
                onChange={(e) =>
                  setChildren((rows) =>
                    rows.map((r) =>
                      r.key === row.key
                        ? { ...r, childName: e.target.value }
                        : r,
                    ),
                  )
                }
              />
              <select
                className={inp}
                required
                value={row.classSoughtId}
                onChange={(e) =>
                  setChildren((rows) =>
                    rows.map((r) =>
                      r.key === row.key
                        ? { ...r, classSoughtId: e.target.value }
                        : r,
                    ),
                  )
                }
              >
                <option value="">Class *</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                className={inp}
                type="number"
                min={0}
                required
                placeholder="Registration fee ₹"
                value={row.feeInr}
                onChange={(e) =>
                  setChildren((rows) =>
                    rows.map((r) =>
                      r.key === row.key
                        ? { ...r, feeInr: e.target.value }
                        : r,
                    ),
                  )
                }
              />
              {children.length > 1 ? (
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[#9a3412]"
                  onClick={() =>
                    setChildren((rows) => rows.filter((r) => r.key !== row.key))
                  }
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="text-[12px] font-semibold text-[var(--brand-deep)] underline"
            onClick={() =>
              setChildren((rows) => [...rows, emptyChild(defaultFee)])
            }
          >
            + Add sibling
          </button>
        </div>

        <p className="text-[14px] font-semibold text-[var(--brand-deep)]">
          Total registration fee {formatInr(totalPaise)}
        </p>

        {error ? (
          <p className="text-sm font-medium text-[#b42318]">{error}</p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-2xl bg-[var(--brand-deep)] py-3.5 text-sm font-semibold text-white"
        >
          Continue to payment
        </button>
      </form>
    </main>
  );
}
