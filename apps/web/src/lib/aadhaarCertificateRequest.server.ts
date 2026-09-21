import "server-only";

/**
 * A parent asks on WhatsApp for the school's Aadhaar certificate.
 *
 * The office decides, signs and stamps — the bot only does the paperwork
 * around it (the school's choice, 21 Sep 2026: "office signs, then send"):
 *  1. the certificate is filled from the ERP, one per child who needs it;
 *  2. it goes to the office phone through the office relay, with its #code;
 *  3. the principal prints it, the child's photo is pasted and cross-signed
 *     and cross-stamped, it is signed and stamped;
 *  4. the office swipe-replies to the forward with a photo of the signed
 *     copy, and the relay sends it to the parent (handleRelayReply). The
 *     original is collected from the office — the Aadhaar centre needs it.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { childrenOfHousehold, loadSis } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { currentAcademicYearCode } from "@/lib/masters";
import { classLabel } from "@/lib/homework";
import { composeCertificateRequestAck } from "@/lib/aadhaarCertificate";

const REASON = "Aadhaar certificate (UIDAI format)";

export async function handleAadhaarCertificateRequest(input: {
  mobile10: string;
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  hindi: boolean;
}): Promise<{ handled: boolean; reply: string }> {
  await ensureSisHydratedServer();
  const { findHouseholdByWaMobile } = await import("@/lib/waSisBotServer");
  const hh = findHouseholdByWaMobile(input.mobile10);
  if (!hh) return { handled: false, reply: "" };
  const masters = await loadServerMasters();
  const kids = childrenOfHousehold(loadSis(), hh.id, currentAcademicYearCode(masters)).filter((s) => s.status === "active");
  if (!kids.length) return { handled: false, reply: "" };

  // The child named in the message; else the children with no Aadhaar;
  // else (an update) every child.
  const low = input.text.toLowerCase();
  const named = kids.filter((k) => {
    const first = (k.fullName.split(/\s+/)[0] || "").toLowerCase();
    return first.length >= 3 && low.includes(first);
  });
  const noAadhaar = kids.filter((k) => !/\d{12}/.test((k.aadhaarNumber || "").replace(/\D/g, "")) && !/\d{4}/.test(k.aadhaarLast4 || ""));
  const targets = named.length ? named : noAadhaar.length ? noAadhaar : kids;

  // Already asked this week: say so rather than print it twice.
  const ctx = await getServerTenantContext();
  if (ctx) {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data } = await ctx.sb
      .from("wa_relay_messages")
      .select("id, inbound_text")
      .eq("tenant_id", ctx.tenantId)
      .eq("household_id", hh.id)
      .eq("reason", REASON)
      .gte("created_at", since)
      .limit(10);
    const done = new Set(((data ?? []) as { inbound_text: string }[]).map((r) => r.inbound_text));
    const pending = targets.filter((k) => ![...done].some((t) => t.includes(k.fullName)));
    if (!pending.length) {
      return {
        handled: true,
        reply: composeCertificateRequestAck({ childNames: targets.map((k) => k.fullName), hindi: input.hindi, alreadyRequested: true }),
      };
    }
    targets.splice(0, targets.length, ...pending);
  }

  const { buildAadhaarCertificate } = await import("@/lib/aadhaarCertificate.server");
  const { relayEscalation } = await import("@/lib/waRelay.server");
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  for (const k of targets) {
    const cert = await buildAadhaarCertificate(k.id, today);
    const gaps = cert.ok
      ? [
          ...cert.blank.filter((b) => !/House|Street|Landmark/.test(b)).map((b) => `${b} (blank — write by pen)`),
          ...cert.overflow.map((o) => `${o.field}: "${o.rest}" did not fit`),
        ]
      : [];
    await relayEscalation({
      fromWaId: input.fromWaId,
      text: [
        `${REASON} requested for ${k.fullName} (${classLabel(masters, k.classId, k.sectionId).replace(" · ", " ")}).`,
        `Parent's message: "${input.text.slice(0, 200)}"`,
        "To do: print the attached form on plain A4 · paste the child's recent colour photo and cross-sign + cross-stamp it · principal signs and stamps · parent/child signs in the box.",
        gaps.length ? `Check: ${gaps.join("; ")}.` : "",
        "Then swipe-reply to THIS message with a photo of the signed certificate — it goes to the parent. Keep the original for them to collect.",
      ].filter(Boolean).join("\n"),
      waMessageId: input.waMessageId ? `${input.waMessageId}:cert:${k.id}` : undefined,
      profileName: input.profileName,
      audience: "sis_parent",
      category: "parent",
      reason: REASON,
      attachment: cert.ok
        ? { bytes: cert.pdf, filename: cert.fileName, mimeType: "application/pdf", caption: `Aadhaar certificate — ${k.fullName}` }
        : null,
    }).catch((e) => console.warn("[aadhaar-cert] relay failed", k.id, (e as Error)?.message));
  }

  return {
    handled: true,
    reply: composeCertificateRequestAck({ childNames: targets.map((k) => k.fullName), hindi: input.hindi, alreadyRequested: false }),
  };
}
