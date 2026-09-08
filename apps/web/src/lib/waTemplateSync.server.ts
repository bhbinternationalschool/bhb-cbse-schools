/**
 * Keep the ERP's idea of a template's status in step with Meta's, by itself.
 *
 * Until now there were only two ways the ERP could learn that Meta had
 * approved a template, and both needed luck:
 *
 *   a webhook event appended to a JSON file on the container's own disk,
 *     which Cloud Run throws away on every deploy and every scale to zero;
 *   or a person opening Masters → WhatsApp templates and pressing Sync.
 *
 * So `bhb_fee_receipt` was APPROVED at Meta in both languages while the ERP
 * still called it pending. The send path will not use a template it believes
 * is unapproved, so it fell back to plain text, and Meta rejects plain text
 * outside the 24-hour window. Every fee receipt failed, and the error blamed
 * the 24-hour window rather than the stale status.
 *
 * This is the same merge the Masters button performs, moved server-side so a
 * schedule can run it. It reads Meta, applies any stored webhook events, and
 * PERSISTS — the browser route returns the merged state for the client to
 * save, which is no use when there is no client.
 */

import { fetchServerBlob, pushServerBlob } from "@/lib/serverBlob";
import {
  applyMetaTemplateQualityUpdate,
  applyMetaTemplateStatusUpdate,
  applyMetaTemplateSync,
  emptyWaTemplates,
  normalizeWaTemplatesState,
  templateFamilyReady,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import {
  clearPendingTemplateQualityEvents,
  clearPendingTemplateStatusEvents,
  fetchMetaMessageTemplates,
  readPendingTemplateQualityEvents,
  readPendingTemplateStatusEvents,
  waTemplatesMetaConfigured,
} from "@/lib/waTemplatesMeta.server";

export type WaTemplateSyncResult = {
  ok: boolean;
  error?: string;
  /** Families whose approval state CHANGED, so a caller can say what moved. */
  changed: { familyKey: string; language: string; from: string; to: string }[];
  metaTemplates: number;
  statusEvents: number;
  qualityEvents: number;
  /** Families that can be sent right now — both languages approved. */
  readyFamilies: string[];
};

function snapshot(state: WaTemplatesState) {
  const m = new Map<string, string>();
  for (const t of state.templates) {
    m.set(`${t.familyKey}|${t.language}`, t.status);
  }
  return m;
}

export async function syncWaTemplatesFromMeta(): Promise<WaTemplateSyncResult> {
  const empty: WaTemplateSyncResult = {
    ok: false,
    changed: [],
    metaTemplates: 0,
    statusEvents: 0,
    qualityEvents: 0,
    readyFamilies: [],
  };
  if (!waTemplatesMetaConfigured()) {
    return { ...empty, error: "Meta WABA is not configured on this server" };
  }

  const { state: stored } = await fetchServerBlob<WaTemplatesState>(
    "wa_templates_state",
  );
  // A missing blob is NOT an empty registry to overwrite with. Starting from
  // `emptyWaTemplates()` and pushing would erase 67 configured templates
  // because Supabase blinked, so a read failure stops here instead.
  if (!stored) {
    return {
      ...empty,
      error:
        "Could not read the stored template registry — refusing to sync, " +
        "because writing from an empty one would erase it",
    };
  }

  let state = normalizeWaTemplatesState(stored);
  const before = snapshot(state);

  const statusEvents = await readPendingTemplateStatusEvents();
  for (const evt of statusEvents) state = applyMetaTemplateStatusUpdate(state, evt);

  const qualityEvents = await readPendingTemplateQualityEvents();
  for (const evt of qualityEvents) state = applyMetaTemplateQualityUpdate(state, evt);

  const meta = await fetchMetaMessageTemplates();
  if (!meta.ok) {
    return {
      ...empty,
      error: meta.error || "Meta template list could not be read",
      statusEvents: statusEvents.length,
      qualityEvents: qualityEvents.length,
    };
  }
  state = applyMetaTemplateSync(state, meta.rows, "meta_sync");

  const after = snapshot(state);
  const changed: WaTemplateSyncResult["changed"] = [];
  for (const [key, to] of after) {
    const from = before.get(key);
    if (from !== undefined && from !== to) {
      const [familyKey = "", language = ""] = key.split("|");
      changed.push({ familyKey, language, from, to });
    }
  }

  const pushed = await pushServerBlob("wa_templates_state", state);
  if (!pushed.ok) {
    return {
      ...empty,
      error: pushed.error || "Could not save the merged template registry",
      metaTemplates: meta.rows.length,
      statusEvents: statusEvents.length,
      qualityEvents: qualityEvents.length,
    };
  }

  if (statusEvents.length) await clearPendingTemplateStatusEvents();
  if (qualityEvents.length) await clearPendingTemplateQualityEvents();

  const families = [...new Set(state.templates.map((t) => t.familyKey))];
  return {
    ok: true,
    changed,
    metaTemplates: meta.rows.length,
    statusEvents: statusEvents.length,
    qualityEvents: qualityEvents.length,
    readyFamilies: families.filter((f) => templateFamilyReady(state, f).ready),
  };
}
