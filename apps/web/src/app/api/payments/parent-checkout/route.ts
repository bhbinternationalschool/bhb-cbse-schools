/**
 * Parent portal — start an online fee payment for the parent's own household.
 * The client sends only dueKeys; amounts and dues are recomputed server-side
 * (never trust client amounts), the pay-link is created server-side, and the
 * live gateway checkout is attached. The webhook settles it like any link.
 */

import { NextResponse } from "next/server";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import {
  computeHouseholdDues,
  loadFees,
  openFeeDues,
} from "@/lib/fees";
import { loadMasters } from "@/lib/masters";
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
import { publicAppOrigin } from "@/lib/waSisBotServer";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";
import { householdWhatsApp, loadSis } from "@/lib/sis";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let householdId: string;
  try {
    const ctx = await resolveApiAuth(req);
    if (ctx.session.persona !== "parent" || !ctx.session.householdId) {
      return NextResponse.json(
        { error: "Parent session required" },
        { status: 403 },
      );
    }
    householdId = ctx.session.householdId;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof ApiError ? e.message : "Unauthorized" },
      { status: 401 },
    );
  }

  let body: { dueKeys?: string[]; studentId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const wanted = new Set(
    (Array.isArray(body.dueKeys) ? body.dueKeys : []).filter(
      (k): k is string => typeof k === "string",
    ),
  );
  if (wanted.size === 0) {
    return NextResponse.json({ error: "dueKeys required" }, { status: 400 });
  }

  await ensureSchoolMirrorLoaded();
  const sis = loadSis();
  const masters = loadMasters();
  const fees = loadFees();
  const hh = sis.households.find((h) => h.id === householdId);
  if (!hh) {
    return NextResponse.json({ error: "Household not found" }, { status: 404 });
  }

  // A family may pay months ahead from the app, so the recomputation must
  // see them; only the dueKeys the parent chose are collected, and amounts
  // still come from here, never from the client.
  const bundle = computeHouseholdDues(hh.id, sis, masters, fees, {
    includeFuture: true,
  });
  const dues = openFeeDues(bundle.flatMap((r) => r.dues)).filter(
    (d) => wanted.has(d.dueKey) && d.balancePaise > 0,
  );
  if (dues.length === 0) {
    return NextResponse.json(
      { error: "Nothing left to pay on the selected fees" },
      { status: 400 },
    );
  }

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
  };
  const gw = shouldUseCashfreeCheckout()
    ? await attachCashfreeToPaymentLink(attachOpts)
    : await attachRazorpayToPaymentLink(attachOpts);

  const link = gw.ok ? gw.link : created.link;
  const shareUrl = buildPaymentShareUrlAbsolute(
    publicAppOrigin(),
    buildEnrichedPaymentSharePayload(link, TENANT.nameDisplay, masters),
  );

  return NextResponse.json({
    ok: true,
    linkId: link.id,
    code: link.code,
    amountPaise: link.amountPaise,
    checkoutUrl: gw.ok ? gw.checkoutUrl : null,
    shareUrl,
  });
}
