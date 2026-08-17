/**
 * Parent OTP — WhatsApp delivery + Supabase persistence.
 */

import { randomInt } from "crypto";
import { hashOtpCode } from "@/lib/audit.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchServerBlob } from "@/lib/serverBlob";
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  buildWaTemplateBodyComponent,
  buildWaOtpCopyCodeButtonComponent,
} from "@/lib/waSend";
import {
  normalizeWaTemplatesState,
  getTemplateFamily,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { TENANT } from "@/lib/types";

const OTP_TEMPLATE_FAMILY = "auth_parent_login_otp";

/**
 * Send the OTP via the Meta-approved AUTHENTICATION template when one is
 * live — required once a parent hasn't messaged the bot in the last 24h,
 * which Meta's free-text session window otherwise blocks. Returns false
 * (never throws) on any missing/unapproved template or send failure, so the
 * caller always falls through to the existing free-text send.
 */
async function tryOtpLoginTemplateSend(
  mobile: string,
  code: string,
): Promise<boolean> {
  try {
    const { state: raw } = await fetchServerBlob<WaTemplatesState>(
      "wa_templates_state",
    );
    const state = normalizeWaTemplatesState(raw);
    const template = getTemplateFamily(state, OTP_TEMPLATE_FAMILY).find(
      (t) => t.language === "en" && t.status === "approved" && !t.paused,
    );
    if (!template) return false;
    const send = await sendWhatsAppTemplate({
      toMobile: mobile,
      name: template.metaName,
      language: template.metaLanguage || "en",
      components: [
        buildWaTemplateBodyComponent(["otp"], { otp: code }),
        buildWaOtpCopyCodeButtonComponent(code),
      ],
    });
    if (!send.ok) {
      console.warn(
        `[parent-otp] template send failed, falling back to text: ${send.error}`,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[parent-otp] template lookup/send error, falling back to text", e);
    return false;
  }
}

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** In-memory fallback when Supabase unavailable (dev). */
const memoryOtps = new Map<
  string,
  { hash: string; householdId?: string; expiresAt: number; attempts: number }
>();

function otpKey(tenantId: string, mobile: string) {
  return `${tenantId}:${mobile}`;
}

export function normalizeMobile10(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return d;
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  return null;
}

export async function issueParentOtp(opts: {
  mobile: string;
  householdId?: string;
  /** Free-text fallback message label — "Parent" (default) or "Staff".
   * The AUTHENTICATION template send above is unaffected: Meta approved
   * OTP_TEMPLATE_FAMILY under the "Parent" name specifically, so a
   * cold-start (outside-24h-window) message still reads "Parent Login"
   * until a dedicated staff template is approved. */
  loginLabel?: string;
}): Promise<{ ok: true; expiresInSec: number } | { ok: false; reason: string }> {
  const mobile = normalizeMobile10(opts.mobile);
  if (!mobile) return { ok: false, reason: "Enter a valid 10-digit mobile number" };

  const code = String(randomInt(100000, 999999));
  const hash = hashOtpCode(code);
  const expiresAt = Date.now() + OTP_TTL_MS;

  const ctx = await getServerTenantContext();
  if (ctx) {
    await ctx.sb.from("parent_otp_codes").insert({
      tenant_id: ctx.tenantId,
      mobile,
      code_hash: hash,
      household_id: opts.householdId || null,
      expires_at: new Date(expiresAt).toISOString(),
    });
  } else {
    memoryOtps.set(otpKey("local", mobile), {
      hash,
      householdId: opts.householdId,
      expiresAt,
      attempts: 0,
    });
  }

  const sentViaTemplate = await tryOtpLoginTemplateSend(mobile, code);
  if (!sentViaTemplate) {
    const label = opts.loginLabel || "Parent";
    const body =
      `*${TENANT.shortName} ${label} Login*\n\n` +
      `Your OTP is *${code}*. Valid for 10 minutes.\n\n` +
      `Do not share this code with anyone.`;

    const send = await sendWhatsAppText({ toMobile: mobile, body });
    if (!send.ok && send.mode !== "stub") {
      return { ok: false, reason: send.error || "Could not send OTP on WhatsApp" };
    }

    if (send.mode === "stub" && process.env.NODE_ENV === "development") {
      console.info(`[parent-otp] stub mode — OTP for ${mobile}: ${code}`);
    }
  }

  return { ok: true, expiresInSec: Math.floor(OTP_TTL_MS / 1000) };
}

export async function verifyParentOtp(opts: {
  mobile: string;
  code: string;
}): Promise<
  | { ok: true; householdId?: string }
  | { ok: false; reason: string }
> {
  const mobile = normalizeMobile10(opts.mobile);
  const code = opts.code.replace(/\D/g, "");
  if (!mobile || code.length !== 6) {
    return { ok: false, reason: "Invalid mobile or OTP" };
  }

  const hash = hashOtpCode(code);
  const ctx = await getServerTenantContext();

  if (ctx) {
    const { data: row } = await ctx.sb
      .from("parent_otp_codes")
      .select("id, code_hash, household_id, attempts, expires_at, verified_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("mobile", mobile)
      .is("verified_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) return { ok: false, reason: "OTP expired or not requested" };
    if (new Date(row.expires_at as string).getTime() < Date.now()) {
      return { ok: false, reason: "OTP expired — request a new one" };
    }
    if ((row.attempts as number) >= MAX_ATTEMPTS) {
      return { ok: false, reason: "Too many attempts — request a new OTP" };
    }
    if (row.code_hash !== hash) {
      await ctx.sb
        .from("parent_otp_codes")
        .update({ attempts: (row.attempts as number) + 1 })
        .eq("id", row.id);
      return { ok: false, reason: "Incorrect OTP" };
    }

    await ctx.sb
      .from("parent_otp_codes")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", row.id);

    return {
      ok: true,
      householdId: (row.household_id as string) || undefined,
    };
  }

  const mem = memoryOtps.get(otpKey("local", mobile));
  if (!mem || mem.expiresAt < Date.now()) {
    return { ok: false, reason: "OTP expired or not requested" };
  }
  if (mem.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: "Too many attempts" };
  }
  if (mem.hash !== hash) {
    mem.attempts += 1;
    return { ok: false, reason: "Incorrect OTP" };
  }
  memoryOtps.delete(otpKey("local", mobile));
  return { ok: true, householdId: mem.householdId };
}
