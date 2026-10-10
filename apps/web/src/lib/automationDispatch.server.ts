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
import { mobileKey, remindedTooRecently } from "@/lib/automationSendRules";
import { feeLedgerSinceIso, feeRemindersSince } from "@/lib/feeReminderLedger.server";
import {
  templateButtonComponents,
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
  /**
   * Accepted by the dispatch route but NOT handed to Meta — a dry run, or
   * the stub it falls back to when no WhatsApp provider is configured.
   *
   * Counted apart from `sent` on purpose. The route answers both cases with
   * `status: "queued_stub"`, so counting those as sent had the tick report
   * "150 sent" for a school with no WA credentials, and — worse — a dry run
   * marked every card dispatched, so the messages it was previewing would
   * never actually go out.
   */
  simulated: number;
  /** True when nothing really left the building. */
  simulatedOnly: boolean;
  error: string;
  /** Fee cards only: families left out because they were reminded in the last 7 days. */
  skippedRecent?: number;
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
    components?: ReturnType<typeof templateButtonComponents>["components"];
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
    // A "Pay now" button with a per-family URL needs its value on every send —
    // Meta rejects the message otherwise. A card raised before the button
    // existed has no value for it: skipped with a reason, never sent broken.
    const buttons = templateButtonComponents(tpl, entry.variables || {});
    if (buttons.missing.length) {
      skipped.push(`${mobile}: the template's button needs ${buttons.missing.join(", ")} — re-run the rule`);
      continue;
    }
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
        ...(buttons.components.length ? { components: buttons.components } : {}),
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
  const { module, originUrl } = opts;
  // Fee cards are brought up to the minute before anything is sent: each
  // family's children, dues and total looked up again, and families who
  // have paid since the card was built left out (lib/feeFamilyLive.server).
  let item = opts.item;
  if (module === "fees") {
    const { liveFeeCard } = await import("@/lib/feeFamilyLive.server");
    let live: Awaited<ReturnType<typeof liveFeeCard>>;
    try {
      live = await liveFeeCard(item);
    } catch (e) {
      // Today's figure could not be read. The card's figure is not a
      // stand-in for it — that is exactly how a paid family gets chased.
      return {
        ok: false,
        sent: 0,
        failed: 0,
        deferred: 0,
        simulated: 0,
        simulatedOnly: false,
        error: `Could not read today's dues (${e instanceof Error ? e.message : "unknown error"}) — nothing sent. Try again in a few minutes.`,
      };
    }
    item = live.item;
    if (!item.dispatchPayload.length && live.settled > 0) {
      return {
        ok: false,
        sent: 0,
        failed: 0,
        deferred: 0,
        simulated: 0,
        simulatedOnly: false,
        error: `Nothing sent — all ${live.settled} famil${live.settled === 1 ? "y has" : "ies have"} paid since this card was made.`,
      };
    }
  }
  if (!item.dispatchPayload.length) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      deferred: 0,
      simulated: 0,
      simulatedOnly: false,
      error: "No recipients",
    };
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
      simulated: 0,
      simulatedOnly: false,
      error:
        e instanceof Error
          ? `Could not read WhatsApp templates: ${e.message}`
          : "Could not read WhatsApp templates",
    };
  }

  const built = buildMessages(item, templates);
  const skipped = built.skipped;
  let messages = built.messages;

  // Once a week per family, for fee messages — on this path too. It had no
  // cap at all, so on 14 Sep 2026 it reminded 95 families it had reminded
  // three days before. The send log is the ledger both fee paths write to.
  let skippedRecent = 0;
  if (module === "fees" && messages.length) {
    const now = new Date();
    const ledger = await feeRemindersSince(feeLedgerSinceIso(now));
    if (!ledger) {
      // Unread is not "nobody was reminded". Hold: a reminder that waits a
      // day costs nothing, a family chased twice in a week is the harm.
      return {
        ok: false,
        sent: 0,
        failed: 0,
        deferred: 0,
        simulated: 0,
        simulatedOnly: false,
        error: "Could not check which families were reminded this week — nothing sent. Try again in a few minutes.",
      };
    }
    const todayIst = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const lastFor = (mobile?: string) => {
      const k = mobileKey(mobile);
      const at = k ? ledger.byMobile.get(k) : undefined;
      return at ? new Date(Date.parse(at) + 330 * 60_000).toISOString().slice(0, 10) : undefined;
    };
    const keep = messages.filter(
      (m) =>
        !remindedTooRecently(lastFor(m.mobile), todayIst) &&
        !remindedTooRecently(lastFor(m.fallbackMobile), todayIst),
    );
    skippedRecent = messages.length - keep.length;
    messages = keep;
    if (!messages.length) {
      return {
        ok: false,
        sent: 0,
        failed: 0,
        deferred: 0,
        simulated: 0,
        simulatedOnly: false,
        skippedRecent,
        error: `Nothing sent — all ${skippedRecent} famil${skippedRecent === 1 ? "y was" : "ies were"} sent a fee reminder in the last 7 days.`,
      };
    }
  }

  if (!messages.length) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      deferred: 0,
      simulated: 0,
      simulatedOnly: false,
      error: skipped[0] || "Nothing could be sent",
    };
  }

  const dispatchSecret = process.env.WA_DISPATCH_SECRET?.trim();
  const dispatchUrl = new URL("/api/wa/dispatch", originUrl).toString();
  let sent = 0;
  let failed = 0;
  let deferred = 0;
  let simulated = 0;
  const modes = new Set<string>();
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
      mode?: string;
      outboundConfigured?: boolean;
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
    if (json.mode) modes.add(json.mode);
    for (const r of json.results ?? []) {
      if (r.status === "sent") sent++;
      else if (r.status === "queued_stub") simulated++;
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
  if (skippedRecent) {
    errors.push(
      `${skippedRecent} famil${skippedRecent === 1 ? "y" : "ies"} left out — already sent a fee reminder in the last 7 days`,
    );
  }

  const simulatedOnly = simulated > 0 && sent === 0;
  if (simulatedOnly) {
    errors.unshift(
      modes.has("dry_run")
        ? `Dry run — ${simulated} message${simulated === 1 ? "" : "s"} previewed, nothing sent`
        : `No WhatsApp provider configured — ${simulated} message${simulated === 1 ? "" : "s"} stubbed, nothing sent`,
    );
  }

  return {
    // A dry run and a stub are never "ok": ok is what lets the caller mark
    // the card dispatched, and a card marked dispatched is never retried.
    ok: sent > 0 && failed === 0,
    sent,
    failed,
    deferred,
    simulated,
    simulatedOnly,
    skippedRecent,
    error: errors.slice(0, 3).join(" · "),
  };
}
