/**
 * Browser half of stamped saves for the simple per-row desks (library,
 * payroll, vault, statutory, RTE — 10 Oct 2026; server: deskStamps.server).
 *
 * A load hands over each row's stamp and the settings row's stamp. A save
 * sends only the rows this browser changed, each with the stamp it changed
 * it from, and the settings only when they changed. Rows refused because
 * another device changed them first reload the desk with a notice.
 * Everything here is page memory.
 */

import {
  applyStampedSave,
  buildStampedSave,
  captureRowStamps,
  onStampConflicts,
  type RowConflicts,
  type RowStamps,
} from "@/lib/rowStampClient";
import { rowFingerprint } from "@/lib/sliceRevClient";

const settingsBases = new Map<string, { stamp: string; hash: number }>();

/** After a load this browser took: the server's stamps become the base. */
export function captureDeskStamps(
  module: string,
  local: Record<string, unknown>,
  slices: readonly string[],
  stamps: RowStamps | undefined,
  settingsStamp?: string,
  settingsKey = "settings",
) {
  captureRowStamps(module, stamps ?? {}, local, slices);
  settingsBases.set(module, { stamp: settingsStamp ?? "", hash: rowFingerprint(local[settingsKey] ?? {}) });
}

/**
 * The body of a save: each stamped list cut to the rows that changed, the
 * stamps, and `settingsBase` (null = settings unchanged).
 */
export function stampedDeskBody(
  module: string,
  state: Record<string, unknown>,
  slices: readonly string[],
  settingsKey = "settings",
): { body: Record<string, unknown>; stamps: RowStamps; settingsChanged: boolean; anything: boolean } {
  const stamps = buildStampedSave(module, state, slices);
  const body: Record<string, unknown> = { ...state };
  let anything = false;
  for (const slice of slices) {
    const changed = stamps[slice] ?? {};
    const rows = ((state[slice] as { id?: unknown }[] | undefined) ?? []).filter(
      (r) => r && typeof r.id === "string" && (r.id as string) in changed,
    );
    body[slice] = rows;
    if (rows.length) anything = true;
  }
  const base = settingsBases.get(module);
  const settingsChanged = !base || rowFingerprint(state[settingsKey] ?? {}) !== base.hash;
  if (settingsChanged) anything = true;
  body.stamps = stamps;
  body.settingsBase = settingsChanged ? (base?.stamp ?? "") : null;
  return { body, stamps, settingsChanged, anything };
}

/** After an accepted save: move the bases on; on conflicts reload and say so. */
export function afterStampedDeskSave(
  module: string,
  state: Record<string, unknown>,
  slices: readonly string[],
  sent: { stamps: RowStamps; settingsChanged: boolean },
  answer: { stamps?: RowStamps; conflicts?: RowConflicts; settingsStamp?: string } | null,
  settingsKey = "settings",
) {
  if (!answer) return;
  applyStampedSave(module, state, sent.stamps, answer, slices);
  if (sent.settingsChanged && answer.settingsStamp) {
    settingsBases.set(module, { stamp: answer.settingsStamp, hash: rowFingerprint(state[settingsKey] ?? {}) });
  }
  onStampConflicts(module, answer.conflicts);
}
