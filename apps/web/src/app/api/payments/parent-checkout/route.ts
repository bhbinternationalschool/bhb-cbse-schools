/**
 * Parent portal — start an online fee payment for the parent's own household.
 * The client sends only dueKeys; amounts and dues are recomputed server-side
 * (never trust client amounts), the pay-link is created server-side, and the
 * live gateway checkout is attached. The webhook settles it like any link.
 */

import { NextResponse } from "next/server";
import {
  buildEnrichedPaymentSharePayload,
  buildPaymentShareUrlAbsolute,
  createPaymentLink,
} from "@/lib/payments";
import {
  attachCashfreeToPaymentLink,
  shouldUseCashfreeCheckout,
} from "@/lib/cashfree.server";
import { attachRazorpayToPaymentLink } from "@/lib/razorpay.server";
import {
  parentHouseholdFrom,
  readDueKeys,
  readMethodGroup,
  resolveChosenDues,
} from "@/lib/parentFeeCheckout.server";
import { publicAppOrigin } from "@/lib/waSisBotServer";
import { householdWhatsApp } from "@/lib/sis";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await parentHouseholdFrom(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { dueKeys?: string[]; studentId?: string; methodGroup?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const wanted = readDueKeys(body.dueKeys);
  if (wanted.size === 0) {
    return NextResponse.json({ error: "dueKeys required" }, { status: 400 });
  }
  // The rail the parent chose in the app (1.0.14+). Absent from 1.0.13 and
  // whenever the school absorbs every rail; the order then stays open to all
  // rails at the policy's fallback quote, which is free.
  const methodGroup = readMethodGroup(body.methodGroup);

  const resolved = await resolveChosenDues(auth.householdId, wanted);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { sis, masters, hh, dues } = resolved;

  const primaryId = body.studentId || dues[0]!.studentId;
  const primary =
    sis.students.find(
      (s) => s.id === primaryId && s.householdId === hh.id,
    ) || sis.students.find((s) => s.id === dues[0]!.studentId);
  const className =
    masters.classes.find((c) => c.id === primary?.classId)?.name ?? "";
  const sectionName =
    masters.sections.find((s) => s.id === primary?.sectionId)?.name ?? "";
  const singleStudent = new Set(dues.map((d) => d.studentId)).size === 1;
  const studentName = singleStudent
    ? primary?.fullName || "Student"
    : `${hh.guardianName || primary?.fullName || "Family"} · family`;

  const created = createPaymentLink({
    householdId: hh.id,
    studentId: primary?.id || dues[0]!.studentId,
    studentName,
    classLabel: sectionName ? `${className}-${sectionName}` : className,
    dues,
    createdBy: hh.guardianName || "Parent portal",
    note: "Parent portal",
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: 400 });
  }

  const attachOpts = {
    link: created.link,
    customerName: hh.guardianName || studentName,
    customerMobile: householdWhatsApp(hh) || hh.mobile || "",
    appOrigin: publicAppOrigin(),
    methodGroup,
  };
  const gw = shouldUseCashfreeCheckout()
    ? await attachCashfreeToPaymentLink(attachOpts)
    : await attachRazorpayToPaymentLink(attachOpts);

  const link = gw.ok ? gw.link : created.link;

  // Saved to the database before the parent is sent to pay. The gateway's
  // webhook books a payment by finding its link; a link that lived only in
  // this server's memory is money with nothing to book it against once the
  // instance restarts (two of the first three checkouts, found 14 Sep 2026).
  const { pushPaymentLinkToDb } = await import("@/lib/paymentsNormalized.server");
  const saved = await pushPaymentLinkToDb(link);
  if (!saved.ok) {
    console.error("[parent-checkout] payment link not saved", link.id, saved.error);
    return NextResponse.json(
      { error: "Could not start payment just now — please try again in a minute" },
      { status: 503 },
    );
  }
  const shareUrl = buildPaymentShareUrlAbsolute(
    publicAppOrigin(),
    buildEnrichedPaymentSharePayload(link, TENANT.nameDisplay, masters),
  );

  return NextResponse.json({
    ok: true,
    linkId: link.id,
    code: link.code,
    amountPaise: link.amountPaise,
    methodGroup: methodGroup ?? null,
    checkoutUrl: gw.ok ? gw.checkoutUrl : null,
    shareUrl,
  });
}
