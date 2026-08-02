import type { StudentLeaveState } from "@/lib/studentLeave";
import { studentLeaveReadFromDbEnabled } from "@/lib/studentLeaveDbConfig";
import type { StudentLeaveDeskBundle } from "@/lib/studentLeaveNormalized.server";

export function mergeDbDeskIntoStudentLeaveState(
  state: StudentLeaveState,
  bundle: StudentLeaveDeskBundle,
  opts?: { preferDb?: boolean },
): StudentLeaveState {
  const remote = bundle.requests ?? [];
  if (!remote.length) return state;

  const preferDb = !!opts?.preferDb || studentLeaveReadFromDbEnabled();
  const takeRemote =
    preferDb ||
    (state.requests?.length ?? 0) === 0 ||
    remote.length >= (state.requests?.length ?? 0);

  const byId = new Map<string, StudentLeaveState["requests"][0]>();
  if (!takeRemote) {
    for (const r of state.requests ?? []) byId.set(r.id, r);
  }
  for (const r of remote) byId.set(r.id, r);
  if (!takeRemote) {
    for (const r of state.requests ?? []) {
      if (!byId.has(r.id)) byId.set(r.id, r);
    }
  }

  return {
    ...state,
    version: 1,
    requests: [...byId.values()],
  };
}
