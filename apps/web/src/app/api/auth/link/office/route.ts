import { NextResponse } from "next/server";
import { requestOfficeLink } from "@/lib/parentNumberLink.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

/**
 * POST /api/auth/link/office — a parent without the family's registered
 * phone (or whose details matched nobody) asks the office to link this
 * number. Shown in Comms with the matched child, approved with one tap.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  await ensureSchoolMirrorHydrated();
  const r = await requestOfficeLink({
    mobile: String(body.mobile ?? ""),
    childName: String(body.childName ?? ""),
    admissionNo: String(body.admissionNo ?? ""),
    dob: String(body.dob ?? ""),
    className: String(body.className ?? ""),
    note: String(body.note ?? ""),
    ip,
  });
  return r.ok
    ? NextResponse.json({ ok: true, message: "Sent to the school office. You will be able to log in with this number once they confirm." })
    : NextResponse.json({ ok: false, error: r.message }, { status: r.status });
}
