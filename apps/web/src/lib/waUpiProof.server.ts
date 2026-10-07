import "server-only";

/**
 * A UPI success screenshot sent to the school WhatsApp number by a member of
 * staff who pays people (Accounts or Payroll edit) — director, 7 Oct 2026:
 * "can we share screenshot on school whatsapp API number for auto fill UTR".
 *
 *   1. Read it (Google Vision → lib/upiPay).
 *   2. Find the one payment already in the ERP it pays (lib/upiProofMatch):
 *      a salary line on a posted payroll run, a staff advance, or an
 *      Accounts payment voucher marked UPI — exact amount, same person, no
 *      UTR recorded yet.
 *   3. Ask with buttons; record only on the sender's tap (upi_payment_proofs,
 *      lib/upiProofs.server). Nothing is recorded from the screenshot alone.
 *
 * Returns `handled:false` for anyone else, and for a photo that is not a
 * payment screenshot, so every other flow sees it exactly as before.
 */

import { loadServerMasters, loadServerRbac } from "@/lib/api/v1/auth";
import { staffSessionFor } from "@/lib/erpCommands.server";
import type { StaffRecord } from "@/lib/foundationMasters";
import { visionConfigured, visionExtractText } from "@/lib/googleVision.server";
import { hasPermission } from "@/lib/rbac";
import { parseUpiProofText } from "@/lib/upiPay";
import { matchUpiProof, parseUpiProofButton, upiProofButtonId } from "@/lib/upiProofMatch";
import {
  answerPendingUpiProof,
  createPendingUpiProof,
  findRecordedUtr,
  loadUpiCandidates,
  recordedUpiTargets,
} from "@/lib/upiProofs.server";
import { fetchWaMediaAsDataUrl } from "@/lib/waInboundMedia.server";
import { waNormalizeLocal10 } from "@/lib/waSend";
import { resolveWaIdentityServer } from "@/lib/waRoleResolver.server";

export type UpiProofReply = {
  text: string;
  buttons?: { id: string; title: string }[];
};

export type UpiProofOutcome =
  | { handled: false }
  | { handled: true; reply: UpiProofReply; audience: "upi_proof" };

function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** The staff member behind this number, if they may record payments. */
async function payingStaff(fromWaId: string): Promise<StaffRecord | null> {
  const identity = await resolveWaIdentityServer(fromWaId);
  const staff = identity.roles.find((r) => r.staff)?.staff;
  if (!staff) return null;
  const [masters, rbac] = await Promise.all([loadServerMasters(), loadServerRbac()]);
  const session = staffSessionFor(staff, masters);
  const may =
    hasPermission(session, masters, "accounts", "edit", rbac) ||
    hasPermission(session, masters, "payroll", "edit", rbac) ||
    hasPermission(session, masters, "staff_advances", "edit", rbac);
  return may ? staff : null;
}

/** Words a payment screen always carries; a bill or a class photo does not. */
function looksLikeUpiPayment(text: string): boolean {
  return /(UPI|UTR|transaction ID|Ref(?:erence)? No|Paid to|Payment successful|Completed)/i.test(text) && /(₹|Rs\.?|INR)\s*\d/.test(text);
}

