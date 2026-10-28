/**
 * Checks on the payment reference a cashier types at the fee counter.
 *
 * An audit on 11 Oct 2026 found 99 groups / 331 live receipts sharing one
 * transaction id. Most were dates: the counter saved the instrument date as
 * the transaction id whenever no reference was typed. One UPI ref
 * (2530092025648843) sat on 9 receipts of 7 families over a month, and a
 * phone number stood in for a UTR. None of it was caught at the counter, so
 * none of those receipts can be matched to a bank credit now.
 *
 * Nothing here blocks a receipt. Two receipts on one reference is often
 * right — one transfer paying two children's fees — so the counter asks,
 * and says what it found, before saving.
 */

import type { TenderMode } from "@/lib/fees";

/** A live receipt that already carries a reference. */
export type RefUse = {
  ref: string;
  voucherId: string;
  receiptNo: string;
  householdId: string;
  collectionDate: string;
  totalPaise: number;
};

export type TenderRefInput = {
  mode: TenderMode;
  ref: string;
};

/** "a, b" and "a b" both name two references; check each one. */
export function splitRefs(ref: string): string[] {
  const whole = ref.trim();
  if (!whole) return [];
  const parts = whole
    .split(/[\s,;/|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return [...new Set([whole, ...parts])];
}

const DATE_SHAPES = [
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/, // 2026-05-19
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/, // 19-05-2026, 19/5/26
  /^\d{1,2}[-\s]?[a-z]{3,9}[-\s]?\d{2,4}$/i, // 19 May 2026, 19-may-26
];

export function refLooksLikeDate(ref: string): boolean {
  const r = ref.trim();
  return DATE_SHAPES.some((re) => re.test(r));
}

/** An Indian mobile number: 10 digits from 6–9, optionally +91 / 91 / 0. */
export function refLooksLikePhone(ref: string): boolean {
  const digits = ref.trim().replace(/[\s-]/g, "");
  return /^(?:\+?91|0)?[6-9]\d{9}$/.test(digits);
}

/**
 * PhonePe transaction ids carry their own date and time:
 * T + yymmdd hhmmss + digits. Returns the date, or null when the id is not
 * one, or its date is not a real date (T2064011154… — a mistyped id).
 */
export function phonePeIdDate(ref: string): string | null | "invalid" {
  const m = /^T(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d{6,}$/.exec(ref.trim());
  if (!m) {
    return /^T\d{14,}$/.test(ref.trim()) ? "invalid" : null;
  }
  const [, yy, mm, dd, hh, mi, ss] = m;
  const iso = `20${yy}-${mm}-${dd}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== iso ||
    Number(hh) > 23 ||
    Number(mi) > 59 ||
    Number(ss) > 59
  ) {
    return "invalid";
  }
  return iso;
}

function daysApart(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return Math.round(ms / 86_400_000);
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Live receipts in a fee book that carry any of these references. */
export function findRefUses(
  vouchers: {
    id: string;
    receiptNo: string;
    householdId: string;
    collectionDate: string;
    totalPaise: number;
    transactionId?: string;
    voidedAt?: string | null;
    tenders: { ref?: string }[];
  }[],
  refs: string[],
): RefUse[] {
  const wanted = new Set(refs.map((r) => r.trim()).filter(Boolean));
  if (wanted.size === 0) return [];
  const out: RefUse[] = [];
  for (const v of vouchers) {
    if (v.voidedAt) continue;
    const own = new Set<string>();
    for (const t of v.tenders) for (const r of splitRefs(t.ref ?? "")) own.add(r);
    for (const r of splitRefs(v.transactionId ?? "")) own.add(r);
    for (const r of own) {
      if (!wanted.has(r)) continue;
      out.push({
        ref: r,
        voucherId: v.id,
        receiptNo: v.receiptNo,
        householdId: v.householdId,
        collectionDate: v.collectionDate,
        totalPaise: v.totalPaise,
      });
      break;
    }
  }
  return out;
}

/**
 * What the cashier should be told before this receipt is saved. Empty when
 * there is nothing to say.
 *
 * `uses` are other live receipts already carrying these references (from
 * the server, and from this browser's book as a fallback); duplicates by
 * voucher are fine. `familyName` turns a household id into words.
 */
export function tenderRefWarnings(input: {
  tenders: TenderRefInput[];
  householdId: string;
  collectionDate: string;
  uses: RefUse[];
  familyName?: (householdId: string) => string;
}): string[] {
  const out: string[] = [];
  const name = input.familyName ?? ((id: string) => id);
  const seenVoucher = new Set<string>();

  for (const t of input.tenders) {
    const ref = t.ref.trim();
    if (!ref) continue;
    const isCash = t.mode === "cash";

    if (!isCash) {
      if (refLooksLikeDate(ref)) {
        out.push(
          `"${ref}" is a date, not a payment reference. Type the UTR / UPI ref from the payment screen, so the bank credit can be matched to this receipt.`,
        );
      } else if (refLooksLikePhone(ref)) {
        out.push(
          `"${ref}" looks like a mobile number, not a payment reference. Type the UTR / UPI ref from the payment screen.`,
        );
      }
      const pp = phonePeIdDate(ref);
      if (pp === "invalid") {
        out.push(`"${ref}" looks like a PhonePe id but its date is impossible — check it was copied correctly.`);
      } else if (pp && daysApart(pp, input.collectionDate) > 3) {
        out.push(
          `"${ref}" is a PhonePe payment made on ${pp}, but this receipt is dated ${input.collectionDate}.`,
        );
      }
    }

    const refs = new Set(splitRefs(ref));
    for (const u of input.uses) {
      if (!refs.has(u.ref) || seenVoucher.has(u.voucherId)) continue;
      seenVoucher.add(u.voucherId);
      const sameFamily = u.householdId === input.householdId;
      const sameDay = u.collectionDate === input.collectionDate;
      const where = `${u.receiptNo} (${sameFamily ? "this family" : name(u.householdId)}, ${u.collectionDate}, ${rupees(u.totalPaise)})`;
      if (sameFamily && sameDay) {
        out.push(
          `"${u.ref}" is already on ${where}. Fine if ONE payment is being split across children or dues — then the bank should show a single credit for both receipts together. If this is the same payment entered again, cancel.`,
        );
      } else {
        out.push(
          `"${u.ref}" is already on ${where}. One payment cannot pay ${sameFamily ? "on two different days" : "two families"} — check the reference before saving.`,
        );
      }
    }
  }
  return out;
}
