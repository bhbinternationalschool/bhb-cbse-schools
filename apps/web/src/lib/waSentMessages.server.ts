/**
 * Every WhatsApp message the school has sent, and what happened to it.
 *
 * The pieces existed and never met. `household_message_log` records each
 * send that went through `/api/wa/dispatch`; `wa_message_delivery` has been
 * collecting Meta's sent/delivered/read/failed webhooks for months. They
 * were joined in exactly two places: one household's timeline, and the fee
 * receipts screen. So "did the fee reminders actually land?" had no answer
 * that did not involve opening 199 families one at a time.
 *
 * This is the school-wide view: newest first, filterable, with the delivery
 * ladder attached — the same `waDeliveryStatus.server` ladder the receipt
 * screen uses, so a tick means the same thing everywhere in the ERP.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  deliveryLaddersFor,
  ladderStage,
} from "@/lib/waDeliveryStatus.server";
import {
  stageLabel,
  type WaDeliveryStage,
} from "@/lib/waDeliveryStatusShape";
import { classifyWaFailure } from "@/lib/waFailureReason";
import {
  countStage,
  emptyTally,
  resolveRowStage,
  type WaSentMessageRow,
  type WaSentMessageTally,
} from "@/lib/waSentMessages";

export type {
  WaSentMessageRow,
  WaSentMessageTally,
} from "@/lib/waSentMessages";

export type WaSentMessagesPage = {
  rows: WaSentMessageRow[];
  tally: WaSentMessageTally;
  /** Distinct purposes present in the window, for the filter chips. */
  purposes: string[];
  /** false = the read itself failed; rows are unknown, not empty. */
  ok: boolean;
  error?: string;
};

export type WaSentMessagesQuery = {
  /** ISO date-time floor. Defaults to the last 7 days. */
  sinceIso?: string;
  purpose?: string;
  /** Narrow to one rung of the ladder. */
  stage?: WaDeliveryStage;
  /** Mobile fragment or template name fragment. */
  search?: string;
  limit?: number;
};

const DEFAULT_WINDOW_DAYS = 7;
const MAX_ROWS = 500;

export async function listWaSentMessages(
  q: WaSentMessagesQuery = {},
): Promise<WaSentMessagesPage> {
  const limit = Math.min(Math.max(q.limit ?? 200, 1), MAX_ROWS);
  const sinceIso =
    q.sinceIso ||
    new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return {
      rows: [],
      tally: emptyTally(),
      purposes: [],
      ok: false,
      error: "Tenant not configured",
    };
  }

  // Over-fetch when filtering by stage: the rung is only known after the
  // ladder join, so the database cannot do that half of the filter.
  const wantStage = q.stage;
  const fetchLimit = wantStage ? Math.min(limit * 4, MAX_ROWS * 2) : limit;

  let query = ctx.sb
    .from("household_message_log")
    .select(
      "id, created_at, mobile_e164, household_id, purpose, via, template_name, preview, status, error, wa_message_id",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("channel", "wa")
    .eq("direction", "out")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (q.purpose) query = query.eq("purpose", q.purpose);
  if (q.search?.trim()) {
    const needle = q.search.trim().replace(/[%,]/g, "");
    if (needle) {
      query = query.or(
        `mobile_e164.ilike.%${needle}%,template_name.ilike.%${needle}%`,
      );
    }
  }

  const { data, error } = await query;
  if (error) {
    // A failed read is not "nothing was sent". Saying so would tell the
    // office their reminders never went out.
    return {
      rows: [],
      tally: emptyTally(),
      purposes: [],
      ok: false,
      error: error.message,
    };
  }

  const raw = data || [];
  const ladders = await deliveryLaddersFor(
    raw.map((r) => String(r.wa_message_id || "")),
  );

  const tally = emptyTally();
  const purposes = new Set<string>();
  const rows: WaSentMessageRow[] = [];

  for (const r of raw) {
    const waMessageId = String(r.wa_message_id || "");
    const ladder = ladders.get(waMessageId);
    const handoff: "sent" | "failed" =
      String(r.status) === "failed" ? "failed" : "sent";
    const stage = resolveRowStage(handoff, ladderStage(ladder));
    const reason = r.error ? String(r.error) : (ladder?.error ?? "");
    // Only classify an actual failure: a delivered message has no reason to
    // explain, and inventing one would put advice on a row that is fine.
    const verdict = stage === "failed" ? classifyWaFailure(reason) : null;
    purposes.add(String(r.purpose || ""));
    if (wantStage && stage !== wantStage) continue;
    if (rows.length >= limit) continue;
    countStage(tally, stage);
    rows.push({
      id: String(r.id),
      at: String(r.created_at || ""),
      mobile: String(r.mobile_e164 || ""),
      householdId: r.household_id ? String(r.household_id) : null,
      purpose: String(r.purpose || ""),
      via: String(r.via || ""),
      templateName: String(r.template_name || ""),
      preview: String(r.preview || ""),
      handoff,
      stage,
      stageLabel: stageLabel(stage),
      deliveredAt: ladder?.deliveredAt ?? null,
      readAt: ladder?.readAt ?? null,
      error: reason || null,
      failureKind: verdict?.kind ?? null,
      failureLabel: verdict?.label ?? null,
      failureAdvice: verdict?.advice ?? null,
      waMessageId,
    });
  }

  return {
    rows,
    tally,
    purposes: [...purposes].filter(Boolean).sort(),
    ok: true,
  };
}