export async function handleStaffUpiScreenshot(opts: {
  fromWaId: string;
  mediaId: string;
  mimeType?: string;
  waMessageId?: string;
}): Promise<UpiProofOutcome> {
  if (!opts.mediaId || !/^image\//i.test(opts.mimeType || "image/")) return { handled: false };
  if (!visionConfigured()) return { handled: false };
  const staff = await payingStaff(opts.fromWaId);
  if (!staff) return { handled: false };

  const media = await fetchWaMediaAsDataUrl(opts.mediaId);
  if (!media.ok) return { handled: false };
  const vision = await visionExtractText({
    imageBase64: media.dataUrl.replace(/^data:[^,]+,/, ""),
    mimeType: media.mimeType,
  });
  if (!vision.ok || !looksLikeUpiPayment(vision.text)) return { handled: false };

  const proof = parseUpiProofText(vision.text);
  const reply = (text: string, buttons?: UpiProofReply["buttons"]): UpiProofOutcome => ({
    handled: true,
    audience: "upi_proof",
    reply: { text, buttons },
  });

  if (proof.status === "failed") return reply("❌ This screenshot shows a FAILED UPI payment — nothing recorded.");
  if (proof.status === "pending") {
    return reply("⏳ This payment is still pending. Send the screenshot again once your UPI app shows it completed.");
  }
  if (!proof.utr) {
    return reply(
      "I could not read the UPI reference (UTR) on this screenshot. Open the payment in your UPI app, tap it for details, and send a screenshot that shows the 12-digit UPI transaction ID.",
    );
  }
  if (!proof.amountPaise) return reply(`I read UTR ${proof.utr} but no amount. Send a screenshot that shows the amount too.`);

  const already = await findRecordedUtr(proof.utr);
  if (already) return reply(`✅ UTR ${proof.utr} is already recorded on ${already.target_label}. Nothing to do.`);

  const [cands, recorded] = await Promise.all([loadUpiCandidates(), recordedUpiTargets()]);
  if (!cands.ok) {
    return reply("I could not read the ERP's payroll, advances or accounts just now — nothing recorded. Send the screenshot again in a few minutes.");
  }
  const matches = matchUpiProof(proof, cands.candidates, recorded.targets);
  const who = proof.payeeName || proof.payeeVpa || "the person paid";
  const summary = `${inr(proof.amountPaise)} to ${who}${proof.paidOn ? ` on ${proof.paidOn}` : ""} · UTR ${proof.utr}`;

  if (matches.length === 0) {
    return reply(
      `🧾 ${summary}\n\nNo payment of ${inr(proof.amountPaise)} to ${who} without a UTR is in the ERP — a posted salary, a staff advance, or a UPI payment voucher. Enter the payment in the ERP first, then send this screenshot again.`,
    );
  }

  const offered = matches.slice(0, 2);
  const pending = await createPendingUpiProof({
    proof,
    matches: offered,
    senderMobile: waNormalizeLocal10(opts.fromWaId),
    senderStaffId: staff.id,
    waMessageId: opts.waMessageId || "",
  });
  if (!pending.ok) return reply(`I read ${summary}, but could not save it (${pending.error}). Nothing recorded — try again.`);

  const weak = offered.some((m) => m.strength === "amount_only")
    ? "\n⚠️ The screenshot does not show who was paid — check it is the right one."
    : "";
  if (offered.length === 1) {
    return reply(`🧾 ${summary}\n\nRecord it on: *${offered[0]!.label}*?${weak}`, [
      { id: upiProofButtonId(pending.id, 0), title: "Yes, record" },
      { id: upiProofButtonId(pending.id, "no"), title: "No" },
    ]);
  }
  const more = matches.length > 2 ? `\n(${matches.length - 2} more match — record those from the ERP.)` : "";
  return reply(
    `🧾 ${summary}\n\nWhich payment is it?\n1. ${offered[0]!.label}\n2. ${offered[1]!.label}${weak}${more}`,
    [
      { id: upiProofButtonId(pending.id, 0), title: "1" },
      { id: upiProofButtonId(pending.id, 1), title: "2" },
      { id: upiProofButtonId(pending.id, "no"), title: "Neither" },
    ],
  );
}

/** A tap on one of the buttons above. */
export async function handleUpiProofTap(fromWaId: string, text: string): Promise<UpiProofOutcome> {
  const tap = parseUpiProofButton(text);
  if (!tap) return { handled: false };
  const staff = await payingStaff(fromWaId);
  const out = (t: string): UpiProofOutcome => ({ handled: true, audience: "upi_proof", reply: { text: t } });
  if (!staff) return out("Only staff who record payments can answer this.");
  const r = await answerPendingUpiProof(tap.draftId, tap.choice, waNormalizeLocal10(fromWaId), staff.fullName);
  if (!r.ok) return out(`⚠️ ${r.error}`);
  if (!r.recorded) return out("OK — not recorded. Enter it in the ERP if it belongs elsewhere.");
  return out(`✅ Recorded UTR ${r.recorded.utr} (${inr(r.recorded.amount_paise)}) on ${r.recorded.target_label}.`);
}

/** Send a reply built above: buttons when there are any, else plain text. */
export async function sendUpiProofReply(fromWaId: string, reply: UpiProofReply): Promise<boolean> {
  const { sendWhatsAppReplyButtons } = await import("@/lib/waInteractive");
  const { sendWhatsAppText } = await import("@/lib/waSend");
  const toMobile = waNormalizeLocal10(fromWaId);
  if (reply.buttons?.length) {
    const r = await sendWhatsAppReplyButtons({ toMobile, body: reply.text, buttons: reply.buttons });
    if (r.ok || r.mode === "stub") return true;
  }
  const t = await sendWhatsAppText({ toMobile, body: reply.text });
  return t.ok || t.mode === "stub";
}
