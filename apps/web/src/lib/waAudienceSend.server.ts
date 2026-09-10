/**
 * Hand a resolved audience to the sender.
 *
 * Every message goes out as an approved template in that family's own
 * language, resolved per recipient through `resolveTemplateForSend` — the
 * one resolver the whole ERP uses — and through `/api/wa/dispatch`, so
 * quiet hours, number failover and the delivery log all apply unchanged.
 *
 * Free text is deliberately impossible here. It reaches nobody outside
 * Meta's 24-hour window, which is what 57 of this school's failed sends
 * were, and a broadcast is by definition outside that window for almost
 * everyone in it.
 */

import "server-only";

import { POST as dispatchPost } from "@/app/api/wa/dispatch/route";
import { loadWaTemplatesServer } from "@/lib/waTemplatesRead.server";
import { resolveTemplateForSend } from "@/lib/waTemplates";
import { TENANT } from "@/lib/types";
import type { WaAudienceRecipient } from "@/lib/waAudienceResolve.server";

const CHUNK_SIZE = 100;

export type WaAudienceSendResult = {
  sent: number;
  failed: number;
  deferred: number;
  /** Recipients whose language has no approved template. */
  skippedNoTemplate: number;
  error: string;
};

/** Dispatch bucket, for the household delivery log. */
function moduleFor(kind: string): string {
  switch (kind) {
    case "staff":
      return "staff";
    case "fee_stage":
      return "fees";
    default:
      return "comms";
  }
}

export async function sendTemplateToAudience(opts: {
  recipients: WaAudienceRecipient[];
  familyKey: string;
  /** Sender-supplied values, e.g. a notice date. Per-recipient wins. */
  variables: Record<string, string>;
  originUrl: string;
  audienceKind: string;
}): Promise<WaAudienceSendResult> {
  const out: WaAudienceSendResult = {
    sent: 0,
    failed: 0,
    deferred: 0,
    skippedNoTemplate: 0,
    error: "",
  };

  let templates;
  try {
    templates = await loadWaTemplatesServer();
  } catch (e) {
    // A failed read is not "no approved template" — saying so would send
    // the office after a problem they do not have.
    out.error =
      e instanceof Error
        ? `Could not read WhatsApp templates: ${e.message}`
        : "Could not read WhatsApp templates";
    out.failed = opts.recipients.length;
    return out;
  }

  type Msg = {
    messageId: string;
    mobile: string;
    fallbackMobile?: string;
    fromPhoneNumberId?: string;
    template: {
      name: string;
      language: string;
      variables: Record<string, string>;
      variableKeys: string[];
    };
  };

  const messages: Msg[] = [];
  const reasons = new Set<string>();
  for (const r of opts.recipients) {
    const resolved = resolveTemplateForSend({
      state: templates,
      familyKey: opts.familyKey,
      language: r.language,
    });
    if (!resolved.ok) {
      out.skippedNoTemplate++;
      reasons.add(resolved.reason);
      continue;
    }
    const tpl = resolved.template;
    messages.push({
      messageId: `aud_${opts.audienceKind}_${r.refId}_${r.mobile}`,
      mobile: r.mobile,
      fallbackMobile: r.fallbackMobile,
      fromPhoneNumberId: resolved.sender?.phoneNumberId || undefined,
      template: {
        name: tpl.metaName,
        language: tpl.metaLanguage || tpl.language,
        // Sender-supplied first, then this recipient's own — so
        // {{guardianName}} is the family's, not a single value for all.
        variables: { ...opts.variables, ...r.variables, schoolName: TENANT.nameDisplay },
        variableKeys: tpl.variables,
      },
    });
  }

  if (reasons.size) out.error = [...reasons].slice(0, 2).join(" · ");
  if (!messages.length) return out;

  const dispatchSecret = process.env.WA_DISPATCH_SECRET?.trim();
  const dispatchUrl = new URL("/api/wa/dispatch", opts.originUrl).toString();

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    const req = new Request(dispatchUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(dispatchSecret ? { "x-wa-dispatch-secret": dispatchSecret } : {}),
      },
      body: JSON.stringify({
        module: moduleFor(opts.audienceKind),
        messages: chunk,
      }),
    });
    try {
      const res = await dispatchPost(req);
      const json = (await res.json()) as {
        results?: { status?: string; error?: string }[];
        error?: string;
      };
      if (json.error && !out.error) out.error = json.error;
      for (const r of json.results ?? []) {
        if (r.status === "sent") out.sent++;
        else if (r.status === "deferred") out.deferred++;
        else if (r.status === "queued_stub") {
          // No provider configured: not a send, and must not be counted as
          // one. The office would otherwise be told 400 parents were told.
          out.failed++;
          if (!out.error) {
            out.error =
              "No WhatsApp provider is configured — nothing was actually sent.";
          }
        } else {
          out.failed++;
          if (r.error && !out.error) out.error = r.error;
        }
      }
    } catch (e) {
      out.failed += chunk.length;
      if (!out.error) {
        out.error = e instanceof Error ? e.message : "Dispatch failed";
      }
    }
  }

  return out;
}
