/**
 * Raising a fee payment link for one student and sending it to the family,
 * server-side.
 *
 * The counter creates links in the browser and calls /api/payments/
 * attach-gateway to bolt a Cashfree checkout onto them. The command desk
 * has no browser, so it does the whole thing here: build the link from the
 * student's open dues, persist it into the server cache and the database,
 * attach the gateway with the existing Cashfree helper, then send the
 * parent the approved pay-link template.
 *
 * Nothing about the payment itself is new. The checkout, the webhook that
 * books the receipt and the WhatsApp receipt that follows are all the
 * existing paths — this only creates the link and hands it over.
 */

import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import type { DemoSession } from "@/lib/auth";
import type { MastersState } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureFeesHydratedServer } from "@/lib/feesPersistence.server";
import { ensurePaymentsHydratedServer } from "@/lib/paymentsPersistence";
import {
  createPaymentLink,
  loadPayments,
  writePaymentsLocalRaw,
  type PaymentLink,
} from "@/lib/payments";
import { attachCashfreeToPaymentLink, shouldUseCashfreeCheckout } from "@/lib/cashfree.server";
import { attachRazorpayToPaymentLink } from "@/lib/razorpay.server";
import { publicAppOrigin } from "@/lib/waSisBotServer";
import { computeHouseholdDues, openFeeDues, loadFees, type FeeDueLine } from "@/lib/fees";
import { flagFutureDues } from "@/lib/feeDueFuture";
import { householdWhatsApp, loadSis } from "@/lib/sis";
import { classLabel } from "@/lib/homework";
import { formatInr } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import { sendWaWithFailover, buildWaTemplateBodyComponent } from "@/lib/waSend";

export type PayLinkDueRow = {
  label: string;
  headName: string;
  amountPaise: number;
};

/**
 * What the link would cover: every due the family is being asked for now.
 * Future months are excluded — a link for money not yet owed reads as a
 * demand for it.
 */
export async function openDuesForPayLink(opts: {
  studentId: string;
  academicYearCode: string;
  todayIso: string;
}): Promise<
  | { ok: true; dues: FeeDueLine[]; rows: PayLinkDueRow[]; totalPaise: number; studentName: string; classLabel: string; householdId: string; guardianName: string; mobile: string; language: "en" | "hi" }
  | { ok: false; error: string }
> {
  await ensureSchoolMirrorHydrated();
  await ensureFeesHydratedServer();
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === opts.studentId);
  if (!student) return { ok: false, error: "Student not found" };
  if (!student.householdId) {
    return { ok: false, error: "No family record is linked to this student" };
  }
  const { loadMasters } = await import("@/lib/masters");
  const masters = loadMasters();
  const rows = computeHouseholdDues(student.householdId, sis, masters, loadFees(), {
    includeFuture: true,
    academicYearCode: opts.academicYearCode,
  });
  const mine = rows.find((r) => r.student.id === student.id)?.dues ?? [];
  const futureKeys = new Set(
    flagFutureDues(openFeeDues(mine), opts.todayIso)
      .filter((d) => d.future)
      .map((d) => d.dueKey),
  );
  const dues = openFeeDues(mine).filter(
    (d) => d.balancePaise > 0 && !futureKeys.has(d.dueKey),
  );
  if (!dues.length) return { ok: false, error: "No dues are pending for this student" };
  const hh = sis.households.find((h) => h.id === student.householdId);
  return {
    ok: true,
    dues,
    rows: dues.map((d) => ({
      label: d.installmentLabel || d.label || "",
      headName: d.feeHeadName || d.label || "Fee",
      amountPaise: d.balancePaise,
    })),
    totalPaise: dues.reduce((s, d) => s + d.balancePaise, 0),
    studentName: student.fullName,
    classLabel: classLabel(masters, student.classId, student.sectionId).replace(" · ", " "),
    householdId: student.householdId,
    guardianName: hh?.guardianName || "",
    mobile: hh ? householdWhatsApp(hh) || hh.mobile || hh.altMobile || "" : "",
    // The language THIS family reads, not the one the staff member typed
    // in. Falls back to the school default when they have never said.
    language: waTemplateLanguageFor(hh ?? {}),
  };
}

