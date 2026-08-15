/**
 * Server side of the tokenised registration link the WhatsApp bot sends.
 *
 * /register normally runs entirely in the visitor's browser against its
 * own (empty) admissions cache. That is fine when the parent is a
 * stranger filing a fresh enquiry, and wrong for a parent who already has
 * one: converting an existing lead means reading and writing records the
 * visitor's browser has never seen and must not be handed wholesale.
 *
 * So the token path runs here instead. The browser sends the token and
 * the form values; every lead read, every stage change and every rupee
 * lands server-side, and the client gets back only what it needs to draw
 * the payment step.
 */

import {
  captureRegistrationPayment,
  createRegistrationUpiLink,
  loadAdmissions,
  registerExistingFamily,
  registrationBalancePaise,
  stageLabel,
  type AdmissionLead,
  type AdmissionsState,
} from "@/lib/admissions";
import { ADMISSION_SOURCE_LABELS } from "@/lib/crmAdmissionBotEngine";
import {
  verifyAdmissionLinkToken,
  type AdmissionLinkPayload,
} from "@/lib/admissionLinkToken.server";
import { pushAdmissionsRemoteServer } from "@/lib/admissionsPersistence";
import {
  ensureSchoolMirrorHydrated,
  writeSchoolMirror,
} from "@/lib/schoolDataMirror.server";

export type AdmissionLinkChild = {
  leadId: string;
  childName: string;
  classSoughtId: string;
  enquiryNo: string;
  stageLabel: string;
  /** Already registered and fully paid — nothing left to do for this child. */
  settled: boolean;
};

export type AdmissionLinkPrefill = {
  guardianName: string;
  motherName: string;
  mobile: string;
  /** ISO date the family first enquired. */
  enquiryDate: string;
  sourceLabel: string;
  children: AdmissionLinkChild[];
};

export type AdmissionLinkPaymentStep = {
  leadId: string;
  childName: string;
  paymentId: string;
  paymentCode: string;
  amountPaise: number;
};

async function persist(state: AdmissionsState): Promise<string | null> {
  const pushed = await pushAdmissionsRemoteServer(state);
  if (!pushed.ok) return pushed.error || "Could not save to cloud";
  await writeSchoolMirror({ admissions: state });
  return null;
}

/**
 * Leads this token may act on: the household it was signed for, minus
 * anything already enrolled or written off.
 */
function leadsForToken(
  state: AdmissionsState,
  payload: AdmissionLinkPayload,
): AdmissionLead[] {
  return state.leads
    .filter(
      (l) =>
        l.householdId === payload.householdId &&
        l.stage !== "lost" &&
        l.stage !== "enrolled",
    )
    .sort((a, b) => (a.leadDate || "").localeCompare(b.leadDate || ""));
}

export async function loadAdmissionLinkPrefill(
  token: string,
): Promise<AdmissionLinkPrefill | null> {
  const payload = verifyAdmissionLinkToken(token);
  if (!payload) return null;

  await ensureSchoolMirrorHydrated();
  const state = loadAdmissions();
  const leads = leadsForToken(state, payload);
  if (leads.length === 0) return null;

  const first = leads[0]!;
  return {
    guardianName: first.guardianName || "",
    motherName: first.motherName === "—" ? "" : first.motherName || "",
    mobile: payload.mobile10,
    enquiryDate: first.leadDate || "",
    sourceLabel: ADMISSION_SOURCE_LABELS[first.source] || "Enquiry",
    children: leads.map((l) => ({
      leadId: l.id,
      childName: l.childName,
      classSoughtId: l.classSoughtId,
      enquiryNo: l.enquiryNo,
      stageLabel: stageLabel(l.stage),
      settled:
        l.stage === "applied" && registrationBalancePaise(state, l) <= 0,
    })),
  };
}

/**
 * Build the payment step for the first child that still owes the
 * registration fee, or null when the whole family is settled.
 */
