import { NextResponse } from "next/server";
import { normalizeMobile10, resolveEmailForMobile } from "@/lib/authProvisioning.server";

export const runtime = "nodejs";

type Body = { persona?: string; mobile?: string };

/**
 * POST — resolve a phone number to the email its account actually signs
 * in with.
 *
 * Supabase's Phone auth provider is disabled on this project (verified
 * with a throwaway test account before this shipped — signInWithPassword
 * with { phone, password } fails outright). Every account provisioned
 * through /api/auth/first-login/set-password has a real-or-synthetic
 * email either way, so "sign in by phone" resolves here first, then the
 * client calls signInWithPassword({ email, password }) — Supabase only
 * ever sees email-based sign-in, regardless of what the person typed.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const persona =
    body.persona === "staff" || body.persona === "field"
      ? body.persona
      : "parent";
  const mobile10 = normalizeMobile10(body.mobile || "");
  if (!mobile10) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid 10-digit mobile number" },
      { status: 400 },
    );
  }

  const email = await resolveEmailForMobile(persona, mobile10);
  if (!email) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No account found for this number yet — use \"First time here?\" below to set one up.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, email });
}
