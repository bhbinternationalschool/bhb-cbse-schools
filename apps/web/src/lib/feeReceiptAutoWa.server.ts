/**
 * Message the family their receipt the moment it exists — nobody clicks.
 *
 * The counter's WhatsApp button was a step somebody had to remember, on a
 * screen they had already finished with, so a family's proof of payment
 * depended on how busy the desk was. Worse, the button sent PLAIN TEXT, and
 * plain text is only deliverable inside Meta's 24-hour window: a parent who
 * had not messaged the school that day got nothing, and the counter saw an
 * error about a window rather than anything they could act on.
 *
 * This sends the approved `fees_receipt` TEMPLATE, which has no such window,
 * in the family's own language.
 *
 * Three rules it will not break:
 *
 *   the receipt comes FIRST. Money is recorded whether or not WhatsApp is
 *     reachable; every failure here is swallowed and written down, never
 *     thrown back into the collection path;
 *   never twice for the same receipt. `wa_receipt_sends` has the voucher id
 *     as its primary key, so a retried push or a replayed request cannot
 *     message a family again about money they already heard about;
 *   nothing for a voided receipt.
 */

import { fetchServerBlob } from "@/lib/serverBlob";
import { getServerTenantContext } from "@/lib/serverTenant";
import { formatInr, type CollectionVoucher } from "@/lib/fees";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { resolveHouseholdByMobileServer } from "@/lib/parentHousehold.server";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import { sendWaWithFailover } from "@/lib/waSend";
import {
  resolveTemplateForSend,
  templateVariablePositions,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { TENANT } from "@/lib/types";

export const FEE_RECEIPT_FAMILY = "fees_receipt";

export type ReceiptAutoWaOutcome =
  | { sent: true; mobile: string; templateName: string; language: string }
  | { sent: false; reason: string; alreadySent?: boolean };

/**
 * Has this receipt already been messaged?
 *
 * Returns true when we cannot tell — a database we cannot read is not
 * permission to message a parent a second time about their money.
 */
async function alreadySent(voucherId: string): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return true;
  const { data, error } = await ctx.sb
    .from("wa_receipt_sends")
    .select("voucher_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("voucher_id", voucherId)
    .maybeSingle();
  if (error) {
    console.warn("[receiptAutoWa] could not check send log", error.message);
    return true;
  }
  return !!data;
}

async function recordSend(row: {
  voucherId: string;
  receiptNo: string;
  mobile: string;
  status: "sent" | "failed" | "skipped";
  templateName?: string;
  language?: string;
  error?: string;
  waMessageId?: string;
}): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const { error } = await ctx.sb.from("wa_receipt_sends").upsert(
    {
      tenant_id: ctx.tenantId,
      voucher_id: row.voucherId,
      receipt_no: row.receiptNo,
      mobile: row.mobile,
      status: row.status,
      template_name: row.templateName ?? "",
      language: row.language ?? "",
      error: (row.error ?? "").slice(0, 500),
      wa_message_id: row.waMessageId ?? "",
      sent_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,voucher_id" },
  );
  if (error) console.warn("[receiptAutoWa] could not record send", error.message);
}

/**
 * Send one receipt to one family. Never throws.
 *
 * `studentNames` and `mobile` are passed in rather than looked up, because
 * the caller already holds the fee context and a second load of the whole
 * SIS per receipt would make the counter slower for no gain.
 */
export async function sendFeeReceiptWhatsApp(input: {
  voucher: Pick<
    CollectionVoucher,
    "id" | "receiptNo" | "householdId" | "totalPaise" | "collectionDate"
  > & { voidedAt?: string | null };
  mobile: string;
  studentNames: string[];
}): Promise<ReceiptAutoWaOutcome> {
  const { voucher } = input;
  try {
    if (voucher.voidedAt) {
      return { sent: false, reason: "Receipt is voided" };
    }
    const mobile = (input.mobile || "").replace(/\D/g, "");
    if (mobile.length < 10) {
      await recordSend({
        voucherId: voucher.id,
        receiptNo: voucher.receiptNo,
        mobile: "",
        status: "skipped",
        error: "No WhatsApp number on the household",
      });
      return { sent: false, reason: "No WhatsApp number on the household" };
    }
    if (await alreadySent(voucher.id)) {
      return { sent: false, reason: "Already sent", alreadySent: true };
    }

    const { state } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
    if (!state) {
      return { sent: false, reason: "Template registry unavailable" };
    }

    const found = await resolveHouseholdByMobileServer(mobile);
    const household = found?.household ?? null;
    // The FAMILY's language, never the cashier's.
    const language = waTemplateLanguageFor(household ?? undefined);

    const resolved = resolveTemplateForSend({
      state,
      familyKey: FEE_RECEIPT_FAMILY,
      language,
    });
    if (!resolved.ok) {
      // Said plainly and stored, because this is exactly the failure that
      // went unexplained for days: the template was approved at Meta and
      // stale here, and the only symptom anyone saw was a 24-hour-window
      // error that pointed at the wrong thing.
      await recordSend({
        voucherId: voucher.id,
        receiptNo: voucher.receiptNo,
        mobile,
        status: "failed",
        language,
        error: resolved.reason,
      });
      return { sent: false, reason: resolved.reason };
    }

    const values = templateVariablePositions(resolved.template, {
      receiptNo: voucher.receiptNo,
      childName: input.studentNames.filter(Boolean).join(", ") || "your child",
      feeDue: formatInr(voucher.totalPaise),
      paidOn: voucher.collectionDate,
      schoolName: TENANT.name,
    });

    const templateName = resolved.template.metaName;
    const templateLanguage =
      resolved.template.metaLanguage || resolved.template.language;

    // Quiet hours are deliberately NOT consulted. A receipt is the family's
    // proof that money they just handed over was recorded, and it is sent
    // because they paid, not because the school decided to write to them.
    const r = await sendWaWithFailover({
      primaryMobile: mobile,
      fallbackMobile: household?.altMobile || undefined,
      template: {
        name: templateName,
        language: templateLanguage,
        components: [
          {
            type: "body",
            parameters: Object.keys(values)
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => ({ type: "text", text: values[k]! })),
          },
        ],
      },
      fromPhoneNumberId: resolved.sender?.phoneNumberId,
      clientMessageId: `receipt:${voucher.id}`,
    });

    await recordSend({
      voucherId: voucher.id,
      receiptNo: voucher.receiptNo,
      mobile,
      status: r.ok ? "sent" : "failed",
      templateName,
      language: templateLanguage,
      error: r.error,
      waMessageId: r.providerId,
    });

    if (household) {
      await logHouseholdWaSend({
        mobile,
        purpose: FEE_RECEIPT_FAMILY,
        via: "template",
        templateName,
        preview: `Receipt ${voucher.receiptNo} · ${formatInr(voucher.totalPaise)}`,
        status: r.ok ? "sent" : "failed",
        error: r.error,
        waMessageId: r.providerId,
      }).catch(() => undefined);
    }

    return r.ok
      ? { sent: true, mobile, templateName, language: templateLanguage }
      : { sent: false, reason: r.error || "WhatsApp send failed" };
  } catch (e) {
    // The receipt stands. A crash here must never reach the collection path.
    const reason = e instanceof Error ? e.message : String(e);
    console.warn("[receiptAutoWa] unexpected failure", reason);
    await recordSend({
      voucherId: voucher.id,
      receiptNo: voucher.receiptNo,
      mobile: input.mobile,
      status: "failed",
      error: reason,
    }).catch(() => undefined);
    return { sent: false, reason };
  }
}
