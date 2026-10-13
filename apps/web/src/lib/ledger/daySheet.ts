/**
 * The day sheet's arithmetic — pure, so the self-test can hold it.
 *
 * daySheet.server.ts reads the vouchers, lines, accounts and reversals; this
 * turns them into the sheet the counter hands to the principal:
 *
 *   - collections and expenses per tender (the cash or bank account the money
 *     moved through) and per head, over a date range;
 *   - a per-day breakdown when the range is longer than a day;
 *   - a cancelled pair — a reversed voucher AND its reversal — with BOTH
 *     halves inside the range is kept out of both sides and listed apart. The
 *     13 Oct 2026 clean-up dated each reversal on its original's date, so a
 *     removed salary payment showed under Expenses and its reversal under
 *     Collections, as if money had come in;
 *   - a half whose partner falls OUTSIDE the range stays where it is, counted,
 *     and labelled ("cancelled later on 9 Sep — RV/…", "cancels RC/… of
 *     29 Aug"). Those are mostly fee receipts voided weeks later: the cash was
 *     counted on the original's day, and that day's sheet must still agree
 *     with the cash that was counted.
 *
 * Still a sheet of movements, never a balance — see daySheet.server.ts.
 */

/** One money line behind a head's figure — what a click on the head lists. */
export type DaySheetEntry = {
  voucherId: string;
  voucherNo: string;
  date: string;
  narration: string;
  paise: number;
  /** Set when the other half of a reversed pair is outside the range. */
  note?: string;
};

/** A half counted on the sheet whose partner is outside the range. */
export type DaySheetCrossRange = {
  voucherId: string;
  voucherNo: string;
  date: string;
  note: string;
  inPaise: number;
  outPaise: number;
};

export type DaySheetHead = {
  code: string;
  name: string;
  paise: number;
  count: number;
  /** The lines that make up `paise`; `count` is their number. */
  entries: DaySheetEntry[];
};

export type DaySheetTender = {
  code: string;
  name: string;
  paise: number;
  count: number;
  heads: DaySheetHead[];
};

export type DaySheetSide = {
  totalPaise: number;
  count: number;
  tenders: DaySheetTender[];
};

export type DaySheetDay = { date: string; inPaise: number; outPaise: number };

export type DaySheetCancelled = {
  voucherNo: string;
  date: string;
  /** "cancelled" — the voucher a reversal undid; "reversal" — the undoing. */
  role: "cancelled" | "reversal";
  narration: string;
  /** The other half's number, when known. */
  pairedNo: string;
  /** Why it was reversed, as the reversal recorded it. */
  reason: string;
  inPaise: number;
  outPaise: number;
};

export type DaySheet = {
  ok: boolean;
  error?: string;
  /** Kept for callers that still send one date: equals `from`. */
  date: string;
  from: string;
  to: string;
  collections: DaySheetSide;
  expenses: DaySheetSide;
  /** One row per day with movement, oldest first. */
  days: DaySheetDay[];
  /** Pairs wholly inside the range: hidden from both sides, listed on request. */
  cancelled: DaySheetCancelled[];
  /** Halves of pairs that straddle the range edge: counted, and labelled. */
  crossRange: DaySheetCrossRange[];
  /** True when the read stopped short and the sheet may be incomplete. */
  truncated: boolean;
};

export const DAY_SHEET_MAX_DAYS = 92;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

/**
 * {from, to}, or the old {date}. Capped at 92 days — a quarter is the
 * longest hand-over anyone signs, and the read grows with the range.
 */
export function daySheetRange(input: {
  date?: string;
  from?: string;
  to?: string;
}): { ok: true; from: string; to: string } | { ok: false; from: string; to: string; error: string } {
  const from = String(input.from || input.date || "");
  const to = String(input.to || input.from || input.date || "");
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || Number.isNaN(dayNumber(from)) || Number.isNaN(dayNumber(to))) {
    return { ok: false, from, to, error: "Dates must be yyyy-mm-dd" };
  }
  if (to < from) return { ok: false, from, to, error: "The To date is before the From date" };
  const days = dayNumber(to) - dayNumber(from) + 1;
  if (days > DAY_SHEET_MAX_DAYS) {
    return {
      ok: false,
      from,
      to,
      error: `That is ${days} days — the sheet covers at most ${DAY_SHEET_MAX_DAYS} (about a quarter). Pick a shorter range.`,
    };
  }
  return { ok: true, from, to };
}

