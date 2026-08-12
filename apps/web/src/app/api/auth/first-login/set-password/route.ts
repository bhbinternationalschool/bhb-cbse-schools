import { NextResponse } from "next/server";
import {
  findOrCreateAuthUser,
  normalizeMobile10,
  resolvePersonByMobile,
  setAuthUserPassword,
  upsertProfile,
  validatePasswordStrength,
} from "@/lib/authProvisioning.server";
import { verifyParentOtp } from "@/lib/parentOtp.server";

export const runtime = "nodejs";

type Body = {
  persona?: string;
  mobile?: string;
  code?: string;
  password?: string;
  confirmPassword?: string;
};

/**
 * POST — verify the first-time OTP, then create/link a Supabase Auth
 * account and set the password the person just chose.
 *
 * Returns { ok: true } only — it does not mint a session. The client
 * signs in immediately after with the normal signInWithPassword flow,
 * reusing /api/auth/session exactly as every other login does, rather
 * than duplicating session-minting logic in a second place.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const persona = body.persona === "staff" ? "staff" : "parent";
  const mobile10 = normalizeMobile10(body.mobile || "");
  const code = (body.code || "").trim();
  const password = body.password || "";
  const confirmPassword = body.confirmPassword || "";

  if (!mobile10 || !code) {
    return NextResponse.json(
      { ok: false, error: "Mobile and OTP are required" },
      { status: 400 },
    );
  }
  if (password !== confirmPassword) {
    return NextResponse.json(
      { ok: false, error: "Passwords do not match" },
      { status: 400 },
    );
  }
  const weak = validatePasswordStrength(password);
  if (weak) {
    return NextResponse.json({ ok: false, error: weak }, { status: 400 });
  }

  const verified = await verifyParentOtp({ mobile: mobile10, code });
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.reason }, { status: 401 });
  }

  // Re-resolve rather than trust the OTP payload's householdId alone —
  // this also gives us the staff/parent's name, email and tenant, needed
  // to create the auth account and profile row.
  const person = await resolvePersonByMobile(persona, mobile10);
  if (!person) {
    return NextResponse.json(
      { ok: false, error: "No matching record found for this number" },
      { status: 404 },
    );
  }

  const account = await findOrCreateAuthUser({
    mobile10,
    email: person.email || undefined,
    fullName: person.fullName,
  });
  if (!account.ok) {
    return NextResponse.json({ ok: false, error: account.error }, { status: 502 });
  }

  // account.email is the real-or-synthetic email actually set on the auth
  // user (findOrCreateAuthUser guarantees one exists either way) — not
  // person.email, which is blank whenever this account is synthetic-only.
  // profiles.email has to match the auth account exactly, since
  // resolveEmailForMobile reads it back to resolve phone-based sign-in.
  const profile = await upsertProfile({
    authUserId: account.userId,
    tenantId: person.tenantId,
    persona,
    fullName: person.fullName,
    email: account.email,
    mobile10,
  });
  if (!profile.ok) {
    return NextResponse.json({ ok: false, error: profile.error }, { status: 502 });
  }

  const pw = await setAuthUserPassword(account.userId, password);
  if (!pw.ok) {
    return NextResponse.json({ ok: false, error: pw.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    // The email to actually sign in with — real if the person has one on
    // file, synthetic otherwise. Never person.email directly: that's
    // blank for synthetic-only accounts, and the client needs something
    // that works right now to complete this same sign-in.
    email: account.email,
    hasRealEmail: !!person.email,
  });
}
