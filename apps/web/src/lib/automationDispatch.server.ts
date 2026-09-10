/**
 * Actually sending an automation approval, server-side.
 *
 * The tick used to mark an auto-run rule "completed" with `dispatched: 0`
 * and stop there — nothing was ever posted to WhatsApp unless a human
 * opened Masters → Automation and pressed the button. A rule marked
 * auto-run therefore reported success every night while sending nothing,
 * which is the worst of the three possible outcomes: the school believed
 * the parents had been told.
 *
 * This routes an approval's payload through `/api/wa/dispatch` — the same
 * choke point campaigns and the fee desk use, so opt-out, quiet hours,
 * failover and the household delivery log all apply unchanged.
 */

import "server-only";

import { POST as dispatchPost } from "@/app/api/wa/dispatch/route";
import type { AutomationApprovalItem, AutomationModule } from "@/lib/automation";
import { loadWaTemplatesServer } from "@/lib/waTemplatesRead.server";
import {
  resolveTemplateForSend,
  type WaTemplateLanguage,
  type WaTemplatesState,
} from "@/lib/waTemplates";

/** Meta caps a dispatch batch; the route has enforced 100 since it was written. */
const CHUNK_SIZE = 100;

/** The numbers `demoPreviewForRule` used to invent. Never dial them. */
const LEGACY_DEMO_MOBILES = new Set(["9876543210", "9123456780"]);

export type AutomationDispatchResult = {
  ok: boolean;
  sent: number;
  failed: number;
  /** Held by a family's own quiet hours — retried on a later tick. */
  deferred: number;
  error: string;
};

type DispatchMessage = {
  messageId: string;
  mobile: string;
  fallbackMobile?: string;
  body?: string;
  fromPhoneNumberId?: string;
  template?: {
    name: string;
    language: string;
    variables: Record<string, string>;
    variableKeys: string[];
  };
};

/** The dispatch log bucket for a rule's module — attendance stays urgent. */
function dispatchModuleFor(module: AutomationModule): string {
  switch (module) {
    case "fees":
      return "fees";
    case "admissions":
    case "campaigns":
      return "admissions";
    case "attendance":
      return "attendance";
    case "transport":
      return "transport";
    default:
      return "comms";
  }
}

function languageOf(
  entry: AutomationApprovalItem["dispatchPayload"][number],
  fallback: WaTemplateLanguage,
): WaTemplateLanguage {
  const raw = (entry.language || entry.templateLanguage || "").toLowerCase();
  return raw === "hi" ? "hi" : raw === "en" ? "en" : fallback;
}

/**
 * Build one dispatch message per recipient, each in that family's language.
 *
 * A family whose language has no approved template is skipped with its own
 * reason rather than being sent the other language: `resolveTemplateForSend`
 * already refuses a family that only has one side approved, and silently
 * sending English to a Hindi household is exactly what that rule exists to
 * prevent.
 */
function buildMessages(
  item: AutomationApprovalItem,
  templates: WaTemplatesState,
): { messages: DispatchMessage[]; skipped: string[] } {
  const messages: DispatchMessage[] = [];
  const skipped: string[] = [];
  const familyKey = item.templateFamilyKey;

  for (const entry of item.dispatchPayload) {
    const mobile = (entry.mobile || "").replace(/\D/g, "");
    if (mobile.length < 10) {
      skipped.push(`${entry.mobile || "(blank)"}: invalid mobile`);
      continue;
    }
    if (LEGACY_DEMO_MOBILES.has(mobile.slice(-10))) {
      // A card raised by the old tick, still sitting in Approvals when this
      // shipped. Its "audience" was two invented numbers that belong to
      // strangers; approving it must not message them.
      skipped.push(`${mobile}: demo recipient from an old evaluation — re-run the rule`);
      continue;
    }
    const language = languageOf(entry, item.templateLanguage);

    if (!familyKey) {
      // Automation sends approved templates or nothing. Free text reaches
      // nobody outside the 24-hour window, and the only free text this path
      // has is the card's own preview line — a sentence written for staff,
      // not for a parent.
      skipped.push(
        `${mobile}: this rule has no WhatsApp template family, and automation only sends approved templates`,
      );
      continue;
    }

    const resolved = resolveTemplateForSend({
      state: templates,
      familyKey,
      language,
    });
    if (!resolved.ok) {
      skipped.push(`${mobile}: ${resolved.reason}`);
      continue;
    }
    const tpl = resolved.template;
    messages.push({
      messageId: `auto_${item.id}_${mobile}`,
      mobile,
      fallbackMobile: entry.fallbackMobile,
      fromPhoneNumberId: resolved.sender?.phoneNumberId || undefined,
      template: {
        name: tpl.metaName,
        language: tpl.metaLanguage || tpl.language,
        variables: entry.variables || {},
        variableKeys: tpl.variables,
      },
    });
  }

  return { messages, skipped };
}

