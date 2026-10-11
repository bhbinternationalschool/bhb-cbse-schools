/**
 * Who answered a pop-up, and what they gave (director, 11 Oct 2026: "some
 * has sent Aadhaar data, how we can check this in the ERP").
 *
 * One row per family: what they did with the pop-up and — for the Aadhaar
 * pop-up — whose numbers are on record now (last 4 digits only; the full
 * number stays on the student record) and whether the office has verified
 * them. Pure.
 */

import type { AadhaarVerificationStatus } from "@/lib/sis";

export type PopupOutcome = "completed" | "saved_some" | "later" | "seen" | "not_seen";

export const OUTCOME_LABEL: Record<PopupOutcome, string> = {
  completed: "Completed",
  saved_some: "Saved, some still missing",
  later: "Tapped Later",
  seen: "Seen, no answer",
  not_seen: "Not seen yet",
};

/** What a family did, from its events and whether the rule still matches it. */
export function popupOutcome(ev: { shown: number; dismissed: number; done: number }, stillPending: boolean): PopupOutcome {
  if (ev.done > 0) return stillPending ? "saved_some" : "completed";
  if (ev.dismissed > 0) return "later";
  if (ev.shown > 0) return "seen";
  return "not_seen";
}

export type AadhaarSlot = {
  /** Last 4 digits, "" when none is on record. */
  last4: string;
  status: AadhaarVerificationStatus;
};

/** One person's Aadhaar as the office may see it in a list: never the full number. */
export function aadhaarSlot(number: string | undefined, last4: string | undefined, status: AadhaarVerificationStatus | undefined): AadhaarSlot {
  const full = String(number ?? "").replace(/\D/g, "");
  const l4 = full.length === 12 ? full.slice(-4) : String(last4 ?? "").replace(/\D/g, "").slice(-4);
  return { last4: l4.length === 4 ? l4 : "", status: l4.length === 4 ? status || "received" : "missing" };
}

export type ResponseRow = {
  householdId: string;
  family: string;
  outcome: PopupOutcome;
  shown: number;
  later: number;
  firstSeen: string;
  lastSeen: string;
  doneAt: string;
  /** Whose numbers the family typed on the pop-up ("father", "mother", a child id). */
  gave: string[];
  children: {
    id: string;
    name: string;
    classLabel: string;
    child: AadhaarSlot;
    father: AadhaarSlot;
    mother: AadhaarSlot;
  }[];
};

const ORDER: PopupOutcome[] = ["completed", "saved_some", "later", "seen", "not_seen"];

/** Answered first (newest answer first), then the rest by family name. */
export function sortResponses(rows: ResponseRow[]): ResponseRow[] {
  return rows.slice().sort((a, b) => {
    const o = ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome);
    if (o) return o;
    const t = (b.doneAt || b.lastSeen).localeCompare(a.doneAt || a.lastSeen);
    return t || a.family.localeCompare(b.family);
  });
}
