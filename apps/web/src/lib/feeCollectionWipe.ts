/**
 * When server mirror collections are wiped, sync empty vouchers to the browser desk.
 */

import {
  clearFeeCollections,
  countFeeCollections,
  loadFees,
  wipeFeeCollections,
} from "@/lib/fees";

const SEEN_KEY = "bhb_collections_wipe_seen_v1";

type WipeSignal = {
  wipedAt: string;
  removedVouchers: number;
  note?: string;
};

export async function applyCollectionWipeSignalIfNeeded(): Promise<{
  wiped: boolean;
  removedVouchers: number;
}> {
  if (typeof window === "undefined") {
    return { wiped: false, removedVouchers: 0 };
  }

  let signal: WipeSignal;
  try {
    const res = await fetch("/fees/collections_wiped.json", { cache: "no-store" });
    if (!res.ok) return { wiped: false, removedVouchers: 0 };
    signal = (await res.json()) as WipeSignal;
  } catch {
    return { wiped: false, removedVouchers: 0 };
  }

  if (!signal?.wipedAt) return { wiped: false, removedVouchers: 0 };
  if (localStorage.getItem(SEEN_KEY) === signal.wipedAt) {
    return { wiped: false, removedVouchers: 0 };
  }

  const before = countFeeCollections(loadFees());
  if (before === 0) {
    localStorage.setItem(SEEN_KEY, signal.wipedAt);
    return { wiped: false, removedVouchers: 0 };
  }

  const { removedVouchers } = await wipeFeeCollections();
  localStorage.setItem(SEEN_KEY, signal.wipedAt);
  return { wiped: true, removedVouchers };
}

export function clearFeeCollectionsOnly(): ReturnType<typeof clearFeeCollections> {
  return clearFeeCollections(loadFees());
}
