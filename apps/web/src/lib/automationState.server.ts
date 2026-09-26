/**
 * Server-side load/save for automation state.
 *
 * The Cloud Scheduler tick POSTs an empty body, so the tick route must be
 * able to read the tenant's automation rules from Supabase itself (desk
 * slices first, legacy jsonb blob as fallback) and persist the evaluated
 * state back — otherwise scheduled automations evaluate emptyAutomation()
 * and never fire.
 *
 * A read that FAILS is not an empty desk. Before 2026-09 a timed-out or
 * denied read fell through to the seeded defaults, and the tick then saved
 * those defaults over the school's real rules — every rule off, every
 * approval gone. `loadAutomationFromDb` now reports the failure and the
 * callers refuse to evaluate or save anything.
 */

import "server-only";

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

export type AutomationLoadResult =
  | { ok: true; state: AutomationState; source: "desk" | "blob" | "seed" }
  | { ok: false; error: string };

export async function loadAutomationFromDb(): Promise<AutomationLoadResult> {
  const desk = await fetchDeskSliceFromDb("automation");
  if (!desk.ok) {
    return { ok: false, error: desk.error || "Could not read automation desk" };
  }
  if (Array.isArray(desk.bundle.rules) && desk.bundle.rules.length > 0) {
    return {
      ok: true,
      source: "desk",
      state: normalizeAutomationState({
        version: 1,
        ...desk.bundle,
      } as Partial<AutomationState>),
    };
  }
  const remote = await fetchServerBlob<AutomationState>("automation_state");
  if (remote.state) {
    return { ok: true, source: "blob", state: normalizeAutomationState(remote.state) };
  }
  return { ok: true, source: "seed", state: emptyAutomation() };
}

/** Throwing variant for callers that cannot proceed without the state. */
export async function requireAutomationFromDb(): Promise<AutomationState> {
  const read = await loadAutomationFromDb();
  if (!read.ok) throw new Error(read.error);
  return read.state;
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
