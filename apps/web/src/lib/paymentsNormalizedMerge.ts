import type { PaymentLink, PaymentsState } from "@/lib/payments";
import { paymentsReadFromDbEnabled } from "@/lib/paymentsDbConfig";

export function paymentsReadFromDbFlag(): boolean {
  return paymentsReadFromDbEnabled();
}

function preferRemoteDb(
  localLen: number,
  remoteLen: number,
  preferDb?: boolean,
): boolean {
  return (
    !!preferDb ||
    paymentsReadFromDbFlag() ||
    localLen === 0 ||
    remoteLen > localLen
  );
}

export function mergeDbLinksIntoPaymentsState<
  T extends { links: PaymentLink[] },
>(state: T, dbLinks: PaymentLink[], opts?: { preferDb?: boolean }): T {
  if (!dbLinks.length) return state;
  const local = state.links ?? [];
  if (!preferRemoteDb(local.length, dbLinks.length, opts?.preferDb)) {
    return state;
  }

  const byId = new Map<string, PaymentLink>();
  for (const l of dbLinks) byId.set(l.id, l);
  for (const l of local) {
    if (!byId.has(l.id)) byId.set(l.id, l);
  }
  const merged = [...byId.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return { ...state, links: merged };
}

export function mergeDbDeskIntoPaymentsState(
  state: PaymentsState,
  desk: { links: PaymentLink[] },
  opts?: { preferDb?: boolean },
): PaymentsState {
  return mergeDbLinksIntoPaymentsState(state, desk.links, opts);
}
