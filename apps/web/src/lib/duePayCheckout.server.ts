/**
 * What a family owes right now, and a gateway checkout for exactly that.
 *
 * One place for the three callers that used to do this three ways: the
 * /pay/due link in reminders and bot replies, the bot's DUES and PAY replies
 * (which only need the figures and the link), and anything else that wants
 * "pay this family's fee" without a browser.
 *
 * THE LINK IS SAVED BEFORE THE PARENT IS SENT TO PAY
 * Of the three gateway checkouts ever made before 14 Sep 2026, two belonged
 * to payment links that never reached the database — they lived in one
 * server's memory. The gateway's webhook settles a payment by finding its
 * link; after that instance restarted, a parent's money would have arrived
 * with no link to book it against and no receipt. So the link is written to
 * the database, and a failure to write stops the payment rather than taking
 * money the school cannot record.
 */

import {
  computeHouseholdDues,
  loadFees,
  openFeeDues,
  type FeeDueLine,
} from "@/lib/fees";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import {
  buildEnrichedPaymentSharePayload,
  buildPaymentShareUrlAbsolute,
  createPaymentLink,
  loadPayments,
  writePaymentsLocalRaw,
  type PaymentLink,
} from "@/lib/payments";
import { classLabelForStudent } from "@/lib/parentPortal";
import { householdWhatsApp, loadSis, type Household } from "@/lib/sis";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { TENANT } from "@/lib/types";
import type { DuePayScope } from "@/lib/duePayToken";

export type DirectDueLine = {
  studentId: string;
  studentName: string;
  label: string;
  amountPaise: number;
  dueOn: string;
};

/** Today in India, YYYY-MM-DD — "overdue" is judged on the school's calendar, not UTC. */
function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The dues a /pay/due link collects: everything open up to this month for the
 * household (or one child), optionally only what is already past its date.
 * The same figures the DUES reply shows, so the link never asks for a
 * different amount from the message it came in.
 */
export function directDues(input: {
  householdId: string;
  studentId?: string;
  scope: DuePayScope;
}): { household: Household | null; dues: FeeDueLine[]; lines: DirectDueLine[]; totalPaise: number } {
  const sis = loadSis();
  const masters = loadMasters();
  const household = sis.households.find((h) => h.id === input.householdId) ?? null;
  if (!household) return { household: null, dues: [], lines: [], totalPaise: 0 };
  const rows = computeHouseholdDues(household.id, sis, masters, loadFees(), {
    includeFuture: false,
    academicYearCode: currentAcademicYearCode(masters),
  });
  const today = todayIst();
  const dues = openFeeDues(rows.flatMap((r) => r.dues)).filter(
    (d) =>
      d.balancePaise > 0 &&
      (!input.studentId || d.studentId === input.studentId) &&
      (input.scope === "open" || d.dueOn < today),
  );
  const nameOf = (id: string) => sis.students.find((s) => s.id === id)?.fullName || "";
  const lines = dues.map((d) => ({
    studentId: d.studentId,
    studentName: nameOf(d.studentId),
    label: d.label,
    amountPaise: d.balancePaise,
    dueOn: d.dueOn,
  }));
  return { household, dues, lines, totalPaise: lines.reduce((a, l) => a + l.amountPaise, 0) };
}

export type DirectCheckoutResult =
  | { kind: "nothing_due"; household: Household | null }
  | { kind: "checkout"; url: string; link: PaymentLink; totalPaise: number }
  /** The gateway is off or refused: the UPI page, where the family can still pay. */
  | { kind: "fallback"; url: string; link: PaymentLink; reason: string }
  | { kind: "error"; error: string };

export async function startDirectFeeCheckout(input: {
  householdId: string;
  studentId?: string;
  scope: DuePayScope;
  appOrigin: string;
}): Promise<DirectCheckoutResult> {
  // HYDRATED, not merely loaded. ensureSchoolMirrorLoaded only reads a local
  // file, which does not exist on Cloud Run: the first live test (14 Sep 2026)
  // found no fee structure, computed no dues, and told a family who owed
  // ₹3,250 that nothing was due.
  await ensureSchoolMirrorHydrated();
  const { ensurePaymentsHydratedServer } = await import("@/lib/paymentsPersistence");
  await ensurePaymentsHydratedServer();

  const { household, dues, totalPaise } = directDues(input);
  if (!household) return { kind: "error", error: "Family not found" };
  if (dues.length === 0) return { kind: "nothing_due", household };

  const sis = loadSis();
  const masters = loadMasters();
  const childIds = [...new Set(dues.map((d) => d.studentId))];
  const primary = sis.students.find((s) => s.id === (input.studentId || childIds[0]));
  const single = childIds.length === 1;
  const created = createPaymentLink({
    householdId: household.id,
    studentId: primary?.id || childIds[0]!,
    studentName: single ? primary?.fullName || "Student" : `${household.guardianName || primary?.fullName || "Family"} · family`,
    classLabel: single && primary ? classLabelForStudent(primary, masters) : "",
    dues,
    createdBy: "WhatsApp pay link",
    academicYearCode: currentAcademicYearCode(masters),
    expiresInDays: 2,
    note: `Direct pay link · ${input.scope}`,
  });
  if (!created.ok) return { kind: "error", error: created.error };

  // createPaymentLink saves through the browser path on the server; put it in
  // the server cache so the gateway attach can patch it.
  const state = loadPayments();
  if (!state.links.some((l) => l.id === created.link.id)) {
    writePaymentsLocalRaw({ ...state, links: [created.link, ...state.links] });
  }

  const { pushPaymentLinkToDb } = await import("@/lib/paymentsNormalized.server");
  const { attachCashfreeToPaymentLink, shouldUseCashfreeCheckout } = await import("@/lib/cashfree.server");
  const { attachRazorpayToPaymentLink } = await import("@/lib/razorpay.server");
  const attachOpts = {
    link: created.link,
    customerName: household.guardianName || primary?.fullName || "Parent",
    customerMobile: householdWhatsApp(household) || household.mobile || "",
    appOrigin: input.appOrigin,
  };
  const gw = shouldUseCashfreeCheckout()
    ? await attachCashfreeToPaymentLink(attachOpts)
    : await attachRazorpayToPaymentLink(attachOpts);
  const link = gw.link;

  const saved = await pushPaymentLinkToDb(link);
  if (!saved.ok) {
    console.error("[pay/due] payment link not saved — refusing to take payment", link.id, saved.error);
    return { kind: "error", error: "Could not record the payment link. Please try again in a minute." };
  }

  if (gw.ok) return { kind: "checkout", url: gw.checkoutUrl, link, totalPaise };
  const shareUrl = buildPaymentShareUrlAbsolute(
    input.appOrigin,
    buildEnrichedPaymentSharePayload(link, TENANT.nameDisplay, masters),
  );
  return { kind: "fallback", url: shareUrl, link, reason: gw.error };
}

