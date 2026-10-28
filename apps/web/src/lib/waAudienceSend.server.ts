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
  /**
   * Optional: each chunk's per-recipient outcome (refId + dispatch status:
   * "sent", "failed", "deferred", "queued_stub", or "unknown" when the
   * dispatch threw and the outcome is not known), awaited before the next
   * chunk — for callers that record who was reached as it happens.
   */
  onChunkResults?: (results: { refId: string; status: string }[]) => Promise<void>;
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
  const refIdOf = new Map<string, string>();
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
    const messageId = `aud_${opts.audienceKind}_${r.refId}_${r.mobile}`;
    refIdOf.set(messageId, r.refId);
    messages.push({
      messageId,
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

  await dispatchInChunks({
    messages,
    module: moduleFor(opts.audienceKind),
    originUrl: opts.originUrl,
    refIdOf,
    out,
    onChunkResults: opts.onChunkResults,
  });

  return out;
}

type ChunkMsg = { messageId: string };

/**
 * The one dispatch loop: chunks of 100 through /api/wa/dispatch (quiet
 * hours, number failover, delivery log), counting what came back into
 * `out`. Shared by the template and the free-text sends so they cannot
 * drift apart in how they count.
 */
async function dispatchInChunks(opts: {
  messages: ChunkMsg[];
  module: string;
  originUrl: string;
  refIdOf: Map<string, string>;
  out: WaAudienceSendResult;
  onChunkResults?: (results: { refId: string; status: string }[]) => Promise<void>;
}): Promise<void> {
  const { messages, refIdOf, out } = opts;
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
        module: opts.module,
        messages: chunk,
      }),
    });
    try {
      const res = await dispatchPost(req);
      const json = (await res.json()) as {
        results?: { messageId?: string; status?: string; error?: string }[];
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
      if (opts.onChunkResults) {
        await opts.onChunkResults(
          (json.results ?? []).map((r) => ({
            refId: refIdOf.get(String(r.messageId ?? "")) ?? "",
            status: String(r.status ?? "failed"),
          })),
        );
      }
    } catch (e) {
      // The chunk may or may not have reached Meta: say "unknown", so a
      // caller that records who was reached can treat it as possibly sent.
      if (opts.onChunkResults) {
        await opts
          .onChunkResults(chunk.map((m) => ({ refId: refIdOf.get(m.messageId) ?? "", status: "unknown" })))
          .catch(() => undefined);
      }
      out.failed += chunk.length;
      if (!out.error) {
        out.error = e instanceof Error ? e.message : "Dispatch failed";
      }
    }
  }

}

/**
 * Free text to recipients the caller has ALREADY found inside their 24-hour
 * window (see lib/staffAppBroadcast splitCustomMessage). Meta refuses free
 * text to anyone else, so this must never be handed a whole audience.
 */
export async function sendTextToAudience(opts: {
  recipients: WaAudienceRecipient[];
  text: string;
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
  const text = opts.text.trim();
  if (!text || !opts.recipients.length) return out;
  const refIdOf = new Map<string, string>();
  const messages = opts.recipients.map((r) => {
    const messageId = `aud_text_${opts.audienceKind}_${r.refId}_${r.mobile}`;
    refIdOf.set(messageId, r.refId);
    return {
      messageId,
      mobile: r.mobile,
      fallbackMobile: r.fallbackMobile,
      body: text,
    };
  });
  await dispatchInChunks({
    messages,
    module: moduleFor(opts.audienceKind),
    originUrl: opts.originUrl,
    refIdOf,
    out,
  });
  return out;
}
