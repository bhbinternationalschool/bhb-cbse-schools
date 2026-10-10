/**
 * A multi-line expense voucher, and what it owes.
 *
 * One trip to the market buys a printer cartridge and a tank of CNG. That is
 * one voucher with two lines, two heads, possibly two vendors — and often one
 * payment that does not cover both, leaving the rest owed to whoever was not
 * paid.
 *
 * The arithmetic lives here rather than in the form because it is the part
 * that can be wrong without looking wrong: a part-payment split across lines
 * has to add back to the money that actually left, and every unpaid remainder
 * has to name the vendor it is owed to, or the payable is a number nobody can
 * chase.
 */

export type DraftExpenseLine = {
  id: string;
  /** The postable account this expense belongs to — head or sub-head. */
  accountCode: string;
  /** Cost centre, e.g. Transport. Empty when untagged. */
  tag: string;
  /** Who was paid. Empty for a line with no vendor. */
  vendorName: string;
  description: string;
  amountPaise: number;
  taxPaise: number;
};

export type AllocatedLine = DraftExpenseLine & {
  /** amount + tax. */
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
};

export type DraftTotals = {
  amountPaise: number;
  taxPaise: number;
  grandTotalPaise: number;
  paidPaise: number;
  duePaise: number;
  lines: AllocatedLine[];
  /** What is still owed, per vendor — the payable someone has to chase. */
  duesByVendor: { vendorName: string; duePaise: number }[];
};

export function lineTotalPaise(l: Pick<DraftExpenseLine, "amountPaise" | "taxPaise">): number {
  return Math.max(0, Math.round(l.amountPaise)) + Math.max(0, Math.round(l.taxPaise));
}

/**
 * Spread the money actually paid across the lines, earliest first.
 *
 * Earliest-first rather than pro-rata on purpose: a part payment in a school
 * office is "I paid the fuel bill, the cartridge is on account", not "I paid
 * 63% of everything". Pro-rata would leave every vendor part-owed and nobody
 * settled.
 */
export function allocateExpensePayment(
  lines: DraftExpenseLine[],
  paidPaise: number,
): DraftTotals {
  const rows = lines.filter((l) => l.accountCode && lineTotalPaise(l) > 0);
  const grandTotalPaise = rows.reduce((n, l) => n + lineTotalPaise(l), 0);
  // Never allocate more than was entered, nor more than the voucher is worth.
  const paid = Math.min(Math.max(0, Math.round(paidPaise)), grandTotalPaise);

  let left = paid;
  const allocated: AllocatedLine[] = rows.map((l) => {
    const total = lineTotalPaise(l);
    const take = Math.min(left, total);
    left -= take;
    return { ...l, totalPaise: total, paidPaise: take, duePaise: total - take };
  });

  const byVendor = new Map<string, number>();
  for (const l of allocated) {
    if (l.duePaise <= 0) continue;
    const name = l.vendorName.trim() || "(no vendor named)";
    byVendor.set(name, (byVendor.get(name) ?? 0) + l.duePaise);
  }

  return {
    amountPaise: rows.reduce((n, l) => n + Math.max(0, Math.round(l.amountPaise)), 0),
    taxPaise: rows.reduce((n, l) => n + Math.max(0, Math.round(l.taxPaise)), 0),
    grandTotalPaise,
    paidPaise: paid,
    duePaise: grandTotalPaise - paid,
    lines: allocated,
    duesByVendor: [...byVendor.entries()]
      .map(([vendorName, duePaise]) => ({ vendorName, duePaise }))
      .sort((a, b) => b.duePaise - a.duePaise),
  };
}

/**
 * A vendor's key in the books.
 *
 * There is no expense-vendor master in the ledger yet, so the name is the
 * identity. Normalised so "Peerson Books", "peerson books " and "Peerson
 * Books" are one party rather than three, which is the difference between a
 * vendor history and a list of near-duplicates.
 */
export function vendorPartyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export type BuiltVoucherLine = {
  accountCode: string;
  debitPaise: number;
  creditPaise: number;
  narration?: string;
  costCentreCode?: string;
  subledgerKind?: "bank_account";
  subledgerId?: string;
  party?: { kind: "vendor"; externalId: string; name: string };
  instrument?: { mode?: string; ref?: string; date?: string };
};

/**
 * Turn the draft into the balanced voucher the book will accept.
 *
 * Debits: each line's expense head, and its tax to GST input credit — the
 * account the inventory module already posts purchase tax to, so expense tax
 * and purchase tax land in the same place.
 *
 * Credits: what was paid, to cash or the bank; and what was not, to Accounts
 * Payable, ONE CREDIT PER VENDOR so the payable can be chased by name.
 */
export function buildExpenseVoucherLines(input: {
  totals: DraftTotals;
  gstInputCode: string;
  payableCode: string;
  payment:
    | { kind: "cash"; accountCode: string }
    | {
        kind: "bank";
        accountCode: string;
        bankId: string;
        mode: string;
        ref: string;
        date: string;
      };
}): BuiltVoucherLine[] {
  const out: BuiltVoucherLine[] = [];

  for (const l of input.totals.lines) {
    const party = l.vendorName.trim()
      ? {
          kind: "vendor" as const,
          externalId: vendorPartyKey(l.vendorName),
          name: l.vendorName.trim(),
        }
      : undefined;
    if (l.amountPaise > 0) {
      out.push({
        accountCode: l.accountCode,
        debitPaise: Math.round(l.amountPaise),
        creditPaise: 0,
        narration: l.description || undefined,
        ...(l.tag ? { costCentreCode: l.tag } : {}),
        ...(party ? { party } : {}),
      });
    }
    if (l.taxPaise > 0) {
      out.push({
        accountCode: input.gstInputCode,
        debitPaise: Math.round(l.taxPaise),
        creditPaise: 0,
        narration: l.description ? `Tax — ${l.description}` : "Tax",
        ...(l.tag ? { costCentreCode: l.tag } : {}),
        ...(party ? { party } : {}),
      });
    }
  }

  if (input.totals.paidPaise > 0) {
    out.push(
      input.payment.kind === "cash"
        ? {
            accountCode: input.payment.accountCode,
            debitPaise: 0,
            creditPaise: input.totals.paidPaise,
          }
        : {
            accountCode: input.payment.accountCode,
            debitPaise: 0,
            creditPaise: input.totals.paidPaise,
            subledgerKind: "bank_account",
            subledgerId: input.payment.bankId,
            instrument: {
              mode: input.payment.mode,
              ref: input.payment.ref,
              date: input.payment.date,
            },
          },
    );
  }

  // One payable credit per vendor, not one lump: a payable that cannot say
  // who it is owed to cannot be settled.
  for (const due of input.totals.duesByVendor) {
    out.push({
      accountCode: input.payableCode,
      debitPaise: 0,
      creditPaise: due.duePaise,
      narration: `Due to ${due.vendorName}`,
      party: {
        kind: "vendor",
        externalId: vendorPartyKey(due.vendorName),
        name: due.vendorName,
      },
    });
  }

  return out;
}
