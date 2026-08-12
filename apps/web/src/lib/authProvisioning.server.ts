/**
 * First-time login: verify a phone number via the existing WhatsApp OTP
 * mechanism (lib/parentOtp.server.ts — already Meta-approved, already
 * proven, unchanged here), then create or link a real Supabase Auth
 * account and let the person set their own password.
 *
 * Reuses profiles as the identity-linking table exactly as
 * /api/auth/session already does for staff (matching auth_user_id ->
 * sis_staff by email) — this just does the same for parents (by mobile,
 * since profiles has no household_id column) and adds the piece neither
 * path had: creating the Supabase Auth user in the first place. Staff
 * accounts today are created outside the app entirely (checked
 * scripts/bootstrap-go-live.mts — it only links an existing auth user to
 * the tenant, never creates one). This is the first in-app account
 * creation path for either persona.
 *
 * Once a password is set, sign-in works with either the phone or the
 * email attached to the account — both are set on the Supabase Auth user
 * here, and signInWithPassword accepts either natively.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { normalizeMobile10 } from "@/lib/parentOtp.server";

export { normalizeMobile10 };

/** Supabase's phone field wants E.164 without the +. India-only today,
 *  matching normalizeMobile10's own assumption (10 digits, optional
 *  leading 91 stripped). */
export function toE164Phone(mobile10: string): string {
  return `91${mobile10}`;
}

export type ResolvedPerson = {
  fullName: string;
  email: string;
  tenantId: string;
  staffId?: string;
  householdId?: string;
};

/**
 * Find the active staff or household record a mobile number belongs to.
 * Required before ever sending an OTP or creating an account — a random
 * phone number must not be able to provision itself a login just by
 * receiving a WhatsApp code.
 */
export async function resolvePersonByMobile(
  persona: "staff" | "parent",
  mobile10: string,
): Promise<ResolvedPerson | null> {
  const sb = createServiceSupabase();
  if (!sb) return null;

  if (persona === "staff") {
    const { data } = await sb
      .from("sis_staff")
      .select("id, tenant_id, full_name, email, mobile, status")
      .eq("mobile", mobile10)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return {
      fullName: (data.full_name as string) || "",
      email: (data.email as string) || "",
      tenantId: data.tenant_id as string,
      staffId: data.id as string,
    };
  }

  const { data } = await sb
    .from("sis_households")
    .select("id, tenant_id, guardian_name, email, mobile, whatsapp_mobile, alt_mobile")
    .or(
      `mobile.eq.${mobile10},whatsapp_mobile.eq.${mobile10},alt_mobile.eq.${mobile10}`,
    )
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    fullName: (data.guardian_name as string) || "Parent",
    email: (data.email as string) || "",
    tenantId: data.tenant_id as string,
    householdId: data.id as string,
  };
}

/**
 * Find an existing Supabase Auth user by phone or email, or create one.
 * Supabase's admin API has no direct getUserByPhone/getUserByEmail
 * lookup — listUsers + filter is the same pattern
 * scripts/bootstrap-go-live.mts already uses for email. Paginated at
 * 1000, matching that script; revisit if the user base ever exceeds it.
 */
/**
 * Non-deliverable placeholder for accounts with no real email on file.
 * Verified live (throwaway test account, deleted after): this Supabase
 * project has its Phone auth provider disabled — signInWithPassword({
 * phone, password }) fails with "Phone logins are disabled". Enabling it
 * is a Supabase dashboard setting this session cannot reach or verify,
 * and it may also require configuring an SMS provider Supabase doesn't
 * need to actually use here (the WhatsApp OTP is entirely separate).
 * Rather than depend on that, every account gets a real-or-synthetic
 * email, and "sign in by phone" resolves to that email server-side
 * (see resolveEmailForMobile) before ever calling Supabase — sign-in is
 * always email-based under the hood, so it works today regardless of
 * that provider's state, and costs nothing if it's ever enabled later.
 */
function syntheticEmailFor(mobile10: string): string {
  return `p${mobile10}@auth.internal`;
}

