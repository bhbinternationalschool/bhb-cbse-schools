import "server-only";

/**
 * APAAR consent on WhatsApp — asking, and recording the tap. See
 * lib/apaarConsent.ts for why it is two buttons and not a printed form.
 */

import { writeAudit } from "@/lib/audit.server";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { Household, SisStudent } from "@/lib/sis";
import { pushSisToDb, rowToStudent } from "@/lib/sisNormalized.server";
import {
  apaarConsentButtons,
  apaarConsentPending,
  composeApaarConsentAsk,
  composeApaarConsentThanks,
  isApaarConsentRequest,
  parseApaarConsentReply,
} from "@/lib/apaarConsent";

export const APAAR_ASK_PURPOSE = "apaar_consent_ask";

/** Asked this family in the last 7 days (by any path). Unreadable counts as asked. */
export async function apaarAskedRecently(householdId: string): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return true;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await ctx.sb
    .from("household_message_log")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", householdId)
    .eq("purpose", APAAR_ASK_PURPOSE)
    .eq("status", "sent")
    .gte("created_at", since)
    .limit(1);
  if (error) return true;
  return (data ?? []).length > 0;
}

/**
 * Send the consent question with its two buttons, inside a window the
 * parent opened. Returns false when nobody needs asking or it was asked
 * this week (unless `force`: the parent asked for it).
 */
export async function sendApaarConsentAsk(input: {
  mobile10: string;
  household: Household;
  children: SisStudent[];
  hindi: boolean;
  force?: boolean;
}): Promise<boolean> {
  const pending = apaarConsentPending(input.children);
  if (!pending.length) return false;
  if (!input.force && (await apaarAskedRecently(input.household.id))) return false;
  const { sendWhatsAppReplyButtons } = await import("@/lib/waInteractive");
  const body = composeApaarConsentAsk({
    guardianName: input.household.guardianName || "",
    childNames: pending.map((c) => c.fullName),
    hindi: input.hindi,
  });
  const r = await sendWhatsAppReplyButtons({
    toMobile: input.mobile10,
    body,
    footer: input.hindi ? "शिक्षा मंत्रालय — APAAR ID" : "Ministry of Education — APAAR ID",
    buttons: apaarConsentButtons(input.hindi),
  });
  await logHouseholdWaSend({
    mobile: input.mobile10,
    purpose: APAAR_ASK_PURPOSE,
    via: "text",
    preview: `APAAR consent asked: ${pending.map((c) => c.fullName).join(", ")}`,
    status: r.ok ? "sent" : "failed",
    error: r.ok ? undefined : r.error,
    waMessageId: r.providerId,
  }).catch(() => undefined);
  return r.ok;
}

/**
 * The parent's tap (or "APAAR" to be asked again). Returns the reply to
 * send, or null when the message is not about APAAR consent.
 */
export async function handleApaarConsentInbound(input: {
  household: Household;
  children: SisStudent[];
  mobile10: string;
  text: string;
  hindi: boolean;
  waMessageId?: string;
}): Promise<string | null> {
  const answer = parseApaarConsentReply(input.text);
  if (!answer) {
    if (!isApaarConsentRequest(input.text)) return null;
    // "APAAR": ask again — including a family that said no and changed its mind.
    const again = input.children
      .filter((c) => c.status === "active" && !(c.apaarId || "").trim())
      .map((c) => ({ ...c, apaarConsent: "" as const }));
    if (!again.length) {
      return input.hindi ? "✅ आपके सभी बच्चों की APAAR ID पहले से बनी हुई है।" : "✅ All your children already have an APAAR ID.";
    }
    const sent = await sendApaarConsentAsk({ ...input, children: again, force: true });
    return sent ? (input.hindi ? "👆 ऊपर के संदेश में एक बटन दबाइए।" : "👆 Please tap a button in the message above.") : input.hindi ? "क्षमा करें, अभी सहमति का संदेश नहीं भेज सके। थोड़ी देर बाद *APAAR* लिखकर फिर भेजें।" : "Sorry — the consent message could not be sent just now. Please send *APAAR* again in a few minutes.";
  }

  // Everyone without an APAAR ID: the parent answered for the children
  // the question named. A child who already has an APAAR ID needs nothing.
  const targets = input.children.filter((c) => c.status === "active" && !(c.apaarId || "").trim());
  if (!targets.length) {
    return input.hindi ? "✅ आपके सभी बच्चों की APAAR ID पहले से बनी हुई है। धन्यवाद 🙏" : "✅ All your children already have an APAAR ID. Thank you 🙏";
  }

  const ctx = await getServerTenantContext();
  if (!ctx) return input.hindi ? "क्षमा करें, अभी दर्ज नहीं हो सका। थोड़ी देर बाद बटन फिर दबाएँ।" : "Sorry — that could not be recorded just now. Please tap the button again in a few minutes.";

  const at = new Date().toISOString();
  const by = [
    input.household.guardianName || "Parent",
    `WhatsApp +91${input.mobile10}`,
    input.waMessageId ? `msg ${input.waMessageId.slice(-24)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const recorded: string[] = [];
  for (const child of targets) {
    // The stored row, not the in-memory copy: its version is what the
    // guarded push checks, and a stale one is refused as a conflict.
    const { data } = await ctx.sb.from("sis_students").select("*").eq("tenant_id", ctx.tenantId).eq("id", child.id).maybeSingle();
    if (!data) continue;
    const current = rowToStudent(data as Parameters<typeof rowToStudent>[0]);
    const next: SisStudent = { ...current, apaarConsent: answer, apaarConsentAt: at, apaarConsentBy: by };
    const push = await pushSisToDb({ households: [], students: [next] });
    if (!push.ok || push.studentCount < 1) {
      console.warn("[apaar-consent] not saved", child.id, push.ok ? "conflict" : push.error);
      continue;
    }
    recorded.push(child.fullName);
    await writeAudit({
      module: "sis",
      action: "edit",
      entityType: "student",
      entityId: child.id,
      summary: `APAAR consent ${answer === "given" ? "GIVEN" : "REFUSED"} by parent on WhatsApp`,
      before: { apaarConsent: current.apaarConsent || "" },
      after: { apaarConsent: answer, apaarConsentAt: at, apaarConsentBy: by },
    }).catch(() => null);
  }
  if (!recorded.length) {
    return input.hindi ? "क्षमा करें, अभी दर्ज नहीं हो सका। थोड़ी देर बाद बटन फिर दबाएँ।" : "Sorry — that could not be recorded just now. Please tap the button again in a few minutes.";
  }
  return composeApaarConsentThanks({ answer, childNames: recorded, hindi: input.hindi });
}