/**
 * Send one approved item for real.
 *
 * `ok` means every message the school could send was accepted — not that
 * every recipient was reachable. Skipped recipients and provider failures
 * come back in `error` so the approval card can say what happened.
 */
export async function dispatchAutomationApproval(opts: {
  item: AutomationApprovalItem;
  module: AutomationModule;
  /** Any request from the running server — the dispatch URL needs an origin. */
  originUrl: string;
  dryRun?: boolean;
}): Promise<AutomationDispatchResult> {
  const { item, module, originUrl } = opts;
  if (!item.dispatchPayload.length) {
    return { ok: false, sent: 0, failed: 0, deferred: 0, error: "No recipients" };
  }

  let templates: WaTemplatesState;
  try {
    templates = await loadWaTemplatesServer();
  } catch (e) {
    // A failed read is not "no approved template". Failing the run keeps the
    // approval pending so the next tick tries again, instead of recording a
    // configuration problem the school does not have.
    return {
      ok: false,
      sent: 0,
      failed: 0,
      deferred: 0,
      error:
        e instanceof Error
          ? `Could not read WhatsApp templates: ${e.message}`
          : "Could not read WhatsApp templates",
    };
  }

  const { messages, skipped } = buildMessages(item, templates);
  if (!messages.length) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      deferred: 0,
      error: skipped[0] || "Nothing could be sent",
    };
  }

  const dispatchSecret = process.env.WA_DISPATCH_SECRET?.trim();
  const dispatchUrl = new URL("/api/wa/dispatch", originUrl).toString();
  let sent = 0;
  let failed = 0;
  let deferred = 0;
  const errors: string[] = [];

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    const req = new Request(dispatchUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(dispatchSecret ? { "x-wa-dispatch-secret": dispatchSecret } : {}),
      },
      body: JSON.stringify({
        module: dispatchModuleFor(module),
        dryRun: !!opts.dryRun,
        messages: chunk,
      }),
    });
    let json: {
      ok?: boolean;
      error?: string;
      results?: { status?: string; error?: string }[];
    };
    try {
      const res = await dispatchPost(req);
      json = (await res.json()) as typeof json;
    } catch (e) {
      failed += chunk.length;
      errors.push(e instanceof Error ? e.message : "Dispatch failed");
      continue;
    }
    if (json.error) errors.push(json.error);
    for (const r of json.results ?? []) {
      if (r.status === "sent" || r.status === "queued_stub") sent++;
      else if (r.status === "deferred") deferred++;
      else {
        failed++;
        if (r.error && errors.length < 5) errors.push(r.error);
      }
    }
  }

  if (skipped.length) {
    errors.push(
      `${skipped.length} recipient${skipped.length === 1 ? "" : "s"} skipped — ${skipped[0]}`,
    );
  }

  return {
    ok: sent > 0 && failed === 0,
    sent,
    failed,
    deferred,
    error: errors.slice(0, 3).join(" · "),
  };
}
