"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  buildSchoolUpiPayUri,
  captureRegistrationPayment,
  composeRegistrationReceiptWhatsApp,
  createEnquiry,
  createRegistrationUpiLink,
  emptyAdmissionLead,
  loadAdmissions,
  promoteToRegistration,
  registrationBalancePaise,
  registrationFeeHeads,
  resolveSchoolCollectionsUpi,
  saveAdmissions,
  sendLeadToRegistration,
  setLeadRegistrationFee,
  takeRegistrationPayment,
  todayYmd,
  whatsAppUrl,
} from "@/lib/admissions";
import { formatInr, TENDER_MODES, type TenderMode } from "@/lib/fees";
import { loadMasters } from "@/lib/masters";
import type { DemoSession } from "@/lib/auth";
import { TENANT } from "@/lib/types";

const inp =
  "w-full rounded-xl border border-[rgba(32,48,80,0.18)] bg-white px-3 py-3 text-base";

export function StaffRegistrationCollectApp({
  session,
}: {
  session: DemoSession;
}) {
  const masters = useMemo(() => loadMasters(), []);
  const classes = useMemo(
    () => (masters.classes ?? []).filter((c) => c.isActive),
    [masters],
  );
  const feeHeads = useMemo(() => registrationFeeHeads(masters), [masters]);
  const { vpa, payeeName } = useMemo(
    () => resolveSchoolCollectionsUpi(masters),
    [masters],
  );
  const by = session.fullName;

  const [childName, setChildName] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [mobile, setMobile] = useState("");
  const [classSoughtId, setClassSoughtId] = useState("");
  const [feeHeadId, setFeeHeadId] = useState("");
  const [feeAmount, setFeeAmount] = useState("500");
  const [collectAmount, setCollectAmount] = useState("500");
  const [mode, setMode] = useState<TenderMode>("upi");
  const [ref, setRef] = useState("");
  const [bankName, setBankName] = useState("");
  const [upiQr, setUpiQr] = useState<string | null>(null);
  const [upiUri, setUpiUri] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [paymentCode, setPaymentCode] = useState("");
  const [leadId, setLeadId] = useState("");
  const [utr, setUtr] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const modeMeta = TENDER_MODES.find((m) => m.value === mode);

  useEffect(() => {
    if (!feeHeadId && feeHeads[0]) setFeeHeadId(feeHeads[0].id);
  }, [feeHeads, feeHeadId]);

  function ensureLeadState():
    | { ok: true; state: ReturnType<typeof loadAdmissions>; id: string }
    | { ok: false; reason: string } {
    let state = loadAdmissions();
    let id = leadId;

    if (!id) {
      const created = createEnquiry(
        state,
        emptyAdmissionLead({
          source: "walk_in",
          childName,
          guardianName,
          mobile,
          classSoughtId,
          campaignNote: `Staff mobile registration · ${by}`,
          leadDate: todayYmd(),
          assignedTo: by,
          motherName: "—",
          declarationAccepted: true,
          docsBirthCert: true,
          docsPhoto: true,
        }),
        by,
        { allowMissingClass: !classSoughtId },
      );
      if (!created.ok) return { ok: false, reason: created.reason };
      state = created.state;
      id = created.lead.id;
      setLeadId(id);
    }

    const head = feeHeads.find((h) => h.id === feeHeadId);
    const amountPaise = Math.max(0, Math.round(Number(feeAmount) || 0) * 100);
    state = setLeadRegistrationFee(state, id, feeHeadId, amountPaise);

    const push = sendLeadToRegistration(state, id, {
      feeHeadId,
      feeHeadName: head?.name || "Registration fee",
      feeAmountPaise: amountPaise,
    });
    if (!push.ok) return { ok: false, reason: push.reason };
    state = push.state;

    const lead = state.leads.find((l) => l.id === id);
    if (lead?.stage === "enquiry") {
      const promo = promoteToRegistration(state, id);
      if (promo.ok) state = promo.state;
    }

    return { ok: true, state, id };
  }

  async function prepareUpi() {
    setMsg(null);
    const ready = ensureLeadState();
    if (!ready.ok) {
      setMsg(ready.reason);
      return;
    }
    let { state, id } = ready;
    const head = feeHeads.find((h) => h.id === feeHeadId);
    const lead = state.leads.find((l) => l.id === id)!;
    const bal = registrationBalancePaise(state, lead);
    const linkPaise = Math.max(
      0,
      Math.round(Number(collectAmount || feeAmount) || 0) * 100,
    );
    const amount = linkPaise > 0 && linkPaise <= bal ? linkPaise : bal;
    if (amount <= 0) {
      setMsg("Nothing due");
      return;
    }

    const link = createRegistrationUpiLink(
      state,
      id,
      by,
      head?.name || "Registration fee",
      amount,
    );
    if (!link.ok) {
      setMsg(link.reason);
      return;
    }
    saveAdmissions(link.state);
    setPaymentId(link.payment.id);
    setPaymentCode(link.payment.code);

    const uri = buildSchoolUpiPayUri({
      vpa,
      payeeName,
      amountPaise: amount,
      note: `${link.payment.code} ${childName || "Reg"}`.trim(),
    });
    setUpiUri(uri);
    const qr = await QRCode.toDataURL(uri, {
      width: 220,
      margin: 1,
      color: { dark: "#203050", light: "#ffffff" },
    });
    setUpiQr(qr);
    setMsg(
      `UPI ready · ${formatInr(amount)} · ${vpa} · ${link.payment.code}${
        amount < bal ? " · partial" : ""
      }`,
    );
  }

  function collectNow() {
    setMsg(null);
    const ready = ensureLeadState();
    if (!ready.ok) {
      setMsg(ready.reason);
      return;
    }
    const { state, id } = ready;
    const lead = state.leads.find((l) => l.id === id)!;
    const bal = registrationBalancePaise(state, lead);
    const paise = Math.max(
      0,
      Math.round(Number(collectAmount || feeAmount) || 0) * 100,
    );
    if (paise <= 0) {
      setMsg("Enter collect amount");
      return;
    }
    if (paise > bal) {
      setMsg(`Exceeds balance ${formatInr(bal)}`);
      return;
    }
    if (modeMeta?.needsRef && !ref.trim()) {
      setMsg(`${modeMeta.refLabel} required`);
      return;
    }

    const r = takeRegistrationPayment(state, id, by, {
      amountPaise: paise,
      tenders: [
        {
          mode,
          amountPaise: paise,
          ref: ref.trim() || utr.trim(),
          bankName: bankName.trim(),
          instrumentDate: todayYmd(),
        },
      ],
    });
    if (!r.ok) {
      setMsg(r.reason);
      return;
    }
    saveAdmissions(r.state);
    const still = registrationBalancePaise(r.state, {
      id,
      registrationFeeAmountPaise:
        r.state.leads.find((l) => l.id === id)?.registrationFeeAmountPaise || 0,
    });
    const text = composeRegistrationReceiptWhatsApp(
      r.payment,
      payeeName || TENANT.nameDisplay,
      by,
    );
    setMsg(
      [
        still > 0 ? `Partial ${r.payment.code}` : `Paid ${r.payment.code}`,
        r.payment.feeReceiptNo
          ? `R ${r.payment.feeReceiptNo}`
          : "ledger on SIS admit",
        still > 0 ? `bal ${formatInr(still)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    setCollectAmount(still > 0 ? String(still / 100) : "0");
    setRef("");
    setUpiQr(null);
    window.open(whatsAppUrl(mobile || r.payment.mobile, text), "_blank", "noopener,noreferrer");
  }

  function confirmPaidAndWhatsApp() {
    if (!paymentId) {
      setMsg("Prepare UPI first");
      return;
    }
    const state = loadAdmissions();
    const r = captureRegistrationPayment(
      state,
      paymentId,
      utr.trim() || ref.trim() || `STAFF-${paymentCode}`,
    );
    if (!r.ok) {
      setMsg(r.reason);
      return;
    }
    saveAdmissions(r.state);
    const stillLead = r.state.leads.find((l) => l.id === leadId);
    const still = stillLead
      ? registrationBalancePaise(r.state, stillLead)
      : 0;
    const text = composeRegistrationReceiptWhatsApp(
      r.payment,
      payeeName || TENANT.nameDisplay,
      by,
    );
    setMsg(
      [
        still > 0 ? `Partial ${r.payment.code}` : `Paid ${r.payment.code}`,
        r.payment.feeReceiptNo
          ? `R ${r.payment.feeReceiptNo}`
          : "ledger on SIS admit",
        still > 0 ? `bal ${formatInr(still)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    window.open(whatsAppUrl(mobile || r.payment.mobile, text), "_blank", "noopener,noreferrer");
    setUtr("");
    setCollectAmount(still > 0 ? String(still / 100) : "0");
    setUpiQr(null);
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          {TENANT.shortName} · Collect
        </p>
        <h1 className="text-xl font-semibold text-[var(--brand-deep)]">
          Registration fee
        </h1>
        <p className="text-[12px] text-[var(--muted)]">
          Any mode · partial OK · R-series receipts on ledger
        </p>
      </div>

      {msg ? (
        <p className="rounded-xl bg-[rgba(22,101,52,0.12)] px-3 py-2 text-[12px] text-[#166534]">
          {msg}
        </p>
      ) : null}

      <div className="space-y-3">
        <input
          className={inp}
          placeholder="Child name *"
          value={childName}
          onChange={(e) => setChildName(e.target.value)}
        />
        <input
          className={inp}
          placeholder="Guardian *"
          value={guardianName}
          onChange={(e) => setGuardianName(e.target.value)}
        />
        <input
          className={inp}
          placeholder="Parent WhatsApp mobile *"
          inputMode="numeric"
          maxLength={10}
          value={mobile}
          onChange={(e) =>
            setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
          }
        />
        <select
          className={inp}
          value={classSoughtId}
          onChange={(e) => setClassSoughtId(e.target.value)}
        >
          <option value="">Class (optional)</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className={inp}
          value={feeHeadId}
          onChange={(e) => setFeeHeadId(e.target.value)}
        >
          {feeHeads.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <input
          className={inp}
          type="number"
          min={0}
          placeholder="Full fee ₹"
          value={feeAmount}
          onChange={(e) => {
            setFeeAmount(e.target.value);
            if (!collectAmount || collectAmount === feeAmount) {
              setCollectAmount(e.target.value);
            }
          }}
        />
        <input
          className={inp}
          type="number"
          min={0}
          placeholder="Collect now ₹ (partial OK)"
          value={collectAmount}
          onChange={(e) => setCollectAmount(e.target.value)}
        />
        <select
          className={inp}
          value={mode}
          onChange={(e) => setMode(e.target.value as TenderMode)}
        >
          {TENDER_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          className={inp}
          placeholder={modeMeta?.refLabel || "Ref"}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        {modeMeta?.needsBank ? (
          <input
            className={inp}
            placeholder="Bank name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
          />
        ) : null}
      </div>

      <button
        type="button"
        className="w-full rounded-2xl bg-[var(--brand-deep)] py-3.5 text-sm font-semibold text-white"
        onClick={collectNow}
      >
        Collect + WhatsApp receipt
      </button>

      <button
        type="button"
        className="w-full rounded-2xl bg-[#0f766e] py-3 text-sm font-semibold text-white"
        onClick={() => void prepareUpi()}
      >
        Show school UPI QR
      </button>

      {upiQr ? (
        <div className="space-y-3 rounded-2xl border border-[rgba(32,48,80,0.12)] bg-[var(--brand-cream)] p-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={upiQr}
            alt="School UPI QR"
            className="mx-auto h-[200px] w-[200px] rounded-lg bg-white"
          />
          <p className="font-mono text-[11px] text-[var(--brand-deep)]">{vpa}</p>
          <p className="text-[11px] text-[var(--muted)]">
            Ask parent to pay · {paymentCode}
          </p>
          {upiUri ? (
            <a
              href={upiUri}
              className="inline-block text-[12px] font-semibold underline"
            >
              Open UPI app on this phone
            </a>
          ) : null}
          <input
            className={inp}
            placeholder="UTR / UPI ref (optional)"
            value={utr}
            onChange={(e) => setUtr(e.target.value)}
          />
          <button
            type="button"
            className="w-full rounded-2xl bg-[#166534] py-3 text-sm font-semibold text-white"
            onClick={confirmPaidAndWhatsApp}
          >
            Capture UPI + WhatsApp receipt
          </button>
        </div>
      ) : null}

      <Link href="/field" className="block text-center text-sm underline">
        Back to Field app
      </Link>
    </div>
  );
}