export type DsVoucher = {
  id: string;
  voucherNo: string;
  date: string;
  narration: string;
  reversesVoucherId: string;
};
export type DsLine = { voucherId: string; accountId: string; debitPaise: number; creditPaise: number };
export type DsAccount = { id: string; code: string; name: string; isMoney: boolean };

/** "Reversal of PY/… — Cleared for re-entry" → { of: "PY/…", reason: "Cleared for re-entry" }. */
export function parseReversalNarration(n: string): { of: string; reason: string } {
  const m = /^Reversal of (\S+)\s*(?:[—–-]\s*)?([\s\S]*)$/.exec(n.trim());
  if (!m) return { of: "", reason: n.trim() };
  return { of: m[1]!, reason: m[2]!.trim() };
}

/**
 * @param vouchers every voucher dated in the range
 * @param lines    their lines
 * @param reversals every reversal in the book (any date) — the pairs are read
 *                  from these
 * @param originals vouchers outside the range that an in-range reversal
 *                  cancels — only for their number and date in the label
 */
export function buildDaySheet(input: {
  from: string;
  to: string;
  vouchers: DsVoucher[];
  lines: DsLine[];
  accounts: DsAccount[];
  reversals: DsVoucher[];
  originals?: DsVoucher[];
}): Omit<DaySheet, "ok" | "error" | "truncated"> {
  const accounts = new Map(input.accounts.map((a) => [a.id, a]));
  const reversalOf = new Map<string, DsVoucher>();
  for (const r of input.reversals) if (r.reversesVoucherId) reversalOf.set(r.reversesVoucherId, r);
  const byId = new Map(input.vouchers.map((v) => [v.id, v]));
  const outside = new Map((input.originals ?? []).map((v) => [v.id, v]));

  const linesByVoucher = new Map<string, DsLine[]>();
  for (const l of input.lines) {
    const arr = linesByVoucher.get(l.voucherId);
    if (arr) arr.push(l);
    else linesByVoucher.set(l.voucherId, [l]);
  }

  const collect = new Map<string, DaySheetTender>();
  const spend = new Map<string, DaySheetTender>();
  const days = new Map<string, DaySheetDay>();
  const cancelled: DaySheetCancelled[] = [];
  const crossRange: DaySheetCrossRange[] = [];

  const bump = (
    side: Map<string, DaySheetTender>,
    tender: DsAccount,
    head: DsAccount | undefined,
    paise: number,
    v: DsVoucher,
    note: string,
  ) => {
    let t = side.get(tender.code);
    if (!t) {
      t = { code: tender.code, name: tender.name, paise: 0, count: 0, heads: [] };
      side.set(tender.code, t);
    }
    t.paise += paise;
    t.count += 1;
    const code = head?.code ?? "—";
    const name = head?.name ?? "Unclassified";
    let h = t.heads.find((x) => x.code === code);
    if (!h) {
      h = { code, name, paise: 0, count: 0, entries: [] };
      t.heads.push(h);
    }
    h.paise += paise;
    h.count += 1;
    h.entries.push({
      voucherId: v.id,
      voucherNo: v.voucherNo,
      date: v.date,
      narration: v.narration,
      paise,
      ...(note ? { note } : {}),
    });
  };

  for (const v of input.vouchers) {
    const vLines = linesByVoucher.get(v.id) ?? [];
    let inPaise = 0;
    let outPaise = 0;
    for (const l of vLines) {
      if (!accounts.get(l.accountId)?.isMoney) continue;
      // Money in is a debit to cash/bank; money out is a credit.
      if (l.debitPaise > 0) inPaise += l.debitPaise;
      else if (l.creditPaise > 0) outPaise += l.creditPaise;
    }

    const undoneBy = reversalOf.get(v.id);
    // A pair is hidden only when both halves are on this sheet.
    const pairInRange = v.reversesVoucherId
      ? byId.has(v.reversesVoucherId)
      : !!undoneBy && byId.has(undoneBy.id);
    let note = "";
    if (v.reversesVoucherId && !pairInRange) {
      const orig = outside.get(v.reversesVoucherId);
      const no = orig?.voucherNo || parseReversalNarration(v.narration).of || "an entry";
      note = `cancels ${no}${orig?.date ? ` of ${orig.date}` : ""}`;
    } else if (undoneBy && !pairInRange) {
      note = `cancelled ${undoneBy.date >= v.date ? "later" : "earlier"} on ${undoneBy.date} — ${undoneBy.voucherNo}`;
    }
    if (pairInRange) {
      if (v.reversesVoucherId) {
        const parsed = parseReversalNarration(v.narration);
        cancelled.push({
          voucherNo: v.voucherNo,
          date: v.date,
          role: "reversal",
          narration: v.narration,
          pairedNo: byId.get(v.reversesVoucherId)?.voucherNo || parsed.of,
          reason: parsed.reason,
          inPaise,
          outPaise,
        });
      } else {
        cancelled.push({
          voucherNo: v.voucherNo,
          date: v.date,
          role: "cancelled",
          narration: v.narration,
          pairedNo: undoneBy!.voucherNo,
          reason: parseReversalNarration(undoneBy!.narration).reason,
          inPaise,
          outPaise,
        });
      }
      continue;
    }

    // The contra is whatever the voucher touched that was NOT cash or bank.
    // Where several heads share one money line, the first is named — a
    // hand-over sheet wants the head, not a full double-entry dissection.
    const head = vLines
      .map((l) => accounts.get(l.accountId))
      .find((a): a is DsAccount => !!a && !a.isMoney);
    for (const l of vLines) {
      const acct = accounts.get(l.accountId);
      if (!acct?.isMoney) continue;
      if (l.debitPaise > 0) bump(collect, acct, head, l.debitPaise, v, note);
      else if (l.creditPaise > 0) bump(spend, acct, head, l.creditPaise, v, note);
    }
    if (note) crossRange.push({ voucherId: v.id, voucherNo: v.voucherNo, date: v.date, note, inPaise, outPaise });
    if (inPaise || outPaise) {
      const d = days.get(v.date) ?? { date: v.date, inPaise: 0, outPaise: 0 };
      d.inPaise += inPaise;
      d.outPaise += outPaise;
      days.set(v.date, d);
    }
  }

  const side = (m: Map<string, DaySheetTender>): DaySheetSide => {
    const tenders = [...m.values()].sort((a, b) => b.paise - a.paise);
    for (const t of tenders) {
      t.heads.sort((a, b) => b.paise - a.paise);
      for (const h of t.heads) {
        h.entries.sort((a, b) => a.date.localeCompare(b.date) || a.voucherNo.localeCompare(b.voucherNo));
      }
    }
    return sideTotals(tenders);
  };

  return {
    date: input.from,
    from: input.from,
    to: input.to,
    collections: side(collect),
    expenses: side(spend),
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    cancelled: cancelled.sort((a, b) => a.date.localeCompare(b.date) || a.voucherNo.localeCompare(b.voucherNo)),
    crossRange: crossRange.sort((a, b) => a.date.localeCompare(b.date) || a.voucherNo.localeCompare(b.voucherNo)),
  };
}