export type CreatePayLinkResult =
  | {
      ok: true;
      link: PaymentLink;
      checkoutUrl: string;
      gatewayMode: string;
      whatsapp: { sent: boolean; error?: string };
    }
  | { ok: false; error: string };

export async function createAndSendPayLink(opts: {
  session: DemoSession;
  masters: MastersState;
  studentId: string;
  todayIso: string;
  /** Approved pay-link template, when the school has one. */
  template?: { metaName: string; language: string; variables: string[] } | null;
  expiresInDays?: number;
}): Promise<CreatePayLinkResult> {
  const due = await openDuesForPayLink({
    studentId: opts.studentId,
    academicYearCode: opts.session.academicYearCode,
    todayIso: opts.todayIso,
  });
  if (!due.ok) return { ok: false, error: due.error };
  if (!due.mobile) {
    return { ok: false, error: "No parent WhatsApp number on record for this family" };
  }

  await ensurePaymentsHydratedServer();
  const created = createPaymentLink({
    householdId: due.householdId,
    studentId: opts.studentId,
    studentName: due.studentName,
    classLabel: due.classLabel,
    dues: due.dues,
    createdBy: opts.session.fullName,
    academicYearCode: opts.session.academicYearCode,
    expiresInDays: opts.expiresInDays ?? 7,
    note: "Raised from the ERP command desk",
  });
  if (!created.ok) return { ok: false, error: created.error };

  // createPaymentLink saves through the browser path, so mirror it into the
  // server cache before the gateway attach patches it.
  const state = loadPayments();
  if (!state.links.some((l) => l.id === created.link.id)) {
    writePaymentsLocalRaw({ ...state, links: [created.link, ...state.links] });
  }

  const attachOpts = {
    link: created.link,
    customerName: due.guardianName || due.studentName,
    customerMobile: due.mobile,
    appOrigin: publicAppOrigin(),
  };
  const attached = shouldUseCashfreeCheckout()
    ? await attachCashfreeToPaymentLink(attachOpts)
    : await attachRazorpayToPaymentLink(attachOpts);
  if (!attached.ok) return { ok: false, error: attached.error };

  const { pushPaymentLinkToDb } = await import("@/lib/paymentsNormalized.server");
  const dbPush = await pushPaymentLinkToDb(attached.link);
  if (!dbPush.ok) {
    // The parent is about to be asked to pay against this link; if the
    // school's own copy did not persist, do not send it.
    return { ok: false, error: dbPush.error || "Could not save the payment link" };
  }

  let whatsapp: { sent: boolean; error?: string } = {
    sent: false,
    error: "No approved pay-link template",
  };
  if (opts.template?.metaName) {
    const vars: Record<string, string> = {
      schoolName: TENANT.nameDisplay,
      guardianName: due.guardianName || "Parent",
      childName: due.studentName,
      classLabel: due.classLabel,
      feeDue: formatInr(attached.link.amountPaise),
      amount: formatInr(attached.link.amountPaise),
      payLink: attached.checkoutUrl,
    };
    const sent = await sendWaWithFailover({
      primaryMobile: due.mobile,
      template: {
        name: opts.template.metaName,
        language: opts.template.language,
        components: [buildWaTemplateBodyComponent(opts.template.variables, vars)],
      },
      clientMessageId: `paylink_${attached.link.id}`,
    });
    whatsapp = sent.ok ? { sent: true } : { sent: false, error: sent.error };
  }

  return {
    ok: true,
    link: attached.link,
    checkoutUrl: attached.checkoutUrl,
    gatewayMode: attached.link.gatewayMode || "",
    whatsapp,
  };
}
