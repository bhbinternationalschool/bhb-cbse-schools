/**
 * Parent portal — start an online fee payment for the parent's own household.
 * The client sends only dueKeys; amounts and dues are recomputed server-side
 * (never trust client amounts), the pay-link is created server-side, and the
 * live gateway checkout is attached. The webhook settles it like any link.
 */

import {
  GATEWAY_UNAVAILABLE_EN,
  GATEWAY_UNAVAILABLE_HI,
  logGatewayRefusal,
  onlineGatewayExpected,
} from "@/lib/onlineGateway.server";
import { NextResponse } from "next/server";
import {
  buildEnrichedPaymentSharePayload,
  buildPaymentShareUrlAbsolute,
  createPaymentLink,
  reusableCheckoutUrl,
} from "@/lib/payments";
import { singleFlight } from "@/lib/singleFlight";
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
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  const raw = await req.text();
  // A double tap on Pay runs once; the second tap gets the same checkout.
  const res = await singleFlight(
    `parent-checkout:${auth.householdId}:${raw}`,
    () => startCheckout(auth.householdId, raw),
  );
  return NextResponse.json(res.body, { status: res.status });
}

type Out = { status: number; body: Record<string, unknown> };

async function startCheckout(householdId: string, raw: string): Promise<Out> {
  let body: { dueKeys?: string[]; studentId?: string; methodGroup?: string };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  const wanted = readDueKeys(body.dueKeys);
  if (wanted.size === 0) {
    return { status: 400, body: { error: "dueKeys required" } };
  }
  // The rail the parent chose in the app (1.0.14+). Absent from 1.0.13 and
  // whenever the school absorbs every rail; the order then stays open to all
  // rails at the policy's fallback quote, which is free.
  const methodGroup = readMethodGroup(body.methodGroup);

  const resolved = await resolveChosenDues(householdId, wanted);
  if (!resolved.ok) {
    return { status: resolved.status, body: { error: resolved.error } };
  }
  const { sis, masters, hh, dues } = resolved;

  const primaryId = body.studentId || dues[0]!.studentId;
  const primary =
    sis.students.find((s) => s.id === primaryId && s.householdId === hh.id) ||
    sis.students.find((s) => s.id === dues[0]!.studentId);
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
    // The rail is part of the note: the gateway order is made for that rail
    // only, so an open link is reused only when the parent picked the same.
    note: methodGroup ? `Parent portal · ${methodGroup}` : "Parent portal",
  });
  if (!created.ok) {
    return { status: 400, body: { error: created.error } };
  }
  const reuseUrl = reusableCheckoutUrl(
    created,
    shouldUseCashfreeCheckout() ? "cashfree" : "razorpay",
  );
  if (reuseUrl) {
    const link = created.link;
    return {
      status: 200,
      body: {
        ok: true,
        linkId: link.id,
        code: link.code,
        amountPaise: link.amountPaise,
        methodGroup: methodGroup ?? null,
        checkoutUrl: reuseUrl,
        shareUrl: buildPaymentShareUrlAbsolute(
          publicAppOrigin(),
          buildEnrichedPaymentSharePayload(link, TENANT.nameDisplay, masters),
        ),
        reused: true,
      },
    };
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

  // A configured gateway that refuses is an outage: say so. The app used to
  // fall through to shareUrl — the old UPI QR / GPay page — and did for ten
  // days in Sep–Oct 2026 without anyone knowing. See lib/onlineGateway.server.
  if (!gw.ok && onlineGatewayExpected()) {
    logGatewayRefusal("parent-checkout", created.link.id, gw.error);
    return {
      status: 503,
      body: {
        error: `${GATEWAY_UNAVAILABLE_EN}\n${GATEWAY_UNAVAILABLE_HI}`,
        gatewayUnavailable: true,
      },
    };
  }

  const link = gw.ok ? gw.link : created.link;

  // Saved to the database before the parent is sent to pay. The gateway's
  // webhook books a payment by finding its link; a link that lived only in
  // this server's memory is money with nothing to book it against once the
  // instance restarts (two of the first three checkouts, found 14 Sep 2026).
  const { pushPaymentLinkToDb } =
    await import("@/lib/paymentsNormalized.server");
  const saved = await pushPaymentLinkToDb(link);
  if (!saved.ok) {
    console.error(
      "[parent-checkout] payment link not saved",
      link.id,
      saved.error,
    );
    return {
      status: 503,
      body: {
        error:
          "Could not start payment just now — please try again in a minute",
      },
    };
  }
  const shareUrl = buildPaymentShareUrlAbsolute(
    publicAppOrigin(),
    buildEnrichedPaymentSharePayload(link, TENANT.nameDisplay, masters),
  );

  return {
    status: 200,
    body: {
      ok: true,
      linkId: link.id,
      code: link.code,
      amountPaise: link.amountPaise,
      methodGroup: methodGroup ?? null,
      checkoutUrl: gw.ok ? gw.checkoutUrl : null,
      shareUrl,
    },
  };
}