function sideTotals(tenders: DaySheetTender[]): DaySheetSide {
  return {
    tenders,
    totalPaise: tenders.reduce((n, t) => n + t.paise, 0),
    count: tenders.reduce((n, t) => n + t.count, 0),
  };
}

/**
 * One day cut out of a range's side — for "Print selected days", which prints
 * one sheet per day from the range already read rather than asking the
 * server again. Rebuilt from the entries, so a day's sheet adds up exactly as
 * a single-day read would.
 */
export function sideForDay(side: DaySheetSide, date: string): DaySheetSide {
  const tenders: DaySheetTender[] = [];
  for (const t of side.tenders) {
    const heads: DaySheetHead[] = [];
    for (const h of t.heads) {
      const entries = h.entries.filter((e) => e.date === date);
      if (entries.length === 0) continue;
      heads.push({
        code: h.code,
        name: h.name,
        entries,
        count: entries.length,
        paise: entries.reduce((n, e) => n + e.paise, 0),
      });
    }
    if (heads.length === 0) continue;
    heads.sort((a, b) => b.paise - a.paise);
    tenders.push({
      code: t.code,
      name: t.name,
      heads,
      count: heads.reduce((n, h) => n + h.count, 0),
      paise: heads.reduce((n, h) => n + h.paise, 0),
    });
  }
  tenders.sort((a, b) => b.paise - a.paise);
  return sideTotals(tenders);
}

/** The days picked for printing, in date order, whatever order they were ticked. */
export function pickedDays(days: { date: string }[], picked: ReadonlySet<string>): string[] {
  return days.map((d) => d.date).filter((d) => picked.has(d)).sort();
}

/** Select-all toggles: all picked → none; otherwise → every day with movement. */
export function toggleAllDays(days: { date: string }[], picked: ReadonlySet<string>): Set<string> {
  const all = days.length > 0 && days.every((d) => picked.has(d.date));
  return all ? new Set() : new Set(days.map((d) => d.date));
}
