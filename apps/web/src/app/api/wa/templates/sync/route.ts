/**
 * Sync WhatsApp template registry from Meta WABA message_templates.
 * POST body (optional): { state?: WaTemplatesState }
 * Returns merged state for the client to persist.
 */

import { NextResponse } from "next/server";
import {
  applyMetaTemplateStatusUpdate,
  applyMetaTemplateSync,
  emptyWaTemplates,
  normalizeWaTemplatesState,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import {
  clearPendingTemplateStatusEvents,
  fetchMetaMessageTemplates,
  readPendingTemplateStatusEvents,
  waTemplatesMetaConfigured,
} from "@/lib/waTemplatesMeta.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "wa-templates-sync",
    metaConfigured: waTemplatesMetaConfigured(),
    note: "POST optional { state } to merge Meta message_templates + webhook status events",
  });
}

export async function POST(req: Request) {
  let body: { state?: WaTemplatesState } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  let state = normalizeWaTemplatesState(body.state || emptyWaTemplates());

  const pending = await readPendingTemplateStatusEvents();
  for (const evt of pending) {
    state = applyMetaTemplateStatusUpdate(state, evt);
  }

  const meta = await fetchMetaMessageTemplates();
  if (meta.ok) {
    state = applyMetaTemplateSync(state, meta.rows, "meta_sync");
    if (pending.length) await clearPendingTemplateStatusEvents();
    return NextResponse.json({
      ok: true,
      mode: meta.mode,
      synced: meta.rows.length,
      statusEventsApplied: pending.length,
      state,
    });
  }

  if (pending.length) await clearPendingTemplateStatusEvents();
  return NextResponse.json({
    ok: false,
    mode: meta.mode,
    error: meta.error,
    synced: 0,
    statusEventsApplied: pending.length,
    state,
    hint: "Without WABA credentials, catalog stays pending until Meta sync is configured",
  });
}
