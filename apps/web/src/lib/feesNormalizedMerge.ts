import type { CollectionVoucher, FeesState } from "@/lib/fees";
import type { FeeDeskAncillary } from "@/lib/feesDeskAncillary.types";

export function feesReadFromDbFlag(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_FEES_READ_FROM_DB === "true";
  }
  return process.env.FEES_READ_FROM_DB === "true";
}

function preferRemoteDb(localLen: number, remoteLen: number, preferDb?: boolean): boolean {
  return (
    !!preferDb ||
    feesReadFromDbFlag() ||
    localLen === 0 ||
    remoteLen > localLen
  );
}

/** Merge DB vouchers into desk state (vouchers slice). */
export function mergeDbVouchersIntoFeesState<
  T extends { vouchers: CollectionVoucher[] },
>(state: T, dbVouchers: CollectionVoucher[], opts?: { preferDb?: boolean }): T {
  if (!dbVouchers.length) return state;
  const local = state.vouchers ?? [];
  if (!preferRemoteDb(local.length, dbVouchers.length, opts?.preferDb)) {
    return state;
  }

  const byId = new Map<string, CollectionVoucher>();
  for (const v of dbVouchers) byId.set(v.id, v);
  for (const v of local) {
    if (!byId.has(v.id)) byId.set(v.id, v);
  }
  const merged = [...byId.values()].sort((a, b) =>
    (b.collectedAt || "").localeCompare(a.collectedAt || ""),
  );
  return { ...state, vouchers: merged };
}

function mergeSlice<T extends { id: string }>(
  local: T[],
  remote: T[],
  preferDb?: boolean,
): T[] {
  if (!remote.length) return local;
  if (!preferRemoteDb(local.length, remote.length, preferDb)) return local;
  const byId = new Map<string, T>();
  for (const r of remote) byId.set(r.id, r);
  for (const l of local) {
    if (!byId.has(l.id)) byId.set(l.id, l);
  }
  return [...byId.values()];
}

/** Merge ancillary fee desk slices from DB. */
export function mergeDbAncillaryIntoFeesState<T extends FeeDeskAncillary>(
  state: T,
  ancillary: FeeDeskAncillary,
  opts?: { preferDb?: boolean },
): T {
  const prefer = opts?.preferDb ?? feesReadFromDbFlag();
  if (
    !ancillary.cheques.length &&
    !ancillary.manualBooks.length &&
    !ancillary.dayCloses.length &&
    !ancillary.chargeVouchers.length &&
    !ancillary.installmentPlans.length &&
    !ancillary.planAllocations.length &&
    !ancillary.carriedForwardDues.length
  ) {
    return state;
  }

  return {
    ...state,
    cheques: mergeSlice(state.cheques ?? [], ancillary.cheques, prefer),
    manualBooks: mergeSlice(state.manualBooks ?? [], ancillary.manualBooks, prefer),
    dayCloses: mergeSlice(state.dayCloses ?? [], ancillary.dayCloses, prefer),
    chargeVouchers: mergeSlice(
      state.chargeVouchers ?? [],
      ancillary.chargeVouchers,
      prefer,
    ),
    installmentPlans: mergeSlice(
      state.installmentPlans ?? [],
      ancillary.installmentPlans,
      prefer,
    ),
    planAllocations: mergeSlice(
      state.planAllocations ?? [],
      ancillary.planAllocations,
      prefer,
    ),
    carriedForwardDues: mergeSlice(
      state.carriedForwardDues ?? [],
      ancillary.carriedForwardDues,
      prefer,
    ),
  };
}

/** Merge full fee desk snapshot (vouchers + ancillary). */
export function mergeDbDeskIntoFeesState(
  state: FeesState,
  desk: { vouchers: CollectionVoucher[]; ancillary: FeeDeskAncillary },
  opts?: { preferDb?: boolean },
): FeesState {
  let next = mergeDbVouchersIntoFeesState(state, desk.vouchers, opts);
  next = mergeDbAncillaryIntoFeesState(next, desk.ancillary, opts);
  return next;
}