export async function findOrCreateAuthUser(opts: {
  mobile10: string;
  email?: string;
  fullName: string;
}): Promise<
  | { ok: true; userId: string; isNew: boolean; email: string }
  | { ok: false; error: string }
> {
  const sb = createServiceSupabase();
  if (!sb) return { ok: false, error: "Supabase admin client unavailable" };

  const phone = toE164Phone(opts.mobile10);
  const realEmail = opts.email?.trim() || "";
  const emailKey = realEmail.toLowerCase();
  const finalEmail = realEmail || syntheticEmailFor(opts.mobile10);

  const { data: listed, error: listErr } = await sb.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listErr) {
    return { ok: false, error: `User lookup failed: ${listErr.message}` };
  }
  const existing = listed.users.find(
    (u) =>
      u.phone === phone ||
      (emailKey && (u.email || "").toLowerCase() === emailKey) ||
      (u.email || "").toLowerCase() === syntheticEmailFor(opts.mobile10),
  );
  if (existing) {
    // Attach whichever identifier was missing, so both work going forward.
    const patch: { phone?: string; email?: string } = {};
    if (existing.phone !== phone) patch.phone = phone;
    const existingEmailKey = (existing.email || "").toLowerCase();
    if (emailKey && existingEmailKey !== emailKey) {
      patch.email = realEmail;
    }
    if (Object.keys(patch).length > 0) {
      await sb.auth.admin.updateUserById(existing.id, patch);
    }
    return {
      ok: true,
      userId: existing.id,
      isNew: false,
      email: patch.email || existing.email || finalEmail,
    };
  }

  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    phone,
    email: finalEmail,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: opts.fullName },
  });
  if (createErr || !created.user) {
    return { ok: false, error: createErr?.message || "Account creation failed" };
  }
  return { ok: true, userId: created.user.id, isNew: true, email: finalEmail };
}

/**
 * Resolve a mobile number to the email its account signs in with — real
 * or synthetic. Used by phone-based sign-in: the client sends the phone
 * number the person typed, this resolves it server-side, and the client
 * then calls signInWithPassword({ email, password }) with the result —
 * Supabase never sees the phone number as a sign-in credential.
 */
export async function resolveEmailForMobile(
  persona: "staff" | "parent",
  mobile10: string,
): Promise<string | null> {
  const sb = createServiceSupabase();
  if (!sb) return null;

  const person = await resolvePersonByMobile(persona, mobile10);
  if (!person) return null;

  const { data } = await sb
    .from("profiles")
    .select("email")
    .eq("tenant_id", person.tenantId)
    .eq("mobile", mobile10)
    .maybeSingle();
  if (data?.email) return data.email as string;

  // No profile yet — account was never provisioned via first-login.
  return null;
}

/**
 * Upsert the profiles row linking this auth user to their school identity
 * — the same table /api/auth/session already reads to resolve persona,
 * name, and (for staff) staffId.
 */
export async function upsertProfile(input: {
  authUserId: string;
  tenantId: string;
  persona: "staff" | "parent";
  fullName: string;
  email: string;
  mobile10: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = createServiceSupabase();
  if (!sb) return { ok: false, error: "Supabase admin client unavailable" };

  const { data: existing } = await sb
    .from("profiles")
    .select("id")
    .eq("auth_user_id", input.authUserId)
    .maybeSingle();

  const row = {
    auth_user_id: input.authUserId,
    tenant_id: input.tenantId,
    persona: input.persona,
    full_name: input.fullName,
    email: input.email || null,
    mobile: input.mobile10,
    is_active: true,
  };

  const { error } = existing
    ? await sb.from("profiles").update(row).eq("id", existing.id)
    : await sb.from("profiles").insert({ ...row, language: "en" });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

const MIN_PASSWORD_LENGTH = 8;

export function validatePasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

export async function setAuthUserPassword(
  userId: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const weak = validatePasswordStrength(password);
  if (weak) return { ok: false, error: weak };

  const sb = createServiceSupabase();
  if (!sb) return { ok: false, error: "Supabase admin client unavailable" };

  const { error } = await sb.auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
