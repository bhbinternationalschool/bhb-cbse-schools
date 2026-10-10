import { getServerTenantContext } from "@/lib/serverTenant";

/**
 * One row per WhatsApp message in public.wa_messages (see its migration):
 * the record the ERP's chat view shows "like WhatsApp" (director, 9 Oct
 * 2026). Best effort — a message that went out is never failed because its
 * log row could not be written; the error is only printed.
 */

const last10 = (raw: string) => String(raw ?? "").replace(/\D/g, "").slice(-10);

type TemplateComponent = { type?: string; parameters?: { type?: string; text?: string }[] };

/** The body variables of a template, in order — enough to show it as read. */
export function templateParamsOf(components: unknown): string[] {
  if (!Array.isArray(components)) return [];
  const body = (components as TemplateComponent[]).find((c) => (c?.type || "").toLowerCase() === "body");
  return (body?.parameters ?? []).map((p) => String(p?.text ?? "")).slice(0, 20);
}

export async function logWaOutbound(input: {
  to: string;
  kind: string;
  body?: string;
  templateName?: string;
  templateParams?: string[];
  result: { ok: boolean; providerId?: string; error?: string; mode: string };
  phoneNumberId?: string;
}): Promise<void> {
  // A send that never reached Meta (no number, no credentials, blocked
  // before sending) is not a message the family has.
  if (input.result.mode !== "meta") return;
  const mobile10 = last10(input.to);
  if (mobile10.length !== 10) return;
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return;
    const { error } = await ctx.sb.from("wa_messages").insert({
      tenant_id: ctx.tenantId,
      mobile10,
      direction: "out",
      kind: input.kind,
      body: String(input.body ?? "").slice(0, 4000),
      template_name: input.templateName || "",
      template_params: (input.templateParams ?? []).map((p) => String(p).slice(0, 500)),
      wa_message_id: input.result.providerId && input.result.providerId !== "ok" ? input.result.providerId : "",
      ok: input.result.ok,
      error: (input.result.error || "").slice(0, 400),
      phone_number_id: input.phoneNumberId || "",
    });
    if (error) console.warn("[wa-log] outbound not logged:", error.message);
  } catch (e) {
    console.warn("[wa-log] outbound not logged:", e instanceof Error ? e.message : e);
  }
}

export async function logWaInbound(input: {
  from: string;
  text: string;
  waMessageId?: string;
  replyToWaMessageId?: string;
  kind?: string;
}): Promise<void> {
  const mobile10 = last10(input.from);
  if (mobile10.length !== 10) return;
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return;
    const { error } = await ctx.sb.from("wa_messages").insert({
      tenant_id: ctx.tenantId,
      mobile10,
      direction: "in",
      kind: input.kind || "text",
      body: String(input.text ?? "").slice(0, 4000),
      wa_message_id: input.waMessageId || "",
      reply_to_wa_message_id: input.replyToWaMessageId || "",
    });
    if (error) console.warn("[wa-log] inbound not logged:", error.message);
  } catch (e) {
    console.warn("[wa-log] inbound not logged:", e instanceof Error ? e.message : e);
  }
}
