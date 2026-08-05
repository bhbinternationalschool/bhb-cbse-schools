import type { MastersState } from "@/lib/masters";
import { mastersReadFromDbEnabled } from "@/lib/mastersDbConfig";
import type { MastersDeskBundle, MastersSliceKey } from "@/lib/mastersNormalized.server";
import { MASTERS_OBJECT_SLICES } from "@/lib/mastersNormalized.server";

export function mergeDbDeskIntoMastersState(
  state: MastersState,
  bundle: MastersDeskBundle,
  opts?: { preferDb?: boolean },
): MastersState {
  const preferDb = !!opts?.preferDb || mastersReadFromDbEnabled();
  const hasRemote =
    bundle.classes.length > 0 ||
    bundle.feeHeads.length > 0 ||
    bundle.subjects.length > 0 ||
    !!bundle.schoolProfile ||
    (bundle.campuses?.length ?? 0) > 0;
  if (!hasRemote && !preferDb) {
    return state;
  }
  const next: MastersState = { ...state, version: 2 };

  for (const key of MASTERS_OBJECT_SLICES) {
    const remote = bundle[key];
    if (remote == null) continue;
    if (preferDb) {
      (next as Record<string, unknown>)[key] = remote;
    }
  }

  for (const key of Object.keys(bundle) as MastersSliceKey[]) {
    if (MASTERS_OBJECT_SLICES.includes(key)) continue;
    const local = state[key];
    const remote = bundle[key];
    if (!Array.isArray(local) || !Array.isArray(remote)) continue;
    if (preferDb || local.length === 0 || remote.length >= local.length) {
      (next as Record<string, unknown>)[key] = remote;
      continue;
    }
    const byId = new Map<string, (typeof local)[number]>();
    for (const row of local) {
      const id = (row as { id?: string }).id;
      if (id) byId.set(id, row);
    }
    for (const row of remote) {
      const id = (row as { id?: string }).id;
      if (id) byId.set(id, row);
    }
    (next as Record<string, unknown>)[key] = [...byId.values()];
  }

  return next;
}
