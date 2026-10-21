/**
 * Staff app — admissions rules the routes and their selftest share.
 *
 * Nothing here writes. The routes under /api/v1/staff/admissions/* load the
 * admissions state, run the SAME pure functions the web desk runs
 * (createEnquiry, applyRegistrationToLead, createRegistrationFromDesk,
 * takeRegistrationPayment) and save through the same push. This file only
 * holds what the phone needs on top: reading the request body without
 * trusting it, and the rules the app must not decide for itself.
 */

import {
  findHouseholdByMobile,
  type AdmissionLead,
  type AdmissionsState,
  type AdmissionStage,
} from "@/lib/admissions";
import type { TenderMode } from "@/lib/fees";

/** "Registered" on the app = the web's Registered + Verified columns. */
export const REGISTERED_STAGES: ReadonlySet<AdmissionStage> = new Set([
  "applied",
  "verified",
]);

export function isRegisteredStage(stage: string): boolean {
  return REGISTERED_STAGES.has(stage as AdmissionStage);
}

/** Modes the phone offers. The web's ref rule applies to every one but cash. */
export const APP_TENDER_MODES: readonly TenderMode[] = [
  "cash",
  "upi",
  "card",
  "cheque",
  "bank",
];

function rupeesToPaise(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  // Whole rupees only: a registration fee is never in paise, and a stray
  // decimal typed on a phone keyboard should be refused, not rounded.
  if (Math.round(n) !== n) return null;
  return Math.round(n * 100);
}

export type RegistrationRequest = {
  feeHeadId: string;
  feeAmountPaise: number;
  /** Money handed over now. Absent = the fee is set and stays due. */
  collect: null | {
    amountPaise: number;
    mode: TenderMode;
    ref: string;
  };
};

/**
 * Read the registration part of the request.
 *
 * The amount is the fee for the child; collecting is optional and separate,
 * because a family often registers today and pays at the counter later. A
 * collection is held to the same rules as the web's Registration desk:
 * no more than the fee, and a reference for anything but cash.
 */
export function parseRegistrationRequest(
  body: Record<string, unknown>,
  feeHeadIds: readonly string[],
): { ok: true; value: RegistrationRequest } | { ok: false; reason: string } {
  const feeHeadId = String(body.feeHeadId ?? "").trim();
  if (!feeHeadId) return { ok: false, reason: "Choose the registration fee head" };
  if (!feeHeadIds.includes(feeHeadId)) {
    return { ok: false, reason: "That fee head is not a registration fee head" };
  }
  const fee = rupeesToPaise(body.feeAmountRupees);
  if (fee === null) {
    return { ok: false, reason: "Enter the registration fee in whole rupees" };
  }

  const c = body.collect as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== "object") {
    return { ok: true, value: { feeHeadId, feeAmountPaise: fee, collect: null } };
  }
  const amount = rupeesToPaise(c.amountRupees);
  if (amount === null || amount <= 0) {
    return { ok: false, reason: "Enter the amount received in whole rupees" };
  }
  if (fee <= 0) {
    return { ok: false, reason: "Set the registration fee before taking money" };
  }
  if (amount > fee) {
    return { ok: false, reason: "Amount received is more than the registration fee" };
  }
  const mode = String(c.mode ?? "").trim() as TenderMode;
  if (!APP_TENDER_MODES.includes(mode)) {
    return { ok: false, reason: "Choose how the money was paid" };
  }
  const ref = String(c.ref ?? "").trim().slice(0, 80);
  if (mode !== "cash" && !ref) {
    return { ok: false, reason: "A reference (UTR / cheque / txn no.) is required for non-cash payments" };
  }
  return {
    ok: true,
    value: { feeHeadId, feeAmountPaise: fee, collect: { amountPaise: amount, mode, ref } },
  };
}

/**
 * The same child already on file for this mobile, not lost.
 *
 * Registering a child twice is not a harmless duplicate — each copy carries
 * its own fee, so the family is shown two amounts due (see
 * applyRegistrationToLead). The app sends the counsellor to the lead that
 * exists instead of filing a second one.
 */
export function sameChildOnFile(
  state: AdmissionsState,
  mobile: string,
  childName: string,
): AdmissionLead | null {
  const name = childName.trim().toLowerCase().replace(/\s+/g, " ");
  if (!name) return null;
  // No household for this number (or a placeholder number) = nobody on file.
  const hh = findHouseholdByMobile(state, mobile);
  if (!hh) return null;
  return (
    state.leads.find(
      (l) =>
        l.stage !== "lost" &&
        l.householdId === hh.id &&
        l.childName.trim().toLowerCase().replace(/\s+/g, " ") === name,
    ) ?? null
  );
}

/**
 * The drafted WhatsApp text a counsellor starts from. Plain words — the
 * app shows it, the counsellor edits it, and only then does anything go.
 */
export function leadMessageDraft(input: {
  guardianName: string;
  childName: string;
  classSought: string;
  schoolName: string;
  registered: boolean;
}): string {
  const who = input.guardianName.trim() || "Parent";
  const child = input.childName.trim() || "your child";
  const cls = input.classSought.trim() ? ` for Class ${input.classSought.trim()}` : "";
  return input.registered
    ? `Namaste ${who} ji, this is ${input.schoolName} admissions office. ` +
        `${child}'s registration${cls} is done. May we help you with the next step towards admission?`
    : `Namaste ${who} ji, this is ${input.schoolName} admissions office about ` +
        `${child}'s admission enquiry${cls}. May we help you with the admission?`;
}

/**
 * The approved template's body with this family's values filled in — what
 * the parent will actually read. A value the school does not have shows as
 * the same "—" the send puts in its place (templateVariablePositions).
 */
export function renderTemplatePreview(
  body: string,
  values: Record<string, string>,
): string {
  return body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k: string) => {
    const v = (values[k] ?? "").trim();
    return v || "—";
  });
}
