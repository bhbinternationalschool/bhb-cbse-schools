/**
 * Library late fine — one pure rule, used at return (server) and for the
 * "fine to date" on overdue screens and reports (browser).
 *
 * The rule (school-set in Library → Rules):
 *  - `finePaisePerDay` for every day a book is late,
 *  - the first `graceDays` late days are free (a book 2 days late with 3
 *    grace days owes nothing; 5 days late owes 2 days),
 *  - `capPaise` is the most one loan can owe (0 = no cap).
 *
 * A date that cannot be read is an error, never a zero fine: "we could not
 * work it out" must not be recorded as "nothing owed" (the defect class in
 * memory note erp-unknown-must-not-become-fact).
 */

export type LibraryFineRule = {
  finePaisePerDay: number;
  graceDays: number;
  /** 0 = no cap. */
  capPaise: number;
};

export type LibraryFineResult =
  | {
      ok: true;
      /** Calendar days after the due date (0 when on time or early). */
      daysLate: number;
      /** Late days left after the grace days. */
      chargeableDays: number;
      finePaise: number;
      /** True when the cap cut the fine down. */
      capped: boolean;
    }
  | { ok: false; error: string };

/** How a loan's fine stands once the book is back. */
export type LibraryFineStatus = "none" | "pending" | "collected" | "waived";

export const LIBRARY_FINE_STATUSES: readonly LibraryFineStatus[] = [
  "none",
  "pending",
  "collected",
  "waived",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Days since 1970-01-01 for a YYYY-MM-DD date, or null when it is not a real date. */
export function isoDayNumber(iso: string): number | null {
  const s = String(iso ?? "").slice(0, 10);
  if (!ISO_DATE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // 2026-02-30 rolls into March: not a date anyone wrote on purpose.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return Math.round(ms / 86_400_000);
}

export function validateFineRule(rule: Partial<LibraryFineRule>): { ok: true; rule: LibraryFineRule } | { ok: false; error: string } {
  const perDay = Number(rule.finePaisePerDay);
  const grace = Number(rule.graceDays ?? 0);
  const cap = Number(rule.capPaise ?? 0);
  if (!Number.isInteger(perDay) || perDay < 0) return { ok: false, error: "Fine per day must be zero or more (whole paise)" };
  if (!Number.isInteger(grace) || grace < 0 || grace > 365) return { ok: false, error: "Grace days must be between 0 and 365" };
  if (!Number.isInteger(cap) || cap < 0) return { ok: false, error: "Fine cap must be zero (no cap) or more" };
  return { ok: true, rule: { finePaisePerDay: perDay, graceDays: grace, capPaise: cap } };
}

/**
 * The fine for a loan due on `dueOn` and returned (or looked at) on `asOf`.
 */
export function computeLateFine(
  rule: Partial<LibraryFineRule>,
  dueOn: string,
  asOf: string,
): LibraryFineResult {
  const v = validateFineRule(rule);
  if (!v.ok) return v;
  const due = isoDayNumber(dueOn);
  if (due == null) return { ok: false, error: `Due date "${dueOn}" is not a date` };
  const back = isoDayNumber(asOf);
  if (back == null) return { ok: false, error: `Return date "${asOf}" is not a date` };

  const daysLate = Math.max(0, back - due);
  const chargeableDays = Math.max(0, daysLate - v.rule.graceDays);
  const raw = chargeableDays * v.rule.finePaisePerDay;
  const capped = v.rule.capPaise > 0 && raw > v.rule.capPaise;
  return {
    ok: true,
    daysLate,
    chargeableDays,
    finePaise: capped ? v.rule.capPaise : raw,
    capped,
  };
}

/** The status a fine starts in at return: owed, or nothing to collect. */
export function initialFineStatus(finePaise: number): LibraryFineStatus {
  return finePaise > 0 ? "pending" : "none";
}

/**
 * Which way a fine may move. Only a pending fine is settled — once, either
 * collected (with a receipt) or waived (with a reason). A collected fine is
 * never quietly turned back; reversing money is an accounts job.
 */
export function canSettleFine(
  status: LibraryFineStatus,
  finePaise: number,
): { ok: true } | { ok: false; error: string } {
  if (finePaise <= 0) return { ok: false, error: "This loan has no fine to settle" };
  if (status === "collected") return { ok: false, error: "This fine is already collected" };
  if (status === "waived") return { ok: false, error: "This fine was already waived" };
  if (status !== "pending") return { ok: false, error: "This fine is not open" };
  return { ok: true };
}
