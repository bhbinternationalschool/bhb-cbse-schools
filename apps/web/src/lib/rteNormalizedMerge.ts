import type { RteState } from "@/lib/rteEws";
import { rteReadFromDbEnabled } from "@/lib/rteDbConfig";
import type { RteDeskBundle } from "@/lib/rteNormalized.server";

export function mergeDbDeskIntoRteState(
  state: RteState,
  bundle: RteDeskBundle,
  opts?: { preferDb?: boolean },
): RteState {
  const hasRemote =
    bundle.seats.length > 0 ||
    bundle.applications.length > 0 ||
    bundle.settings.mandatedPct !== 25 ||
    !!bundle.settings.note;
  if (!hasRemote && !rteReadFromDbEnabled() && !opts?.preferDb) return state;

  const preferDb = !!opts?.preferDb || rteReadFromDbEnabled();

  const seatById = new Map<string, RteState["seats"][0]>();
  if (!preferDb) for (const s of state.seats ?? []) seatById.set(s.id, s);
  for (const s of bundle.seats) seatById.set(s.id, s);
  if (!preferDb) {
    for (const s of state.seats ?? []) {
      if (!seatById.has(s.id)) seatById.set(s.id, s);
    }
  }

  const appById = new Map<string, RteState["applications"][0]>();
  if (!preferDb) for (const a of state.applications ?? []) appById.set(a.id, a);
  for (const a of bundle.applications) appById.set(a.id, a);
  if (!preferDb) {
    for (const a of state.applications ?? []) {
      if (!appById.has(a.id)) appById.set(a.id, a);
    }
  }

  return {
    version: 1,
    seats: [...seatById.values()],
    applications: [...appById.values()],
    settings: bundle.settings ?? state.settings,
  };
}
