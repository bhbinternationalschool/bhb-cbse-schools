import { NextResponse } from "next/server";
import { finishNumberLink } from "@/lib/parentNumberLink.server";
import { parentSessionResponse } from "@/lib/parentSession.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * POST /api/auth/link/verify { linkId, code } — the code that went to the
 * family's registered phone. Right → the new number is linked to the family
 * and the parent is signed in (as an OTP login would).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const linkId = String(body.linkId ?? "").slice(0, 60);
  const code = String(body.code ?? "").replace(/\D/g, "");
  if (!linkId || code.length !== 6) return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  const r = await finishNumberLink(linkId, code);
  if (!r.ok) return NextResponse.json({ error: r.message }, { status: r.status });
  await ensureSchoolMirrorHydrated();
  const household = loadSis().households.find((h) => h.id === r.householdId);
  if (!household) return NextResponse.json({ error: "Linked — now log in with this number." }, { status: 409 });
  return parentSessionResponse({
    household,
    checkInactive: true,
    auditSummary: `Parent linked number ${r.mobile10.slice(-4)} (code to the registered phone) and logged in`,
  });
}
