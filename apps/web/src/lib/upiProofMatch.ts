/**
 * Which recorded payment a UPI success screenshot belongs to.
 *
 * Director, 7 Oct 2026: "can we share screenshot on school whatsapp API
 * number for auto fill UTR". Staff forward the GPay screenshot to the
 * school number; the ERP reads it (lib/upiPay) and looks for the ONE payment
 * already in the ERP that it pays — a salary line on a posted payroll run, a
 * staff advance, or an Accounts payment voucher marked UPI — and asks before
 * recording anything.
 *
 * A match needs the exact amount and agreement on who was paid (their UPI
 * ID, or a word of their name). A payment that already has a UTR recorded is
 * never offered again. Pure: tested in upiProofMatch.selftest.
 */

import type { UpiProof } from "@/lib/upiPay";

export type UpiTargetKind = "payroll_line" | "staff_advance" | "ledger_voucher";

export type UpiCandidate = {
  kind: UpiTargetKind;
  /** payroll_line: "<runId>|<staffId>"; staff_advance: advance id; ledger_voucher: voucher id. */
  targetId: string;
  /** "September 2026 salary — RAJESH PATEL", shown on the button. */
  label: string;
  amountPaise: number;
  payeeName: string;
  payeeVpa: string;
  /** The date the payment belongs to (salary month start, advance given date, voucher date). */
  date: string;
  /** Salary may be paid weeks after its month; advances and vouchers on the day. */
  dateWindowDays: number;
};

export type UpiMatch = UpiCandidate & { strength: "upi_id" | "name" | "amount_only" };

const tokens = (n: string) =>
  (n || "").toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);

function daysBetween(a: string, b: string): number {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 0;
  return Math.round((t2 - t1) / 86400000);
}

/**
 * Candidates the screenshot can be. Ordered: same UPI ID first, then a name
 * match. A screenshot that shows nobody (no name, no UPI ID) matches on
 * amount alone — always shown as such, for the person to decide.
 */
export function matchUpiProof(
  proof: Pick<UpiProof, "amountPaise" | "payeeName" | "payeeVpa" | "paidOn">,
  candidates: UpiCandidate[],
  recordedTargets: Set<string>,
): UpiMatch[] {
  if (!(proof.amountPaise > 0)) return [];
  const proofVpa = (proof.payeeVpa || "").toLowerCase();
  const proofName = tokens(proof.payeeName);
  const out: UpiMatch[] = [];
  for (const c of candidates) {
    if (c.amountPaise !== proof.amountPaise) continue;
    if (recordedTargets.has(`${c.kind}:${c.targetId}`)) continue;
    if (proof.paidOn && c.date) {
      // Never paid before the thing it pays existed (a day's grace for an
      // advance keyed the day after); never long after for an advance or a
      // voucher, whose date is the day the money went.
      const d = daysBetween(c.date, proof.paidOn);
      if (d < -1) continue;
      if (c.dateWindowDays >= 0 && d > c.dateWindowDays) continue;
    }
    const vpaMatch = !!proofVpa && !!c.payeeVpa && c.payeeVpa.toLowerCase() === proofVpa;
    const vpaClash = !!proofVpa && !!c.payeeVpa && !vpaMatch;
    const want = tokens(c.payeeName);
    const nameMatch = proofName.length > 0 && want.some((w) => proofName.includes(w));
    if (vpaMatch) out.push({ ...c, strength: "upi_id" });
    else if (vpaClash) continue;
    else if (nameMatch) out.push({ ...c, strength: "name" });
    else if (!proofVpa && proofName.length === 0) out.push({ ...c, strength: "amount_only" });
  }
  const rank = { upi_id: 0, name: 1, amount_only: 2 } as const;
  return out.sort((a, b) => rank[a.strength] - rank[b.strength]);
}

/** Button ids carry the draft and the choice, so a tap is self-describing. */
export function upiProofButtonId(draftId: string, choice: number | "no"): string {
  return `upiproof|${draftId}|${choice}`;
}

export function parseUpiProofButton(text: string): { draftId: string; choice: number | "no" } | null {
  const m = (text || "").trim().match(/^upiproof\|([A-Za-z0-9_-]{6,64})\|(no|\d)$/);
  if (!m) return null;
  return { draftId: m[1]!, choice: m[2] === "no" ? "no" : Number(m[2]) };
}
