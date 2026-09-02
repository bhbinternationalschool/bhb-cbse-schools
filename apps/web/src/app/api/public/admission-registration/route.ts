import { NextResponse } from "next/server";
import {
  confirmAdmissionLinkPayment,
  loadAdmissionLinkPrefill,
  registerFromAdmissionLink,
} from "@/lib/publicAdmissionRegistration.server";

export const runtime = "nodejs";

/**
 * Public, but never open: every request must carry a token this server
 * signed for one household (lib/admissionLinkToken.server.ts). Without a
 * valid, unexpired token nothing is read or written, and the reply says
 * only that the link is not valid — never whether a household exists.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing link" }, { status: 400 });
  }
  const prefill = await loadAdmissionLinkPrefill(token);
  if (!prefill) {
    return NextResponse.json(
      { ok: false, error: "This registration link is no longer valid" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, prefill });
}

type RegisterBody = {
  action?: "register";
  token?: string;
  guardianName?: string;
  motherName?: string;
  feeHeadId?: string;
  feeHeadName?: string;
  children?: { childName?: string; classSoughtId?: string; feeAmountPaise?: number }[];
  consent?: boolean;
  /** The separate, optional photographs tick. */
  photoConsent?: boolean;
  preferredLanguage?: string;
};

type ConfirmBody = {
  action: "confirm";
  token?: string;
  paymentId?: string;
  upiRef?: string;
  leadIds?: string[];
  feeHeadName?: string;
};

export async function POST(req: Request) {
  let body: RegisterBody | ConfirmBody;
  try {
    body = (await req.json()) as RegisterBody | ConfirmBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const token = (body.token || "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing link" }, { status: 400 });
  }

  if (body.action === "confirm") {
    const r = await confirmAdmissionLinkPayment({
      token,
      paymentId: (body.paymentId || "").trim(),
      upiRef: (body.upiRef || "").trim(),
      leadIds: Array.isArray(body.leadIds) ? body.leadIds : [],
      feeHeadName: (body.feeHeadName || "Registration fee").trim(),
    });
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: r.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true, step: r.step });
  }

  const children = (body.children || [])
    .map((c) => ({
      childName: (c.childName || "").trim(),
      classSoughtId: (c.classSoughtId || "").trim(),
      feeAmountPaise: Math.max(0, Math.round(Number(c.feeAmountPaise) || 0)),
    }))
    .filter((c) => c.childName);

  const r = await registerFromAdmissionLink({
    token,
    guardianName: (body.guardianName || "").trim(),
    motherName: (body.motherName || "").trim(),
    feeHeadId: (body.feeHeadId || "").trim(),
    feeHeadName: (body.feeHeadName || "Registration fee").trim(),
    children,
    consent: body.consent === true,
    photoConsent: body.photoConsent === true,
    preferredLanguage: String(body.preferredLanguage || "").trim().slice(0, 10),
  });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, leadIds: r.leadIds, step: r.step });
}
