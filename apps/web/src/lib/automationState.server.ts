/**
 * Server-side load/save for automation state.
 *
 * The Cloud Scheduler tick POSTs an empty body, so the tick route must be
 * able to read the tenant's automation rules from Supabase itself (desk
 * slices first, legacy jsonb blob as fallback) and persist the evaluated
 * state back — otherwise scheduled automations evaluate emptyAutomation()
 * and never fire.
 */

import {
  emptyAutomation,
  normalizeAutomationState,
  type AutomationState,
} from "@/lib/automation";
import { deskSkipBlobPush } from "@/lib/deskCutover";
import {
  fetchDeskSliceFromDb,
  pushDeskSliceToDb,
} from "@/lib/deskSliceNormalized.server";
import { fetchServerBlob, pushServerBlob } from "@/lib/serverBlob";

export async function loadAutomationFromDb(): Promise<AutomationState> {
  const { bundle } = await fetchDeskSliceFromDb("automation");
  if (Array.isArray(bundle.rules) && bundle.rules.length > 0) {
    return normalizeAutomationState({
      version: 1,
      ...bundle,
    } as Partial<AutomationState>);
  }
  const remote = await fetchServerBlob<AutomationState>("automation_state");
  if (remote.state) return normalizeAutomationState(remote.state);
  return emptyAutomation();
}

export async function saveAutomationToDb(
  state: AutomationState,
): Promise<{ ok: boolean; error?: string }> {
  const next = normalizeAutomationState(state);
  const desk = await pushDeskSliceToDb("automation", next);
  if (!desk.ok) return desk;
  if (deskSkipBlobPush("automation")) return { ok: true };
  return pushServerBlob("automation_state", next);
}