function nextPaymentStep(
  state: AdmissionsState,
  leadIds: string[],
  feeHeadName: string,
):
  | { ok: true; state: AdmissionsState; step: AdmissionLinkPaymentStep | null }
  | { ok: false; reason: string } {
  const pending = leadIds
    .map((id) => state.leads.find((l) => l.id === id))
    .find((l) => l && registrationBalancePaise(state, l) > 0);
  if (!pending) return { ok: true, state, step: null };

  const balance = registrationBalancePaise(state, pending);
  const link = createRegistrationUpiLink(
    state,
    pending.id,
    "Parent self-register · WhatsApp link",
    feeHeadName,
    balance,
  );
  if (!link.ok) return { ok: false, reason: link.reason };

  return {
    ok: true,
    state: link.state,
    step: {
      leadId: pending.id,
      childName: pending.childName,
      paymentId: link.payment.id,
      paymentCode: link.payment.code,
      amountPaise: balance,
    },
  };
}

export async function registerFromAdmissionLink(input: {
  token: string;
  guardianName: string;
  motherName?: string;
  feeHeadId: string;
  feeHeadName: string;
  children: {
    childName: string;
    classSoughtId: string;
    feeAmountPaise: number;
  }[];
}): Promise<
  | { ok: true; leadIds: string[]; step: AdmissionLinkPaymentStep | null }
  | { ok: false; reason: string }
> {
  const payload = verifyAdmissionLinkToken(input.token);
  if (!payload) return { ok: false, reason: "This link has expired" };

  await ensureSchoolMirrorHydrated();
  const state = loadAdmissions();

  const registered = registerExistingFamily(
    state,
    {
      householdId: payload.householdId,
      guardianName: input.guardianName,
      motherName: input.motherName,
      mobile: payload.mobile10,
      feeHeadName: input.feeHeadName,
      children: input.children.map((c) => ({
        childName: c.childName,
        classSoughtId: c.classSoughtId,
        feeHeadId: input.feeHeadId,
        feeAmountPaise: c.feeAmountPaise,
      })),
    },
    "Parent (WhatsApp link)",
  );
  if (!registered.ok) return registered;

  const leadIds = registered.leads.map((l) => l.id);
  const stepped = nextPaymentStep(registered.state, leadIds, input.feeHeadName);
  if (!stepped.ok) return stepped;

  const error = await persist(stepped.state);
  if (error) return { ok: false, reason: error };

  return { ok: true, leadIds, step: stepped.step };
}

export async function confirmAdmissionLinkPayment(input: {
  token: string;
  paymentId: string;
  upiRef: string;
  leadIds: string[];
  feeHeadName: string;
}): Promise<
  | { ok: true; step: AdmissionLinkPaymentStep | null }
  | { ok: false; reason: string }
> {
  const payload = verifyAdmissionLinkToken(input.token);
  if (!payload) return { ok: false, reason: "This link has expired" };

  await ensureSchoolMirrorHydrated();
  const state = loadAdmissions();

  // A payment id from another family's link must not be capturable here.
  const payment = (state.registrationPayments || []).find(
    (p) => p.id === input.paymentId,
  );
  const paidLead = payment
    ? state.leads.find((l) => l.id === payment.leadId)
    : null;
  if (!payment || !paidLead || paidLead.householdId !== payload.householdId) {
    return { ok: false, reason: "Payment not found" };
  }

  const captured = captureRegistrationPayment(
    state,
    input.paymentId,
    input.upiRef,
  );
  if (!captured.ok) return captured;

  const owned = input.leadIds.filter((id) =>
    captured.state.leads.some(
      (l) => l.id === id && l.householdId === payload.householdId,
    ),
  );
  const stepped = nextPaymentStep(captured.state, owned, input.feeHeadName);
  if (!stepped.ok) return stepped;

  const error = await persist(stepped.state);
  if (error) return { ok: false, reason: error };

  return { ok: true, step: stepped.step };
}
