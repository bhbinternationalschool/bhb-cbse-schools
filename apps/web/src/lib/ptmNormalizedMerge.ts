import type { PtmState } from "@/lib/ptm";
import { ptmReadFromDbEnabled } from "@/lib/ptmDbConfig";
import type { PtmDeskBundle } from "@/lib/ptmNormalized.server";

export function mergeDbDeskIntoPtmState(
  state: PtmState,
  bundle: PtmDeskBundle,
  opts?: { preferDb?: boolean },
): PtmState {
  const hasRemote =
    bundle.events.length > 0 ||
    bundle.slots.length > 0 ||
    bundle.bookings.length > 0 ||
    bundle.feedback.length > 0;
  if (!hasRemote) return state;

  const preferDb = !!opts?.preferDb || ptmReadFromDbEnabled();

  function mergeById<T extends { id: string }>(
    local: T[],
    remote: T[],
    takeRemote: boolean,
  ): T[] {
    const byId = new Map<string, T>();
    if (!takeRemote) {
      for (const row of local) byId.set(row.id, row);
    }
    for (const row of remote) byId.set(row.id, row);
    if (!takeRemote) {
      for (const row of local) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
    return [...byId.values()];
  }

  const takeEvents =
    preferDb ||
    (state.events?.length ?? 0) === 0 ||
    bundle.events.length >= (state.events?.length ?? 0);
  const takeBookings =
    preferDb ||
    (state.bookings?.length ?? 0) === 0 ||
    bundle.bookings.length >= (state.bookings?.length ?? 0);

  return {
    ...state,
    version: 1,
    events: mergeById(state.events ?? [], bundle.events, takeEvents),
    slots: mergeById(
      state.slots ?? [],
      bundle.slots,
      preferDb || bundle.slots.length >= (state.slots?.length ?? 0),
    ),
    bookings: mergeById(state.bookings ?? [], bundle.bookings, takeBookings),
    feedback: mergeById(
      state.feedback ?? [],
      bundle.feedback,
      preferDb || bundle.feedback.length >= (state.feedback?.length ?? 0),
    ),
  };
}
