import { NextResponse } from "next/server";
import { startNumberLink } from "@/lib/parentNumberLink.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

/**
 * POST /api/auth/link/start — a parent on a phone the school never recorded
 * names their child (admission number OR name, plus the exact date of birth).
 * One child on roll must match; a WhatsApp code then goes to the family's
 * REGISTERED number (lib/parentNumberLink).
 *
 * → { ok, linkId, maskedRegistered, childFirstName } | { needClass, classes } |
 *   { noMatch } | { noRegisteredPhone }
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  await ensureSchoolMirrorHydrated();
  const r = await startNumberLink({
    mobile: String(body.mobile ?? ""),
    childName: String(body.childName ?? "").slice(0, 120),
    admissionNo: String(body.admissionNo ?? "").slice(0, 40),
    dob: String(body.dob ?? "").slice(0, 10),
    className: String(body.className ?? "").slice(0, 40),
    ip,
  });
  switch (r.kind) {
    case "code_sent":
      return NextResponse.json({ ok: true, linkId: r.linkId, maskedRegistered: r.maskedRegistered, childFirstName: r.childFirstName });
    case "need_class":
      return NextResponse.json({ ok: false, needClass: true, classes: r.classes, error: "More than one child matches — choose the class." });
    case "no_match":
      return NextResponse.json({
        ok: false,
        noMatch: true,
        error: "No child on roll matches these details. Check the date of birth, or send the details to the school office.",
      });
    case "no_registered_phone":
      return NextResponse.json({ ok: false, noRegisteredPhone: true, error: "The school has no phone on record for this family — send the details to the office." });
    default:
      return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
