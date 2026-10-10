/**
 * "Is this the parent's WhatsApp number?" — asked from the desk.
 *
 * GET  → every established verdict, so the roster and the fee counter can
 *        show which families are not reachable on WhatsApp.
 * POST → check ONE number with Meta and record the answer, which is what
 *        makes the reminder disappear for that family for good.
 *
 * Open to the two desks that meet parents: Students (the roster) and Fees
 * (the counter). Collecting a phone number is not an Automation task, and
 * gating it behind the Automation grant is why nobody ever fixed these.
 */

import { NextResponse } from "next/server";
import { requireAnyStaffPermission } from "@/lib/apiRouteAuth.server";
import type { RbacAction, RbacModule } from "@/lib/rbac";
import { checkWhatsAppContacts, waOutboundConfigured } from "@/lib/waSend";
import { recordWaNumberVerdicts } from "@/lib/waNumberHealth.server";
import { readWaNumberVerdicts } from "@/lib/waNumberVerdicts.server";

export const runtime = "nodejs";

const DESKS: readonly { module: RbacModule; action: RbacAction }[] = [
  { module: "students", action: "view" },
  { module: "fees", action: "view" },
  { module: "notifications", action: "view" },
  { module: "wa_automation", action: "view" },
];

function contactsConfigured(): boolean {
  return waOutboundConfigured() || !!process.env.WA_BSP_CONTACTS_URL;
}

export async function GET(req: Request) {
  const auth = await requireAnyStaffPermission(req, DESKS);
  if (!auth.ok) return auth.response;

  const read = await readWaNumberVerdicts();
  if (!read.ok) {
    // "No verdicts" and "the read failed" must not look the same: the desk
    // shows a quiet warning instead of a clean bill of health.
    return NextResponse.json(
      { ok: false, error: read.error || "Could not read number verdicts" },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    configured: contactsConfigured(),
    verdicts: read.verdicts,
  });
}

export async function POST(req: Request) {
  const auth = await requireAnyStaffPermission(req, DESKS);
  if (!auth.ok) return auth.response;

  let body: { mobile?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const digits = String(body.mobile || "").replace(/\D/g, "");
  const mobile10 =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits;
  if (mobile10.length !== 10 || !/^[6-9]/.test(mobile10)) {
    return NextResponse.json(
      { error: "Enter a 10-digit Indian mobile number" },
      { status: 400 },
    );
  }

  if (!contactsConfigured()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      onWhatsApp: null,
      mobile: mobile10,
      error:
        "WhatsApp is not connected yet, so Meta cannot be asked. Save the number and it will be confirmed on the first message.",
    });
  }

  const check = await checkWhatsAppContacts([mobile10]);
  const result = check.results.find(
    (r) =>
      (r.local10 || r.input || "").replace(/\D/g, "").slice(-10) === mobile10,
  );
  // Only "on_whatsapp" / "not_on_whatsapp" are answers. "unknown" means the
  // provider did not say and "invalid_format" is a typing problem — neither
  // is a verdict, and neither may be stored as one.
  const onWhatsApp =
    result?.status === "on_whatsapp"
      ? true
      : result?.status === "not_on_whatsapp"
        ? false
        : null;

  // Only an ESTABLISHED answer is written. Meta refusing the lookup (some
  // Cloud API accounts do) must not be filed as "not on WhatsApp" — that
  // would put a working number on the school's bad-numbers list.
  if (onWhatsApp !== null) {
    await recordWaNumberVerdicts([{ mobile: mobile10, onWhatsApp }], "contacts_api");
  }

  return NextResponse.json({
    ok: check.ok && onWhatsApp !== null,
    configured: true,
    mobile: mobile10,
    onWhatsApp,
    mode: check.mode,
    error:
      onWhatsApp === null
        ? check.error ||
          "Meta did not answer for this number. Save it and it will be confirmed on the first message."
        : undefined,
  });
}
