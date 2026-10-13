/**
 * "Entered up to" — where the office got to in a pile of paper.
 *
 * The office re-keys a session's expenses in date order (the 13 Oct 2026
 * clean-up reversed 365 old entries for re-entry from 1 April). The question
 * at the start of every sitting is "till which date are entries done?", and
 * the honest answer has two halves that can differ:
 *
 *   - the latest DATE on a live entry — how far through the pile the book is;
 *   - the most recently KEYED entry — what was typed last, which is a back-
 *     dated bill as often as not.
 *
 * Only live entries count: a reversed voucher, and the reversal itself, are
 * cancelled and say nothing about how far the keying has got.
 *
 * Pure, so the voucher forms and the staff-advance register share the rule
 * and the self-test can hold it.
 */

export type EntryLike = {
  /** The entry's own date, YYYY-MM-DD. */
  date: string;
  /** When it was keyed — an ISO timestamp. */
  keyedAt: string;
};

export type LastEntries<T> = {
  /** Latest date; ties go to the one keyed last. */
  latestDate: T | null;
  /** Most recently keyed, whatever its date. */
  lastKeyed: T | null;
};

export function pickLastEntries<T extends EntryLike>(rows: T[]): LastEntries<T> {
  let latestDate: T | null = null;
  let lastKeyed: T | null = null;
  for (const r of rows) {
    if (!r.date) continue;
    if (
      !latestDate ||
      r.date > latestDate.date ||
      (r.date === latestDate.date && r.keyedAt > latestDate.keyedAt)
    ) {
      latestDate = r;
    }
    if (!lastKeyed || r.keyedAt > lastKeyed.keyedAt) lastKeyed = r;
  }
  return { latestDate, lastKeyed };
}

/** The voucher fields the server reads for the strip. */
export type HandVoucher = EntryLike & {
  id: string;
  voucherNo: string;
  voucherType: string;
  createdBy: string;
  /** Set when this voucher is itself a reversal. */
  reversesVoucherId: string;
};

export type LastEntrySummary = {
  date: string;
  voucherNo: string;
  keyedAt: string;
  createdBy: string;
};

export type LastEntriesByKind = Record<
  string,
  { latestDate: LastEntrySummary | null; lastKeyed: LastEntrySummary | null }
>;

/**
 * Per voucher type, plus "any": the latest live hand-keyed voucher by date
 * and by keying time. `reversedIds` are the ids some reversal points at.
 */
export function lastEntriesByKind(
  rows: HandVoucher[],
  reversedIds: Set<string>,
): LastEntriesByKind {
  const live = rows.filter(
    (r) => !r.reversesVoucherId && r.voucherType !== "reversal" && !reversedIds.has(r.id),
  );
  const summary = (r: HandVoucher | null): LastEntrySummary | null =>
    r ? { date: r.date, voucherNo: r.voucherNo, keyedAt: r.keyedAt, createdBy: r.createdBy } : null;
  const out: LastEntriesByKind = {};
  const kinds = new Set(live.map((r) => r.voucherType));
  for (const kind of kinds) {
    const p = pickLastEntries(live.filter((r) => r.voucherType === kind));
    out[kind] = { latestDate: summary(p.latestDate), lastKeyed: summary(p.lastKeyed) };
  }
  const all = pickLastEntries(live);
  out.any = { latestDate: summary(all.latestDate), lastKeyed: summary(all.lastKeyed) };
  return out;
}

/** "13 Oct 2026, 4:05 pm" in IST — when an entry was keyed. */
export function formatKeyedAtIst(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
