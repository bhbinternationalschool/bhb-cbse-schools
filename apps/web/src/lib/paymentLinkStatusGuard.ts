/**
 * A payment link's status only moves forward.
 *
 *   open → paid | cancelled | expired      (and a late payment: cancelled/expired → paid)
 *
 * Nothing legitimately takes a link back to "open", or out of "paid". But
 * every save of the link desk wrote the links it carried as they were — an
 * office tab that loaded before the payment came in, or the server's own
 * cached copy (settlement, /pay/due, the WhatsApp bot and autopay all save
 * the whole list), wrote "open" back over "paid". A paid link that reads
 * open is offered again, reused for a new checkout, and chased as unpaid.
 *
 * So a save may not move a stored link backwards; that one link is kept as
 * stored and the rest of the save goes through.
 */

import type { PaymentLinkStatus } from "@/lib/payments";

const RANK: Record<PaymentLinkStatus, number> = {
  open: 0,
  cancelled: 1,
  expired: 1,
  paid: 2,
};

/** Would writing `incoming` over `stored` move the link backwards? */
export function linkStatusRegresses(stored: string | null | undefined, incoming: string | null | undefined): boolean {
  if (!stored) return false; // a new link
  const s = RANK[stored as PaymentLinkStatus];
  const i = RANK[incoming as PaymentLinkStatus];
  if (s === undefined) return false;
  if (i === undefined) return true; // an unknown status never replaces a known one
  return i < s;
}
