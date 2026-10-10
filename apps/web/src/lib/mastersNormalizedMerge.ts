import type { MastersState } from "@/lib/masters";
import { mastersReadFromDbEnabled } from "@/lib/mastersDbConfig";
import {
  STAFF_OWNED_MASTERS_SLICES,
  staffReadFromDbEnabled,
} from "@/lib/staffDbConfig";
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

  // departments / designations / staff are stripped on the way out
  // (stripStaffFromMastersForBlob), so the bundle reports them as [] whatever
  // the school's roster actually is. Letting preferDb write that [] back is
  // how a desk with 35 staff ended up with none: the Exams invigilator picker
  // had nobody to offer, and Masters re-seeded 6 placeholder departments over
  // the school's 10. The Staff module hydrates these three itself.
  const staffOwned = staffReadFromDbEnabled()
    ? new Set<string>(STAFF_OWNED_MASTERS_SLICES)
    : new Set<string>();

  for (const key of MASTERS_OBJECT_SLICES) {
    const remote = bundle[key];
    if (remote == null) continue;
    if (preferDb) {
      (next as Record<string, unknown>)[key] = remote;
    }
  }

  for (const key of Object.keys(bundle) as MastersSliceKey[]) {
    if (MASTERS_OBJECT_SLICES.includes(key)) continue;
    if (staffOwned.has(key)) continue;
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
