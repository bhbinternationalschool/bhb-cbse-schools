"use client";

import { useEffect, useMemo, useState } from "react";
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
  saveAdmissions,
  whatsAppUrl,
  type AdmissionLead,
} from "@/lib/admissions";
import { formatInr } from "@/lib/fees";
import type { PublicRegistrationConfig } from "@/lib/publicRegistration";
import { HOUSEHOLD_LANGUAGES } from "@/lib/householdPrefs";
import { dpdpNoticeText, photographyNoticeText } from "@/lib/admissionsEnquiryForm";
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

type ServerPaymentStep = {
  leadId: string;
  childName: string;
  paymentId: string;
  paymentCode: string;
  amountPaise: number;
};

export function PublicFamilyRegisterForm({
  initialSrc,
  linkToken,
  config,
}: {
  initialSrc?: string | null;
  /** Signed token from the WhatsApp registration link, when the parent
   *  arrived through one. Its presence switches this form from "file a
   *  new enquiry in this browser" to "convert the enquiry the school
   *  already has", which only the server can do. */
  linkToken?: string | null;
  config: PublicRegistrationConfig;
}) {
  // Classes / fee head / UPI are resolved from the DB on the server and passed
  // in. Never derive them from loadMasters() here: this page is public, so the
  // browser has no masters and the fallback would invent ids (see
  // lib/publicRegistration.server.ts).
  const classes = config.classes;
  const feeHead = config.feeHead;
  const vpa = config.upi?.vpa ?? "";
  const payeeName = config.upi?.payeeName ?? "";
  const defaultFee = "500";
  const feeHeadId = feeHead?.id || "";

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
  // Token mode only: the payment step the server handed back, since this
  // browser's admissions cache holds none of these leads.
  const [serverStep, setServerStep] = useState<ServerPaymentStep | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const linked = !!linkToken;

  useEffect(() => {
    if (!linkToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/public/admission-registration?token=${encodeURIComponent(linkToken)}`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as {
          ok?: boolean;
          prefill?: {
            guardianName: string;
            motherName: string;
            mobile: string;
            enquiryDate: string;
            sourceLabel: string;
            children: { childName: string; classSoughtId: string }[];
          };
        };
        if (cancelled || !body.ok || !body.prefill) return;
        const p = body.prefill;
        setGuardianName(p.guardianName);
        setMotherName(p.motherName);
        setMobile(p.mobile);
        if (p.children.length > 0) {
          setChildren(
            p.children.map((c, i) => ({
              key: `linked-${i}`,
              childName: c.childName,
              classSoughtId: c.classSoughtId,
              feeInr: defaultFee,
            })),
          );
        }
        setLinkNote(
          p.enquiryDate
            ? `Your enquiry of ${p.enquiryDate} · ${p.sourceLabel}`
            : null,
        );
      } catch {
        /* an unreachable prefill just leaves an ordinary blank form */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [linkToken, defaultFee]);

  async function renderUpiQr(amountPaise: number, note: string) {
    const uri = buildSchoolUpiPayUri({
      vpa,
      payeeName,
      amountPaise,
      note,
    });
    setUpiQr(
      await QRCode.toDataURL(uri, {
        width: 200,
        margin: 1,
        color: { dark: "#203050", light: "#ffffff" },
      }),
    );
  }

  /** Token mode: the server converted the enquiry and told us what to collect. */
  function applyServerStep(step: ServerPaymentStep | null) {
    if (!step) {
      setServerStep(null);
      setStep("done");
      return;
    }
    setServerStep(step);
    setPaymentId(step.paymentId);
    setPaymentCode(step.paymentCode);
    setActiveLeadId(step.leadId);
    setUtr("");
    setStep("pay");
    void renderUpiQr(
      step.amountPaise,
      `${step.paymentCode} ${step.childName}`.trim(),
    );
  }

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
      feeHead?.name || "Registration fee",
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

  const [consent, setConsent] = useState(false);
  const [preferredLanguage, setPreferredLanguage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!feeHeadId) {
      setError("School has not configured a registration fee head yet.");
      return;
    }
    const known = new Set(classes.map((c) => c.id));
    if (children.some((c) => !known.has(c.classSoughtId))) {
      setError("Please pick a class for every student.");
      return;
    }
    if (!consent) {
      setError("Please tick the consent box to continue.");
      return;
    }
    if (linked) {
      const res = await fetch("/api/public/admission-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          token: linkToken,
          guardianName,
          motherName,
          feeHeadId,
          feeHeadName: feeHead?.name || "Registration fee",
          children: children.map((c) => ({
            childName: c.childName,
            classSoughtId: c.classSoughtId,
            feeAmountPaise: Math.max(0, Math.round(Number(c.feeInr) * 100) || 0),
          })),
          consent,
          preferredLanguage,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        leadIds?: string[];
        step?: ServerPaymentStep | null;
      };
      if (!res.ok || !body.ok) {
        setError(body.error || "Could not submit registration");
        return;
      }
      setLeadIds(body.leadIds ?? []);
      applyServerStep(body.step ?? null);
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
        consent,
        preferredLanguage,
        feeHeadName: feeHead?.name || "Registration fee",
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

  async function onConfirmPaid() {
    if (!paymentId) return;
    if (linked) {
      const res = await fetch("/api/public/admission-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          token: linkToken,
          paymentId,
          upiRef: utr.trim() || `PARENT-${paymentCode}`,
          leadIds,
          feeHeadName: feeHead?.name || "Registration fee",
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        step?: ServerPaymentStep | null;
      };
      if (!res.ok || !body.ok) {
        setError(body.error || "Could not confirm payment");
        return;
      }
      applyServerStep(body.step ?? null);
      return;
    }
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

  // Fail closed: without real classes / a real fee head from the DB there is
  // nothing valid to submit, so don't show a form that would file a broken lead.
  if (classes.length === 0 || !feeHeadId) {
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
        <h1 className="mt-6 text-xl font-bold text-[var(--brand-deep)]">
          Online registration
        </h1>
        <p className="mt-3 text-[13px] text-[var(--muted)]">
          Online registration is not open right now. Please call the school
          office to register your child.
        </p>
        <p className="mt-4 text-[12px] text-[var(--brand-deep)]">
          {TENANT.nameDisplay}
        </p>
      </main>
    );
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
    const bal = serverStep
      ? serverStep.amountPaise
      : activeLead
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
          {serverStep?.childName || activeLead?.childName || "Student"} ·{" "}
          {paymentCode} ·{" "}
          {formatInr(bal || activeLead?.registrationFeeAmountPaise || 0)}
        </p>
        {leadIds.length > 1 && !linked ? (
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
          <p className="text-sm font-medium text-[var(--danger)]">{error}</p>
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
      {linkNote ? (
        <p className="mt-3 rounded-xl bg-[rgba(32,48,80,0.06)] px-3 py-2 text-[12px] text-[var(--brand-deep)]">
          {linkNote} — details below are already filled in from your enquiry.
          Add a sibling if you need to.
        </p>
      ) : initialSrc ? (
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
          readOnly={linked}
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

        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Language for school messages
          <select className={`${inp} mt-1`} value={preferredLanguage} onChange={(e) => setPreferredLanguage(e.target.value)}>
            <option value="">Select</option>
            {HOUSEHOLD_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.native}
                {l.native !== l.label ? ` (${l.label})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2 rounded-xl bg-[rgba(32,48,80,0.05)] p-3 text-[11px] text-[var(--muted)]">
          <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
          <span>
            {dpdpNoticeText(TENANT.nameDisplay)}
            {/* The half the website's blanket photo consent rests on. Shown
                as its own paragraph rather than run into the sentence above,
                so a parent can actually see what they are agreeing to — and
                so the refusal right is legible rather than buried. */}
            <span className="mt-2 block">
              {photographyNoticeText(TENANT.nameDisplay)}
            </span>
          </span>
        </label>

        {error ? (
          <p className="text-sm font-medium text-[var(--danger)]">{error}</p>
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
